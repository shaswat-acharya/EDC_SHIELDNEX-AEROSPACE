/**
 * Practical RFC 5321/5322-style address parsing.
 *
 * Deliberately pragmatic: it accepts the common "dot-atom" form that covers
 * virtually every real-world address, and rejects the exotic forms (quoted
 * local parts, source routes, address literals) with a clear reason instead
 * of silently mis-handling them.
 *
 * Pure module — no Node.js imports, safe on the client.
 */

/** atext characters permitted in a dot-atom local part. */
const ATEXT = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]";
const LOCAL_RE = new RegExp(`^${ATEXT}+(?:\\.${ATEXT}+)*$`);
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export type ParseResult =
  | { ok: true; local: string; domain: string; email: string }
  | { ok: false; reason: string };

export function parseEmailAddress(rawInput: string): ParseResult {
  let raw = rawInput.trim();

  // Unwrap paste formats like: Name <user@host> or "user@host",
  if (raw.startsWith("<") && raw.endsWith(">") && raw.length > 2) {
    raw = raw.slice(1, -1).trim();
  }
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 2) {
    raw = raw.slice(1, -1).trim();
  }

  if (!raw) return { ok: false, reason: "the address is empty" };
  if (raw.length > 254) return { ok: false, reason: "longer than the 254-character limit" };
  if (/\s/.test(raw)) return { ok: false, reason: "contains whitespace" };
  if (/[\u0080-\uFFFF]/.test(raw)) {
    return { ok: false, reason: "contains non-ASCII characters (internationalized addresses are not supported)" };
  }

  const at = raw.lastIndexOf("@");
  if (at < 1) return { ok: false, reason: "missing @ or empty local part" };
  if (raw.slice(0, at).includes("@")) {
    return { ok: false, reason: "multiple @ signs" };
  }

  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1).toLowerCase();

  // --- local part ---
  if (local.startsWith('"')) {
    return { ok: false, reason: "quoted local parts are not supported" };
  }
  if (local.length === 0 || local.length > 64) {
    return { ok: false, reason: "local part must be 1–64 characters" };
  }
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return { ok: false, reason: "invalid dot placement in the local part" };
  }
  if (!LOCAL_RE.test(local)) {
    return { ok: false, reason: "invalid characters in the local part" };
  }

  // --- domain ---
  if (domain.startsWith("[")) {
    return { ok: false, reason: "address literals (IP domains) are not supported" };
  }
  if (domain.length === 0 || domain.length > 253) {
    return { ok: false, reason: "invalid domain length" };
  }
  const labels = domain.split(".");
  if (labels.length < 2) {
    return { ok: false, reason: "domain must have at least two labels (name.tld)" };
  }
  for (const label of labels) {
    if (!LABEL_RE.test(label)) {
      return { ok: false, reason: `invalid domain label "${label.slice(0, 20)}"` };
    }
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,63}$/.test(tld) && !/^xn--[a-z0-9-]{2,}$/.test(tld)) {
    return { ok: false, reason: "invalid top-level domain" };
  }

  return { ok: true, local, domain, email: `${local}@${domain}` };
}
