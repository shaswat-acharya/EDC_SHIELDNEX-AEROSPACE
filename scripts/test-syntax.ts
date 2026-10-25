/**
 * Unit tests for the syntax parser and typo suggestion logic.
 * Run: bun scripts/test-syntax.ts
 */

import { parseEmailAddress } from "../src/lib/email-verifier/syntax";
import { levenshtein, suggestDomain } from "../src/lib/email-verifier/levenshtein";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(pass ? "  PASS" : "  FAIL", "—", name, pass ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!pass) failures += 1;
}

// --- syntax: valid addresses ---
const VALID = [
  "simple@example.com",
  "first.last@sub.example.co.uk",
  "first+tag@example.com",
  "o'connor@example.com",
  "a@twoletters.io",
  "123456@example.museum",
  "a_b-c.d@example.com",
  "user@xn--e1afmkfd.xn--p1ai", // punycode IDN
  "<wrapped@example.com>",
  "  padded@example.com  ",
];
for (const v of VALID) {
  const r = parseEmailAddress(v);
  check(`valid: ${v}`, r.ok, true);
}

// --- syntax: invalid addresses (with reason snippets) ---
const INVALID: Array<[string, string]> = [
  ["@example.com", "missing @"],
  ["a@", "invalid domain length"],
  ["a@b", "at least two labels"],
  ["a@b.c", "invalid top-level domain"],
  ["a..b@example.com", "dot placement"],
  [".a@example.com", "dot placement"],
  ["a.@example.com", "dot placement"],
  ["a@exa_mple.com", "invalid domain label"],
  ["a@-example.com", "invalid domain label"],
  ["a@example..com", "invalid domain label"],
  ["a b@example.com", "whitespace"],
  ["üser@example.com", "non-ASCII"],
  ["a@localhost", "at least two labels"],
  ["a@[127.0.0.1]", "address literals"],
  ['"quoted"@example.com', "quoted local parts"],
  ["two@@example.com", "multiple @ signs"],
  ["a" + "x".repeat(64) + "@example.com", "local part"],
];
for (const [v, wantSnippet] of INVALID) {
  const r = parseEmailAddress(v);
  const snippetOk = !r.ok && r.reason.includes(wantSnippet);
  check(`invalid: ${v.slice(0, 34)}${v.length > 34 ? "…" : ""} (${wantSnippet})`, snippetOk, true);
}

// normalization
check(
  "domain lowercased",
  parseEmailAddress("User@EXAMPLE.COM"),
  { ok: true, local: "User", domain: "example.com", email: "User@example.com" }
);

// --- levenshtein ---
check("levenshtein(kitten, sitting) = 3", levenshtein("kitten", "sitting", 3), 3);
// Plain Levenshtein counts the "ia"→"ai" transposition in gmial→gmail as 2 substitutions.
check("levenshtein(gmial, gmail) = 2", levenshtein("gmial", "gmail", 3), 2);
check("levenshtein early exit > cap", levenshtein("aaaaa", "zzzzz", 2), 3);

// --- suggestions ---
check("suggest gmial.com → gmail.com", suggestDomain("gmial.com"), "gmail.com");
check("suggest gmail.con → gmail.com", suggestDomain("gmail.con"), "gmail.com");
check("suggest outlok.com → outlook.com", suggestDomain("outlok.com"), "outlook.com");
check("suggest gmial.com is not itself", suggestDomain("gmail.com"), undefined);
check("no suggestion for unrelated", suggestDomain("zqxxvuwycl.net"), undefined);
check("no suggestion for tiny domains", suggestDomain("ab.com"), undefined);

console.log(failures === 0 ? "\nAll syntax/suggestion tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
