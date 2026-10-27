/**
 * Verification pipeline orchestrator.
 *
 *   syntax → DNS/MX → (optional) SMTP RCPT probe → catch-all test → classification
 *
 * Classification policy:
 *   deliverable — server explicitly accepted RCPT TO and the domain is not a catch-all
 *   bounce      — invalid syntax, dead domain, no mail service, or server rejected RCPT TO
 *   unknown     — anything the mail server would not confirm: catch-all, greylisting,
 *                 unreachable server, timeouts, SMTP disabled, DNS trouble
 */

import { lookupMailDomain, type DomainInfo } from "./dns";
import { probeRcpt, type RcptVerdict } from "./smtp";
import { parseEmailAddress } from "./syntax";
import { suggestDomain } from "./levenshtein";
import {
  DISPOSABLE_DOMAINS,
  FREE_PROVIDERS,
  ROLE_LOCALS,
  emptyFlags,
} from "./data";
import type { VerifyFlags, VerifyResult } from "./types";

export type { DeliveryStatus, VerifyResult, VerifyFlags, VerifyStage } from "./types";

export interface VerifierConfig {
  smtpEnabled: boolean;
  heloDomain: string;
  /** Empty string = RFC 5321 null sender. */
  mailFrom: string;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  overallTimeoutMs: number;
  /** Parallel SMTP conversations allowed per batch. */
  concurrency: number;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined ? Number.NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getVerifierConfigFromEnv(): VerifierConfig {
  return {
    smtpEnabled: envBool("EMAIL_VERIFY_SMTP", true),
    heloDomain: process.env.EMAIL_VERIFY_HELO ?? "mailprobe.local",
    mailFrom: process.env.EMAIL_VERIFY_MAIL_FROM ?? "",
    connectTimeoutMs: envInt("EMAIL_VERIFY_TIMEOUT_CONNECT", 6000),
    commandTimeoutMs: envInt("EMAIL_VERIFY_TIMEOUT_COMMAND", 8000),
    overallTimeoutMs: envInt("EMAIL_VERIFY_TIMEOUT_OVERALL", 16000),
    concurrency: envInt("EMAIL_VERIFY_CONCURRENCY", 4),
  };
}

interface BatchCaches {
  domains: Map<string, DomainInfo>;
}

const CATCHALL_TTL_MS = 5 * 60_000;
const catchAllCache = new Map<string, { at: number; value: boolean | null }>();

/** Verify a batch of pasted tokens (deduped, concurrency-limited). */
export async function verifyEmails(tokens: string[], cfg: VerifierConfig): Promise<VerifyResult[]> {
  const caches: BatchCaches = { domains: new Map() };
  const seen = new Set<string>();
  const jobs: string[] = [];
  for (const t of tokens) {
    const token = t.trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(token);
  }
  return mapLimit(jobs, cfg.concurrency, (token) => verifyOne(token, cfg, caches));
}

async function getDomainInfo(domain: string, caches: BatchCaches): Promise<DomainInfo> {
  const hit = caches.domains.get(domain);
  if (hit) return hit;
  const info = await lookupMailDomain(domain);
  caches.domains.set(domain, info);
  return info;
}

/**
 * Detect catch-all domains: if a clearly random address at the same domain is
 * also accepted, the server accepts everything and the target's "accepted"
 * proves nothing. Cached briefly to avoid repeated probing.
 */

async function checkCatchAll(
  domain: string,
  mxHosts: string[],
  cfg: VerifierConfig
): Promise<boolean | null> {
  const hit = catchAllCache.get(domain);
  if (hit && Date.now() - hit.at < CATCHALL_TTL_MS) return hit.value;

  const probeAddress = `zz-probe-${Math.random().toString(36).slice(2, 10)}@${domain}`;
  const { verdict } = await probeAcrossMx(probeAddress, mxHosts, cfg);

  let value: boolean | null;
  if (verdict.kind === "accepted") value = true;
  else if (verdict.kind === "rejected") value = false;
  else value = null;

  catchAllCache.set(domain, { at: Date.now(), value });
  return value;
}


function suggestionFor(local: string, domain: string): string | undefined {
  const alt = suggestDomain(domain);
  return alt ? `${local}@${alt}` : undefined;
}

function trimReply(reply: string): string {
  const t = reply.trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

async function probeAcrossMx(
  email: string,
  hosts: string[],
  cfg: VerifierConfig
): Promise<{ host: string; verdict: RcptVerdict }> {
  let last: { host: string; verdict: RcptVerdict } | undefined;

  for (const host of hosts) {
    const verdict = await probeRcpt(email, {
      host,
      heloDomain: cfg.heloDomain,
      mailFrom: cfg.mailFrom,
      connectTimeoutMs: cfg.connectTimeoutMs,
      commandTimeoutMs: cfg.commandTimeoutMs,
      overallTimeoutMs: cfg.overallTimeoutMs,
    });

    last = { host, verdict };

    if (
      verdict.kind === "unreachable" ||
      verdict.kind === "timeout" ||
      verdict.kind === "tempfail"
    ) {
      continue;
    }

    return last;
  }

  return last ?? {
    host: hosts[0] ?? "",
    verdict: {
      kind: "unreachable",
      detail: "No usable MX hosts were available to probe",
    },
  };
}

async function verifyOne(token: string, cfg: VerifierConfig, caches: BatchCaches): Promise<VerifyResult> {
  const checkedAt = new Date().toISOString();
  const parsed = parseEmailAddress(token);

  if (!parsed.ok) {
    return {
      input: token,
      email: token.trim(),
      status: "bounce",
      reason: `Invalid address — ${parsed.reason}.`,
      stage: "syntax",
      flags: emptyFlags(),
      checkedAt,
    };
  }

  const { local, domain, email } = parsed;
  const flags = {
    role: ROLE_LOCALS.has(local.toLowerCase()),
    disposable: DISPOSABLE_DOMAINS.has(domain),
    free: FREE_PROVIDERS.has(domain),
    implicitMx: false,
  };

  const info = await getDomainInfo(domain, caches);

  if (info.status === "dns-error") {
    return {
      input: token,
      email,
      status: "unknown",
      reason: `Could not look up the domain's mail servers (DNS failure: ${info.detail ?? "resolver error"}).`,
      stage: "dns",
      flags,
      checkedAt,
    };
  }
  if (info.status === "not-found") {
    return {
      input: token,
      email,
      status: "bounce",
      reason: "Domain does not exist — no DNS records were found.",
      stage: "dns",
      suggestion: suggestionFor(local, domain),
      flags,
      checkedAt,
    };
  }
  if (info.status === "no-mail") {
    const why =
      info.detail === "null-mx"
        ? "Domain explicitly does not accept mail (null MX record, RFC 7505)."
        : info.detail === "loopback MX"
          ? "Domain's MX record points at a loopback address — it cannot receive mail."
          : "Domain has no mail servers — no MX or address records.";
    return {
      input: token,
      email,
      status: "bounce",
      reason: why,
      stage: "dns",
      suggestion: suggestionFor(local, domain),
      flags,
      checkedAt,
    };
  }

  const mxHost = info.mxHost as string;
  const mxHosts = info.mxHosts?.length ? info.mxHosts : [mxHost];
  flags.implicitMx = info.implicitMx;

  if (!cfg.smtpEnabled) {
    return maybeSuggest(
      {
        input: token,
        email,
        status: "unknown",
        reason: "Domain can receive mail, but the mailbox-level SMTP check is disabled on this deployment.",
        stage: "smtp-disabled",
        mxHost,
        flags,
        checkedAt,
      },
      local,
      flags.free
    );
  }

  
const { host: verifiedHost, verdict } = await probeAcrossMx(
  email,
  mxHosts,
  cfg
);

const smtpResult = await classifySmtpVerdict(
  token,
  email,
  domain,
  verifiedHost,
  mxHosts,
  verdict,
  flags,
  checkedAt,
  cfg
);

return maybeSuggest(smtpResult, local, flags.free);
}

/**
 * Attach a typo suggestion to non-deliverable results, unless the domain is
 * itself a known provider. Typosquats like "gmial.com" often resolve, so a
 * dead-domain check alone would miss them.
 */
function maybeSuggest(result: VerifyResult, local: string, isKnownProvider: boolean): VerifyResult {
  if (result.suggestion) return result;
  if (result.status === "deliverable" || isKnownProvider) return result;
  const domain = result.email.slice(result.email.lastIndexOf("@") + 1);
  const suggestion = suggestionFor(local, domain);
  return suggestion ? { ...result, suggestion } : result;
}


async function classifySmtpVerdict(
  token: string,
  email: string,
  domain: string,
  mxHost: string,
  mxHosts: string[],
  verdict: RcptVerdict,
  flags: VerifyFlags,
  checkedAt: string,
  cfg: VerifierConfig
): Promise<VerifyResult> {

  switch (verdict.kind) {
    case "accepted": {
      const catchAll = await checkCatchAll(domain, mxHosts, cfg);
      if (catchAll === true) {
        return {
          input: token,
          email,
          status: "unknown",
          reason: `The server accepts every address at ${domain} (catch-all), so this mailbox cannot be confirmed.`,
          stage: "smtp-catchall",
          mxHost,
          smtpReply: trimReply(verdict.reply),
          flags,
          checkedAt,
        };
      }
      if (catchAll === null) {
        return {
          input: token,
          email,
          status: "unknown",
          reason: "The mail server accepted the address, but catch-all behaviour could not be ruled out — treat as unverified.",
          stage: "smtp-catchall",
          mxHost,
          smtpReply: trimReply(verdict.reply),
          flags,
          checkedAt,
        };
      }
      return {
        input: token,
        email,
        status: "deliverable",
        reason: "The mail server confirmed that this mailbox exists.",
        stage: "smtp",
        mxHost,
        smtpReply: trimReply(verdict.reply),
        flags,
        checkedAt,
      };
    }
    case "rejected":
      return {
        input: token,
        email,
        status: "bounce",
        reason: `The mail server rejected the address: ${trimReply(verdict.reply)}`,
        stage: "smtp",
        mxHost,
        smtpReply: trimReply(verdict.reply),
        flags,
        checkedAt,
      };
    case "tempfail":
      return {
        input: token,
        email,
        status: "unknown",
        reason: `The mail server returned a temporary error (often greylisting): ${trimReply(verdict.reply)}`,
        stage: "smtp",
        mxHost,
        smtpReply: trimReply(verdict.reply),
        flags,
        checkedAt,
      };
    case "unreachable": {
      const looksBlocked = /ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ECONNRESET|timed out/i.test(verdict.detail);
      return {
        input: token,
        email,
        status: "unknown",
        reason: `Could not reach the mail server ${mxHost} (${verdict.detail})${
          looksBlocked ? " — outbound port 25 is often blocked on hosted platforms" : ""
        }.`,
        stage: "smtp",
        mxHost,
        flags,
        checkedAt,
      };
    }
    case "timeout":
      return {
        input: token,
        email,
        status: "unknown",
        reason: `Timed out talking to ${mxHost} during ${verdict.stage} — ${verdict.detail}.`,
        stage: "smtp",
        mxHost,
        flags,
        checkedAt,
      };
    case "aborted":
      return {
        input: token,
        email,
        status: "unknown",
        reason: `The SMTP session could not complete (${verdict.stage}): ${verdict.detail}.`,
        stage: "smtp",
        mxHost,
        flags,
        checkedAt,
      };
  }
}

/** Simple concurrency-limited map that preserves input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}
