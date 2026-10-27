/**
 * POST /api/verify — check a batch of email addresses.
 * GET  /api/verify — report the verifier configuration for this deployment.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVerifierConfigFromEnv, verifyEmails } from "@/lib/email-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 50;

const BodySchema = z.object({
  emails: z
    .array(z.string().min(1).max(320))
    .min(1, "at least one address is required")
    .max(MAX_BATCH, `at most ${MAX_BATCH} addresses per request`),
});

// --- tiny in-memory rate limiter (per client) ---
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 40;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(clientKey: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(clientKey);
  if (!bucket || now > bucket.resetAt) {
    if (buckets.size > 10_000) buckets.clear();
    buckets.set(clientKey, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

function clientKeyOf(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "local";
}

export async function POST(req: NextRequest) {
  const key = clientKeyOf(req);
  if (rateLimited(key)) {
    return NextResponse.json(
      { error: "Too many requests — slow down and try again in a minute." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsedBody = BodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsedBody.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }

  const cfg = getVerifierConfigFromEnv();
  const startedAt = Date.now();
  const results = await verifyEmails(parsedBody.data.emails, cfg);

  return NextResponse.json({
    results,
    meta: {
      smtpEnabled: cfg.smtpEnabled,
      checked: results.length,
      durationMs: Date.now() - startedAt,
    },
  });
}

export async function GET() {
  const cfg = getVerifierConfigFromEnv();
  return NextResponse.json({
    smtpEnabled: cfg.smtpEnabled,
    heloDomain: cfg.heloDomain,
    sender: cfg.mailFrom ? cfg.mailFrom : "null sender (RFC 5321 <>)",
    maxBatch: MAX_BATCH,
    timeouts: {
      connectMs: cfg.connectTimeoutMs,
      commandMs: cfg.commandTimeoutMs,
      overallMs: cfg.overallTimeoutMs,
    },
  });
}
