# MailProbe — Email Deliverability Checker

A small web application that checks a pasted list of email addresses and reports, for each one,
whether it is **likely to be delivered**, **likely to bounce**, or **unknown**.

Paste a list (one per line, comma-separated, or mixed into text) and every address runs through
the same pipeline: syntax validation → DNS / MX lookup → (when reachable) an SMTP mailbox probe.
Results stream in progressively, can be filtered by verdict, and export to CSV/JSON.

> **No email is ever sent.** The SMTP probe is a handshake that ends with `QUIT` immediately
> after the server answers `RCPT TO`. The `DATA` command — the only step that transmits a
> message body — is never issued. See [Safety](#safety--ethics).

---

## The three verdicts

| Verdict | Meaning |
| --- | --- |
| **Likely deliverable** | Syntax is valid, the domain has mail servers, and the mail server explicitly accepted the address (and the domain is not a catch-all). |
| **Likely to bounce** | The address is syntactically broken, the domain is dead or accepts no mail, or the server explicitly rejected the recipient. |
| **Unknown** | The mailbox's existence could not be confirmed — catch-all domains, greylisting, unreachable servers, disabled SMTP checks, DNS trouble. |

**"Unknown" is a first-class, valid answer.** Many mail providers deliberately never confirm
whether a mailbox exists (to prevent address harvesting), and catch-all servers accept every
address at a domain, making confirmation logically impossible. A tool that never returns
"unknown" is a tool that is lying to you.

---

## What this deployment can and cannot check

The application in this sandbox was verified against live DNS. Its outbound connections to
**TCP port 25 are blocked by the hosting environment** (connections to `gmail-smtp-in.l.google.com:25`
and other MX hosts time out with `ETIMEDOUT`). This is normal — most cloud and shared hosting
providers block outbound port 25 to fight spam. Here is the honest breakdown:

### ✅ Always works (needs only DNS, which is allowed here)

- **Syntax validation** — RFC-style parsing: local-part length/dot rules, domain labels, TLD shape,
  254-character limit, whitespace/control-character rejection, punycode IDN domains.
- **Normalization & deduplication** — domains lowercased, duplicates folded (case-insensitive),
  paste formats like `Name <a@b.com>` handled.
- **Domain existence** — dead domains (`NXDOMAIN`) are reported as *likely to bounce*.
- **Mail-route checks** — MX records (with A/AAAA *implicit-MX* fallback per RFC 5321 §5.1, and
  null-MX detection per RFC 7505). A domain that cannot receive mail is a bounce.
- **Signals** — disposable/throwaway domain detection, role-account detection (`info@`, `admin@`, …),
  free-provider tagging, and typo suggestions ("did you mean `jane@gmail.com`?" for `gmial.com`).

### ⚠️ Does not work from this hosted environment

- **Mailbox-level SMTP verification.** Because outbound port 25 is blocked, the probe can never
  complete a conversation with the recipient's mail server. Every SMTP-dependent check returns
  **Unknown** with the reason *"Could not reach the mail server … — outbound port 25 is often
  blocked on hosted platforms."* Syntax and DNS verdicts are unaffected and remain trustworthy.
- **Catch-all detection** also depends on a completed SMTP conversation, so on a blocked host it
  is likewise unavailable.

### 🖥️ Running locally for full mailbox checks

On a typical home/office connection, outbound port 25 is open, and the same codebase performs the
complete check, including per-mailbox verification and catch-all detection:

```bash
bun install        # or: npm install
bun run dev        # or: npm run dev   → http://localhost:3000
```

Some ISPs also block port 25; if every SMTP result is Unknown with a connect timeout, that is
what is happening. Corporate networks may additionally intercept SMTP.

---

## How the SMTP probe works (and why it is safe)

For each address at a reachable domain, MailProbe opens **one** TCP connection to the domain's
highest-priority MX host and speaks the minimum SMTP needed to ask one question:

```
S: 220 mx.example ESMTP            ← server greeting
C: EHLO mailprobe.local            ← identify ourselves
S: 250-STARTTLS / 250 OK           ← capabilities (STARTTLS upgraded opportunistically)
C: MAIL FROM:<>                    ← RFC 5321 null sender (a bounce-style envelope, no real identity)
S: 250 2.1.0 OK
C: RCPT TO:<user@example.com>      ← the actual question: does this mailbox exist?
S: 250 2.1.5 OK   → deliverable    ← or 550 = rejected → bounce, or 4xx = unknown (greylisting)
C: QUIT                            ← session ends HERE
```

- The `DATA` command is **never issued** — the only SMTP verb that transmits message content.
  Nothing is delivered to the recipient, ever.
- A null sender (`MAIL FROM:<>`) is used so no real mailbox or domain is impersonated.
- If the server accepts a random probe address (`zz-probe-…@domain`) too, the domain is
  **catch-all**, and the address is reported **Unknown** rather than falsely "deliverable".

---

## Configuration

All settings are environment variables (sensible defaults — nothing needs configuring):

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMAIL_VERIFY_SMTP` | `true` | Set `false` to disable SMTP probing entirely (syntax/DNS only). |
| `EMAIL_VERIFY_HELO` | `mailprobe.local` | The name sent in `EHLO`. Set it to a domain you control if a receiving server rejects unknown HELO names. |
| `EMAIL_VERIFY_MAIL_FROM` | *(empty = null sender `<>`)* | The envelope sender for `MAIL FROM`. Set it to an address you control if you prefer. |
| `EMAIL_VERIFY_TIMEOUT_CONNECT` | `6000` | TCP connect timeout (ms). |
| `EMAIL_VERIFY_TIMEOUT_COMMAND` | `8000` | Per-SMTP-command timeout (ms). |
| `EMAIL_VERIFY_TIMEOUT_OVERALL` | `16000` | Total budget per probe (ms). |
| `EMAIL_VERIFY_CONCURRENCY` | `4` | Parallel SMTP conversations per batch. |

## API

| Route | Description |
| --- | --- |
| `GET /api/verify` | Returns the deployment's verifier configuration. |
| `POST /api/verify` | Body `{"emails": ["a@b.com", …]}` (≤ 50 per call) → `{ results: [...], meta }`. Rate-limited to 40 requests/minute per client. |

Result object shape:

```jsonc
{
  "input": "jane.doe@gmial.com",
  "email": "jane.doe@gmial.com",
  "status": "bounce",              // "deliverable" | "bounce" | "unknown"
  "reason": "Domain does not exist — no DNS records were found.",
  "stage": "dns",                  // syntax | dns | smtp | smtp-catchall | smtp-disabled
  "mxHost": null,
  "smtpReply": null,               // final SMTP reply line, when one was received
  "suggestion": "jane.doe@gmail.com",
  "flags": { "role": false, "disposable": false, "free": false, "implicitMx": false },
  "checkedAt": "2026-10-25T09:08:10.662Z"
}
```

## Limitations & honest caveats

- **Anti-harvesting servers** may return `550` for *every* `RCPT TO` during a probe — such
  addresses would be reported "likely to bounce" even if the mailbox exists. This is an inherent
  limitation of the technique shared by every SMTP-verification tool.
- **Greylisting** (4xx temporary failures) intentionally returns Unknown, not bounce.
- **Static lists** for disposable/role/free detection are curated but not exhaustive; they are
  signals, never the sole basis for a bounce verdict.
- **Internationalized addresses** with non-ASCII characters are rejected as unsupported
  (punycode domains like `xn--…` are accepted).
- **Case sensitivity**: duplicate folding treats addresses as case-insensitive, which matches
  how virtually all mail systems behave in practice.
- **Not a guarantee.** A "deliverable" mailbox can still refuse a real message later (quota,
  content filtering, policy). This is a best-effort estimator.

## Safety & ethics

- No message is ever transmitted — the probe quits before the `DATA` stage (see above).
- Low concurrency (default 4 connections at a time), short timeouts, brief in-memory caching of
  DNS and catch-all results, and per-client rate limiting keep the footprint small.
- Do **not** use this tool to enumerate mailboxes at scale or against domains you have no
  relationship with — that is abusive of the servers being queried and may violate their terms
  or local law (e.g., anti-harvesting provisions). It is built for cleaning *your own* contact
  lists.
- `MAIL FROM` and `EHLO` names are configurable so operators can identify their probes honestly.

## Tests

The verification engine ships with a self-contained test suite:

```bash
bun scripts/test-smtp.ts    # SMTP client state machine vs. a local fake MX server
bun scripts/test-syntax.ts  # syntax parser + typo suggestion edge cases
```

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Node `dns` + `net`/`tls`
for DNS and SMTP — no third-party verification service is called; everything runs in-process.
