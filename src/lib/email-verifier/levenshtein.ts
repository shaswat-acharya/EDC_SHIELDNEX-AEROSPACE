/**
 * Levenshtein distance + domain typo suggestions.
 * Pure module — safe on the client.
 */

import { COMMON_EMAIL_DOMAINS } from "./data";

/**
 * Edit distance between `a` and `b`.
 * Returns the exact distance when it is <= `cap`, otherwise `cap + 1`.
 */
export function levenshtein(a: string, b: string, cap = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const substitution = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, substitution);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1; // early exit — already too far
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[b.length];
}

/**
 * If `domain` looks like a typo of a common provider (gmial.com → gmail.com),
 * return the likely intended domain.
 */
export function suggestDomain(domain: string): string | undefined {
  const d = domain.toLowerCase();
  if (COMMON_EMAIL_DOMAINS.includes(d)) return undefined;
  if (d.length < 5 || d.length > 40) return undefined;

  // Short domains can't afford 2-edit matches ("ab.com" is 2 edits from
  // "me.com" but obviously not a typo of it), so be stricter for them.
  const maxDist = d.length <= 8 ? 1 : 2;

  let best: string | undefined;
  let bestDist = maxDist + 1;
  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const dist = levenshtein(d, candidate, maxDist);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
      if (dist === 1) break; // a 1-edit match is good enough
    }
  }
  return best;
}
