/**
 * SMTP probe client unit test against a local fake SMTP server.
 *
 * Validates the EHLO → MAIL FROM → RCPT TO → QUIT state machine,
 * multi-line reply parsing, plaintext fallback after STARTTLS refusal,
 * and error classification. Run: bun scripts/test-smtp.ts
 */

import net from "node:net";
import { probeRcpt } from "../src/lib/email-verifier/smtp";

interface FakeServerOptions {
  port: number;
  /** Reply line for RCPT TO (given the recipient address). */
  rcptReply: (email: string) => string;
  /** If true, advertise STARTTLS then answer it with 454 (not available). */
  fakeStarttls?: boolean;
}

function startFakeServer(opts: FakeServerOptions): Promise<net.Server> {
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.write("220 fake.example ESMTP ready\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
          if (opts.fakeStarttls) {
            socket.write("250-fake.example greets you\r\n250-STARTTLS\r\n250 SIZE 10485760\r\n");
          } else {
            socket.write("250-fake.example greets you\r\n250-8BITMIME\r\n250 SIZE 10485760\r\n");
          }
        } else if (cmd.startsWith("STARTTLS")) {
          socket.write("454 4.7.0 TLS not available\r\n");
        } else if (cmd.startsWith("MAIL FROM")) {
          socket.write("250 2.1.0 OK\r\n");
        } else if (cmd.startsWith("RCPT TO")) {
          const m = /<([^>]*)>/.exec(line);
          socket.write(`${opts.rcptReply(m?.[1] ?? "")}\r\n`);
        } else if (cmd.startsWith("QUIT")) {
          socket.write("221 2.0.0 Bye\r\n");
          socket.end();
        } else {
          socket.write("500 5.5.2 Unrecognized command\r\n");
        }
        nl = buffer.indexOf("\n");
      }
    });
    socket.on("error", () => {
      /* client hung up */
    });
  });
  return new Promise((resolve) => server.listen(opts.port, "127.0.0.1", () => resolve(server)));
}

interface TestCase {
  name: string;
  expect: string;
  server?: FakeServerOptions;
}

const CASES: TestCase[] = [
  {
    name: "mailbox accepted (250)",
    expect: "accepted",
    server: { port: 25251, rcptReply: () => "250 2.1.5 Recipient OK" },
  },
  {
    name: "mailbox rejected (550)",
    expect: "rejected",
    server: { port: 25252, rcptReply: () => "550 5.1.1 User unknown" },
  },
  {
    name: "greylisted (451)",
    expect: "tempfail",
    server: { port: 25253, rcptReply: () => "451 4.7.1 Greylisted, try again later" },
  },
  {
    name: "selective acceptance by address",
    expect: "accepted",
    server: { port: 25254, rcptReply: (e) => (e === "alice@test.dev" ? "250 2.1.5 OK" : "550 nope") },
  },
  {
    name: "STARTTLS refused → falls back to plaintext",
    expect: "accepted",
    server: { port: 25255, rcptReply: () => "250 2.1.5 OK", fakeStarttls: true },
  },
];

async function main(): Promise<void> {
  let failures = 0;

  for (const c of CASES) {
    const server = c.server ? await startFakeServer(c.server) : null;
    const verdict = await probeRcpt("alice@test.dev", {
      host: "127.0.0.1",
      port: c.server?.port ?? 0,
      heloDomain: "tester.local",
      mailFrom: "",
      connectTimeoutMs: 3000,
      commandTimeoutMs: 3000,
      overallTimeoutMs: 8000,
    });
    const pass = verdict.kind === c.expect;
    console.log(pass ? "  PASS" : "  FAIL", "—", c.name, "→", JSON.stringify(verdict));
    if (!pass) failures += 1;
    if (server) await new Promise<void>((r) => server.close(() => r()));
  }

  // No listener on this port → immediate ECONNREFUSED → unreachable
  const refused = await probeRcpt("alice@test.dev", {
    host: "127.0.0.1",
    port: 25999,
    heloDomain: "tester.local",
    mailFrom: "",
    connectTimeoutMs: 2000,
    commandTimeoutMs: 2000,
    overallTimeoutMs: 5000,
  });
  const refusedPass = refused.kind === "unreachable";
  console.log(refusedPass ? "  PASS" : "  FAIL", "— connection refused →", JSON.stringify(refused));
  if (!refusedPass) failures += 1;

  console.log(failures === 0 ? "\nAll SMTP client tests passed." : `\n${failures} test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
