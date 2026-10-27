/**
 * A minimal, careful SMTP client for mailbox existence probing.
 *
 * It performs the classic verification handshake:
 *
 *   connect → wait 220 → EHLO → (opportunistic STARTTLS) → MAIL FROM → RCPT TO → QUIT
 *
 * and stops there. The DATA command is NEVER issued, so no message of any
 * kind is transmitted to the recipient — this is a read-only probe of the
 * server's response to RCPT TO.
 */

import net from "node:net";
import tls from "node:tls";

export interface SmtpProbeConfig {
  host: string;
  port?: number;
  /** HELO/EHLO identifying name (configurable, e.g. via EMAIL_VERIFY_HELO). */
  heloDomain: string;
  /** Bare sender address for MAIL FROM. Empty string = RFC 5321 null sender `<>`. */
  mailFrom: string;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  overallTimeoutMs?: number;
  disableStarttls?: boolean;
}

export type RcptVerdict =
  | { kind: "accepted"; reply: string }
  | { kind: "rejected"; reply: string }
  | { kind: "tempfail"; reply: string }
  | { kind: "unreachable"; detail: string }
  | { kind: "timeout"; stage: string; detail: string }
  | { kind: "aborted"; stage: string; detail: string };

interface Reply {
  code: number;
  /** Joined human-readable text of all reply lines. */
  text: string;
  /** The final raw line, e.g. "550 5.1.1 user unknown". */
  raw: string;
}

type Step = "greeting" | "ehlo" | "starttls" | "helo" | "mailfrom" | "rcpt" | "quit";

const QUIT_GRACE_MS = 1500;

export function probeRcpt(email: string, cfg: SmtpProbeConfig): Promise<RcptVerdict> {
  if (/[\r\n]/.test(email)) {
    return Promise.resolve({ kind: "aborted", stage: "input", detail: "address contains control characters" });
  }

  const port = cfg.port ?? 25;
  const connectTimeoutMs = cfg.connectTimeoutMs ?? 6000;
  const commandTimeoutMs = cfg.commandTimeoutMs ?? 8000;
  const overallMs = cfg.overallTimeoutMs ?? 16000;
  const overallDeadline = Date.now() + overallMs;

  return new Promise<RcptVerdict>((resolve) => {
    let socket: net.Socket | tls.TLSSocket;
    let lines: string[] = [];
    let remainder = "";
    let step: Step = "greeting";
    let starttlsDone = false;
    let settled = false;
    let pendingVerdict: RcptVerdict | null = null;
    let commandTimer: ReturnType<typeof setTimeout> | null = null;

    const settle = (v: RcptVerdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      if (commandTimer) clearTimeout(commandTimer);
      try {
        socket?.destroy();
      } catch {
        /* already gone */
      }
      resolve(v);
    };

    const overallTimer = setTimeout(() => {
      settle({ kind: "timeout", stage: "overall", detail: `exceeded the ${overallMs}ms budget` });
    }, overallMs);

    const armTimer = (stage: string, ms: number) => {
      if (commandTimer) clearTimeout(commandTimer);
      const remaining = Math.max(0, Math.min(ms, overallDeadline - Date.now()));
      commandTimer = setTimeout(() => {
        settle({ kind: "timeout", stage, detail: `no reply from the server for ${ms}ms` });
      }, remaining);
    };

    const send = (line: string) => {
      try {
        socket.write(`${line}\r\n`);
      } catch {
        /* write after destroy — the error/close handler takes over */
      }
    };

    const fromSpec = cfg.mailFrom ? `MAIL FROM:<${cfg.mailFrom}>` : "MAIL FROM:<>";

    /** Send QUIT and settle after the server acknowledges (or times out). */
    const finishWith = (v: RcptVerdict) => {
      pendingVerdict = v;
      step = "quit";
      send("QUIT");
      armTimer("QUIT", QUIT_GRACE_MS);
    };

    const processLines = () => {
      while (!settled && lines.length > 0) {
        // Drop stray non-reply noise that appears before a reply.
        if (!/^\d{3}[- ]?/.test(lines[0])) {
          lines.shift();
          continue;
        }
        // A reply is complete once a non-continuation line ("250 ", "550", ...) is seen.
        let finalIdx = -1;
        for (let i = 0; i < lines.length; i++) {
          if (/^\d{3}-/.test(lines[i])) continue;
          if (/^\d{3}( |$)/.test(lines[i])) {
            finalIdx = i;
            break;
          }
          break; // malformed line inside a reply — wait for more data
        }
        if (finalIdx === -1) return;

        const replyLines = lines.splice(0, finalIdx + 1);
        const code = Number.parseInt(replyLines[0].slice(0, 3), 10);
        if (!Number.isFinite(code)) return;
        const text = replyLines.map((l) => l.replace(/^\d{3}[ -]/, "")).join(" ");
        handleReply({ code, text, raw: replyLines[finalIdx].slice(0, 240) });
      }
    };

    const attach = (s: net.Socket | tls.TLSSocket) => {
      s.setEncoding("utf8");
      s.on("data", (chunk: string) => {
        if (settled) return;
        remainder += chunk;
        let nl = remainder.indexOf("\n");
        while (nl >= 0) {
          const line = remainder.slice(0, nl).replace(/\r$/, "");
          remainder = remainder.slice(nl + 1);
          lines.push(line);
          nl = remainder.indexOf("\n");
        }
        processLines();
      });
      s.on("error", (err: Error) => {
        const code = (err as NodeJS.ErrnoException).code;
        const detail = [code, err.message].filter(Boolean).join(" — ") || "connection failed";
        settle({ kind: "unreachable", detail });
      });
      s.on("close", () => {
        if (step === "quit" && pendingVerdict) {
          settle(pendingVerdict);
          return;
        }
        settle({ kind: "aborted", stage: step, detail: "connection closed by the server" });
      });
    };

    const handleReply = (reply: Reply) => {
      switch (step) {
        case "greeting": {
          if (reply.code === 220) {
            send(`EHLO ${cfg.heloDomain}`);
            step = "ehlo";
            armTimer("EHLO", commandTimeoutMs);
          } else {
            settle({ kind: "aborted", stage: "greeting", detail: `server refused the connection (code ${reply.code})` });
          }
          break;
        }
        case "ehlo": {
          if (reply.code === 250) {
            const caps = reply.text.toLowerCase();
            if (!starttlsDone && !cfg.disableStarttls && caps.includes("starttls")) {
              send("STARTTLS");
              step = "starttls";
              armTimer("STARTTLS", commandTimeoutMs);
            } else {
              send(fromSpec);
              step = "mailfrom";
              armTimer("MAIL FROM", commandTimeoutMs);
            }
          } else if (reply.code === 500 || reply.code === 502 || reply.code === 550) {
            // Very old server — retry with HELO.
            send(`HELO ${cfg.heloDomain}`);
            step = "helo";
            armTimer("HELO", commandTimeoutMs);
          } else {
            settle({ kind: "aborted", stage: "EHLO", detail: `EHLO rejected (code ${reply.code})` });
          }
          break;
        }
        case "starttls": {
          if (reply.code === 220) {
            try {
              const raw = socket;
              raw.removeAllListeners("data");
              raw.removeAllListeners("error");
              raw.removeAllListeners("close");
              raw.pause();

              const tlsSocket = tls.connect(
                { socket: raw as net.Socket, servername: cfg.host, rejectUnauthorized: false },
                () => {
                  socket = tlsSocket;
                  lines = [];
                  remainder = "";
                  starttlsDone = true;
                  attach(tlsSocket);
                  send(`EHLO ${cfg.heloDomain}`);
                  step = "ehlo";
                  armTimer("EHLO after STARTTLS", commandTimeoutMs);
                }
              );
              tlsSocket.on("error", (err: Error) => {
                settle({ kind: "aborted", stage: "STARTTLS", detail: `TLS upgrade failed: ${err.message}` });
              });
              socket = tlsSocket;
            } catch (err) {
              settle({ kind: "aborted", stage: "STARTTLS", detail: `TLS upgrade failed: ${(err as Error).message}` });
            }
          } else {
            // Server refused STARTTLS — continue in plaintext.
            send(fromSpec);
            step = "mailfrom";
            armTimer("MAIL FROM", commandTimeoutMs);
          }
          break;
        }
        case "helo": {
          if (reply.code === 250) {
            send(fromSpec);
            step = "mailfrom";
            armTimer("MAIL FROM", commandTimeoutMs);
          } else {
            settle({ kind: "aborted", stage: "HELO", detail: `HELO rejected (code ${reply.code})` });
          }
          break;
        }
        case "mailfrom": {
          if (reply.code === 250) {
            send(`RCPT TO:<${email}>`);
            step = "rcpt";
            armTimer("RCPT TO", commandTimeoutMs);
          } else if (reply.code >= 500) {
            settle({
              kind: "aborted",
              stage: "MAIL FROM",
              detail: `the server rejected our sender address (code ${reply.code}) — this mailbox cannot be judged`,
            });
          } else {
            settle({ kind: "aborted", stage: "MAIL FROM", detail: `temporary failure at MAIL FROM (code ${reply.code})` });
          }
          break;
        }
        case "rcpt": {
          if (reply.code >= 200 && reply.code < 300) {
            finishWith({ kind: "accepted", reply: reply.raw });
          } else if (reply.code >= 500) {
            finishWith({ kind: "rejected", reply: reply.raw });
          } else if (reply.code >= 400) {
            finishWith({ kind: "tempfail", reply: reply.raw });
          } else {
            settle({ kind: "aborted", stage: "RCPT TO", detail: `unexpected reply code ${reply.code}` });
          }
          break;
        }
        case "quit": {
          if (pendingVerdict) settle(pendingVerdict);
          break;
        }
      }
    };

    socket = net.createConnection({ host: cfg.host, port });
    socket.setTimeout(connectTimeoutMs);
    socket.once("timeout", () => {
      settle({
        kind: "unreachable",
        detail: `connect timed out after ${connectTimeoutMs}ms`,
      });
    });
    socket.once("connect", () => {
      socket.setTimeout(0);
      armTimer("greeting", commandTimeoutMs);
    });
    attach(socket);
  });
}
