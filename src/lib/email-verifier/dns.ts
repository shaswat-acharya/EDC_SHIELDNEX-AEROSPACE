/**
 * Domain mail-routing lookup: MX records with A/AAAA fallback (implicit MX),
 * plus null-MX (RFC 7505) handling.
 *
 * Results are cached in-process for a short TTL so repeated checks of the
 * same domain don't hammer the resolver.
 */

import dns from "node:dns/promises";

export type DomainStatus = "ok" | "not-found" | "no-mail" | "dns-error";

export interface DomainInfo {
  domain: string;
  status: DomainStatus;
  /** First-choice MX host. */
  mxHost: string | null;
  /** Ordered MX hosts, from highest priority to lowest. */
  mxHosts?: string[];
  /** True when there was no MX record and the A/AAAA record is used instead. */
  implicitMx: boolean;
  /** Extra context, e.g. "null-mx". */
  detail?: string;
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; info: DomainInfo }>();

function errCode(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export async function lookupMailDomain(domain: string): Promise<DomainInfo> {
  const key = domain.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.info;

  const info = await computeDomainInfo(key);
  cache.set(key, { at: Date.now(), info });
  if (cache.size > CACHE_MAX) {
    // drop the ~100 oldest entries
    let dropped = 0;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (++dropped >= 100) break;
    }
  }
  return info;
}

async function computeDomainInfo(domain: string): Promise<DomainInfo> {
  let mxErrorCode: string | undefined;
  let sawNullMx = false;

  try {
    const records = await dns.resolveMx(domain);
    const usable = records
      .filter((r) => typeof r.exchange === "string" && r.exchange.trim() !== "" && r.exchange !== ".")
      .sort((a, b) => a.priority - b.priority);

    
if (usable.length > 0) {
  const hosts = usable.map((r) => r.exchange.toLowerCase().trim());
  const host = hosts[0];

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1"
  ) {
    return {
      domain,
      status: "no-mail",
      mxHost: null,
      implicitMx: false,
      detail: "loopback MX",
    };
  }

  return {
    domain,
    status: "ok",
    mxHost: host,
    mxHosts: hosts,
    implicitMx: false,
  };
}


    sawNullMx = records.some((r) => r.exchange === ".");
    mxErrorCode = "EMPTY";
  } catch (err) {
    mxErrorCode = errCode(err) ?? "UNKNOWN";
  }

  // No usable MX. RFC 5321 §5.1: fall back to the domain's address records (implicit MX).
  let aNotFound = mxErrorCode === "ENOTFOUND";
  let sawResolverError = mxErrorCode !== "ENOTFOUND" && mxErrorCode !== "ENODATA" && mxErrorCode !== "EMPTY";

  try {
    const v4 = await dns.resolve4(domain);
    if (v4.length > 0) {
      return { domain, status: "ok", mxHost: domain, implicitMx: true, detail: "no MX record — using the A record as implicit MX" };
    }
  } catch (err) {
    const code = errCode(err) ?? "UNKNOWN";
    if (code === "ENOTFOUND") aNotFound = true;
    else if (code !== "ENODATA" && code !== "EMPTY") sawResolverError = true;
  }

  try {
    const v6 = await dns.resolve6(domain);
    if (v6.length > 0) {
      return { domain, status: "ok", mxHost: domain, implicitMx: true, detail: "no MX record — using the AAAA record as implicit MX" };
    }
  } catch (err) {
    const code = errCode(err) ?? "UNKNOWN";
    if (code === "ENOTFOUND") aNotFound = true;
    else if (code !== "ENODATA" && code !== "EMPTY") sawResolverError = true;
  }

  if (sawResolverError) {
    return { domain, status: "dns-error", mxHost: null, implicitMx: false, detail: `resolver error (${mxErrorCode ?? "?"})` };
  }
  if (aNotFound) {
    return { domain, status: "not-found", mxHost: null, implicitMx: false, detail: "NXDOMAIN" };
  }
  if (sawNullMx) {
    return { domain, status: "no-mail", mxHost: null, implicitMx: false, detail: "null-mx" };
  }
  return { domain, status: "no-mail", mxHost: null, implicitMx: false, detail: "no MX or address records" };
}
