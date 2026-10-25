# Worklog

---
Task ID: 1
Agent: Z.ai main agent
Task: Build "MailProbe" — a web application that checks pasted lists of email addresses and reports whether each is likely deliverable, likely to bounce, or unknown.

Work Log:
- Loaded fullstack-dev skill and initialized the Next.js 16 environment (port 3000, auto dev server).
- Built the verification engine in `src/lib/email-verifier/`:
  - `types.ts` — shared client/server types (DeliveryStatus: deliverable | bounce | unknown).
  - `syntax.ts` — pragmatic RFC-style parser (dot-atom local parts, label/TLD rules, 254-char limit, punycode IDN support, clear rejection reasons).
  - `data.ts` — curated lists: ~120 disposable domains, ~90 free providers, ~70 role local-parts, 25 common domains for typo detection.
  - `levenshtein.ts` — capped edit distance + typo suggestions (strict for short domains to avoid false matches).
  - `dns.ts` — MX resolution with A/AAAA implicit-MX fallback (RFC 5321 §5.1), null-MX detection (RFC 7505), NXDOMAIN vs resolver-error classification, 5-min TTL cache.
  - `smtp.ts` — minimal SMTP client: connect → 220 → EHLO → opportunistic STARTTLS (HELO fallback) → MAIL FROM (null sender) → RCPT TO → QUIT. NEVER issues DATA, so no message is ever sent. Multi-line reply parser, per-command + overall timeouts, careful socket error classification.
  - `index.ts` — orchestrator: per-batch DNS memoization, module-level catch-all detection cache (random-address probe), concurrency-limited (4) processing, typo suggestions on non-deliverable results, uniform three-way classification.
- API route `src/app/api/verify/route.ts`: POST (zod-validated, ≤50 addresses, 40 req/min rate limit per client) + GET (config report). Node runtime.
- Frontend: `src/app/page.tsx` (paste area with extraction/dedupe from `src/lib/email-extract.ts`, chunked progressive verification, stop button, stat cards, filter tabs, CSV/JSON export), `src/components/verifier/` (stat-cards, results-table, how-it-works, theme-toggle). Dark/light theme via next-themes, emerald/amber/red status palette, sticky footer, responsive, ARIA labels, custom thin scrollbars.
- `README.md`: documents the three verdicts, what the deployed version can check (syntax/DNS/signals — verified working) and cannot (SMTP mailbox probes — port 25 is blocked in this hosting environment, verified: ETIMEDOUT to gmail MX), safety design (no DATA command), env vars, API, limitations, ethics.
- Tests: `scripts/test-smtp.ts` (6/6 pass — SMTP state machine vs local fake MX server, incl. STARTTLS-refused fallback and connection refused), `scripts/test-syntax.ts` (all pass — 10 valid, 17 invalid, normalization, levenshtein, suggestions).
- Fixes during verification: empty ETIMEDOUT error message → now includes errno code + port-25 hint; short-domain false typo suggestions → distance threshold scaled by length; lint error in theme-toggle → useSyncExternalStore mounted pattern; typo suggestions now also fire for resolvable typosquat domains.
- E2E verified with agent-browser: page render (desktop 1440px + mobile 390px), load sample, run check (progress UI, stop button), results table with all statuses/reasons/flags/suggestions, filter tabs, CSV export, clear, theme toggle, toasts, sticky footer, zero console/page errors, clean dev.log, `bun run lint` clean.

Stage Summary:
- Deliverable: runnable Next.js app at `/` (MailProbe) + `README.md` + test scripts under `scripts/`.
- Key decision: honest three-way classification — "unknown" is a first-class result for catch-alls, greylisting, unreachable servers; port-25-blocked hosts get clear reasons on every unknown.
- Environment fact worth remembering: this sandbox blocks outbound TCP 25 (SMTP probes → ETIMEDOUT), but DNS (UDP 53) works — so syntax/DNS/signals all verify live; SMTP client logic is proven via the fake-MX test suite.
