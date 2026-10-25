/**
 * Client-safe extraction of candidate email tokens from pasted text.
 *
 * Handles the formats people actually paste: one address per line,
 * comma/semicolon separated, "Name <address>" lists, or free-form text.
 * Tokens that don't contain "@" are treated as non-emails and ignored;
 * tokens that do are sent to the server, which applies strict validation.
 *
 * Pure module — no Node.js imports.
 */

const SPLIT_RE = /[\s,;:"'<>()[\]{}|\\]+/;

/** Candidate tokens containing an "@". */
export function extractEmailTokens(text: string): string[] {
  return text
    .split(SPLIT_RE)
    .map((t) => t.replace(/^[.\-]+/, "").replace(/[.!,?;:]+$/, ""))
    .filter((t) => t.includes("@") && t.length > 3 && t.length <= 320);
}

export interface ExtractedEmails {
  /** Deduplicated candidate tokens, capped. */
  tokens: string[];
  /** Number of duplicates dropped (case-insensitive). */
  duplicates: number;
  /** True when the cap was hit and some addresses were not included. */
  truncated: boolean;
}

export function dedupeTokens(tokens: string[], cap: number): ExtractedEmails {
  const seen = new Set<string>();
  const out: string[] = [];
  let duplicates = 0;
  let truncated = false;

  for (const t of tokens) {
    const key = t.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    if (out.length >= cap) {
      truncated = true;
      continue;
    }
    out.push(t);
  }

  return { tokens: out, duplicates, truncated };
}
