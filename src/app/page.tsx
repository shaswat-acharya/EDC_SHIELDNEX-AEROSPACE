"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  MailCheck,
  Sparkles,
  StopCircle,
  Trash2,
  Download,
  Copy,
  Network,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { dedupeTokens, extractEmailTokens } from "@/lib/email-extract";
import type { DeliveryStatus, VerifyResult } from "@/lib/email-verifier/types";
import { HowItWorks } from "@/components/verifier/how-it-works";
import { ResultsTable } from "@/components/verifier/results-table";
import { StatCards } from "@/components/verifier/stat-cards";
import { ThemeToggle } from "@/components/verifier/theme-toggle";

const CHUNK_SIZE = 10;
const MAX_EMAILS = 100;

type FilterKey = "all" | DeliveryStatus;

interface VerifyMeta {
  smtpEnabled: boolean;
}

const SAMPLE = [
  "support@gmail.com",
  "john.doe@gmail.com",
  "jane.doe@gmial.com",
  "user@does-not-exist-qz71.com",
  "ticket8721@mailinator.com",
  "no-reply@outlook.com",
  "sales@@github.com",
  "hello@mozilla.org",
].join("\n");

function downloadName(): string {
  return `mailprobe-results-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
}

export default function Home() {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [results, setResults] = useState<VerifyResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [serverConfig, setServerConfig] = useState<VerifyMeta | null>(null);
  const abortRef = useRef(false);

  const extracted = useMemo(() => dedupeTokens(extractEmailTokens(text), MAX_EMAILS), [text]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/verify")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("config lookup failed"))))
      .then((data: VerifyMeta) => {
        if (!cancelled) setServerConfig(data);
      })
      .catch(() => {
        /* config is informational only */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<DeliveryStatus, number> = { deliverable: 0, bounce: 0, unknown: 0 };
    for (const r of results) c[r.status] += 1;
    return c;
  }, [results]);

  const filtered = useMemo(() => {
    if (filter === "all") return results;
    return results.filter((r) => r.status === filter);
  }, [results, filter]);

  const run = useCallback(async () => {
    if (running) return;
    if (extracted.tokens.length === 0) {
      toast({
        title: "Nothing to check",
        description: "Paste at least one address (anything containing an @) first.",
        variant: "destructive",
      });
      return;
    }
    if (extracted.truncated) {
      toast({
        title: `Only the first ${MAX_EMAILS} addresses will be checked`,
        description: "The list was capped to keep mail servers happy.",
      });
    }

    abortRef.current = false;
    setRunning(true);
    setResults([]);
    setFilter("all");
    setProgress({ done: 0, total: extracted.tokens.length });

    const queue = [...extracted.tokens];
    const acc: VerifyResult[] = [];
    let done = 0;

    try {
      for (let i = 0; i < queue.length; i += CHUNK_SIZE) {
        if (abortRef.current) break;
        const chunk = queue.slice(i, i + CHUNK_SIZE);
        const res = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: chunk }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `The server responded with ${res.status}.`);
        }
        const data = (await res.json()) as { results: VerifyResult[] };
        acc.push(...data.results);
        done += chunk.length;
        setResults([...acc]);
        setProgress({ done: Math.min(done, queue.length), total: queue.length });
      }
      if (!abortRef.current && acc.length > 0) {
        const c: Record<DeliveryStatus, number> = { deliverable: 0, bounce: 0, unknown: 0 };
        for (const r of acc) c[r.status] += 1;
        toast({
          title: `Checked ${acc.length} address${acc.length === 1 ? "" : "es"}`,
          description: `${c.deliverable} deliverable · ${c.bounce} likely to bounce · ${c.unknown} unknown`,
        });
      }
    } catch (err) {
      toast({
        title: "Check failed",
        description: err instanceof Error ? err.message : "Unexpected error while verifying.",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [extracted, running, toast]);

  const exportCsv = useCallback(() => {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = ["email", "status", "reason", "mx_host", "smtp_reply", "suggestion", "role", "disposable", "free", "checked_at"];
    const rows = results.map((r) =>
      [
        r.email,
        r.status,
        r.reason,
        r.mxHost ?? "",
        r.smtpReply ?? "",
        r.suggestion ?? "",
        r.flags.role ? "yes" : "no",
        r.flags.disposable ? "yes" : "no",
        r.flags.free ? "yes" : "no",
        r.checkedAt,
      ]
        .map((cell) => esc(String(cell)))
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [results]);

  const copyJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(results, null, 2));
      toast({ title: "Results copied as JSON" });
    } catch {
      toast({
        title: "Could not copy",
        description: "Your browser denied clipboard access.",
        variant: "destructive",
      });
    }
  }, [results, toast]);

  const canRun = !running && extracted.tokens.length > 0;
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg bg-emerald-600 text-white">
              <MailCheck className="size-4" aria-hidden />
            </div>
            <span className="text-base font-semibold tracking-tight">MailProbe</span>
            <Badge variant="outline" className="hidden text-[11px] text-muted-foreground sm:inline-flex">
              email deliverability checker
            </Badge>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">
        <section className="pt-10 pb-8 sm:pt-14" aria-labelledby="hero-heading">
          <h1 id="hero-heading" className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            Will it bounce? Check before you send.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Paste a list of email addresses. MailProbe validates the syntax, resolves each domain&apos;s mail
            servers, and — when they are reachable — asks the server whether the mailbox exists. Every
            address gets one of three verdicts:{" "}
            <span className="font-medium text-emerald-600 dark:text-emerald-400">likely deliverable</span>,{" "}
            <span className="font-medium text-red-600 dark:text-red-400">likely to bounce</span>, or{" "}
            <span className="font-medium text-amber-600 dark:text-amber-400">unknown</span>.
          </p>
        </section>

        <Card className="gap-4">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Paste email addresses</CardTitle>
                <CardDescription>
                  One per line, comma-separated, or mixed into text — up to {MAX_EMAILS} at a time.
                </CardDescription>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {extracted.tokens.length === 0
                  ? "no addresses found yet"
                  : `${extracted.tokens.length} address${extracted.tokens.length === 1 ? "" : "es"} ready`}
                {extracted.duplicates > 0 && ` · ${extracted.duplicates} duplicate${extracted.duplicates === 1 ? "" : "s"} folded`}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"alice@example.com\nbob@company.org, carol@nonexistent-domain-xyz.com\nDan Smith <dan@smail.example>"}
              className="min-h-[160px] resize-y font-mono text-[13px] leading-relaxed"
              aria-label="Email addresses to check"
              spellCheck={false}
            />
            {serverConfig && !serverConfig.smtpEnabled && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Note: SMTP mailbox checks are disabled on this deployment — results will be syntax/DNS only.
              </p>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap items-center gap-2">
            <Button
              size="lg"
              onClick={run}
              disabled={!canRun}
              className="min-w-[180px] bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {running ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Checking{progress ? ` ${progress.done}/${progress.total}` : ""}…
                </>
              ) : (
                <>
                  <MailCheck className="size-4" aria-hidden />
                  Check deliverability
                </>
              )}
            </Button>
            {running && (
              <Button variant="outline" size="lg" onClick={() => (abortRef.current = true)}>
                <StopCircle className="size-4" aria-hidden />
                Stop
              </Button>
            )}
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setText(SAMPLE)}>
                <Sparkles className="size-4" aria-hidden />
                Load sample
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setText("");
                  setResults([]);
                  setFilter("all");
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                Clear
              </Button>
            </div>
          </CardFooter>
        </Card>

        {(running || progress) && (
          <div className="mt-6 space-y-2" aria-live="polite">
            <Progress value={pct} className="h-1.5 [&_[data-slot=progress-indicator]]:bg-emerald-600" />
            <p className="text-xs text-muted-foreground tabular-nums">
              Checking {progress?.done ?? 0} of {progress?.total ?? 0} addresses…
              {serverConfig?.smtpEnabled === true && " (mailbox probes can take a few seconds each)"}
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="mt-6 space-y-6">
            <StatCards results={results} />

            <Card className="gap-4">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Results</CardTitle>
                    <CardDescription>
                      {results.length} checked{filter !== "all" && ` · showing ${filtered.length} ${filter}`}
                    </CardDescription>
                  </div>
                  <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
                    <TabsList>
                      <TabsTrigger value="all">All {results.length}</TabsTrigger>
                      <TabsTrigger value="deliverable">Deliverable {counts.deliverable}</TabsTrigger>
                      <TabsTrigger value="bounce">Bounce {counts.bounce}</TabsTrigger>
                      <TabsTrigger value="unknown">Unknown {counts.unknown}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ResultsTable results={filtered} />
              </CardContent>
              <CardFooter className="flex-wrap gap-2">
                <Button variant="outline" onClick={exportCsv}>
                  <Download className="size-4" aria-hidden />
                  Export CSV
                </Button>
                <Button variant="outline" onClick={copyJson}>
                  <Copy className="size-4" aria-hidden />
                  Copy JSON
                </Button>
                <p className="ms-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                  <Network className="size-3.5" aria-hidden />
                  Nothing was emailed to these addresses — probes stop before the SMTP DATA stage.
                </p>
              </CardFooter>
            </Card>
          </div>
        )}

        <HowItWorks />
      </main>

      <footer className="mt-auto border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground">
          <p>
            MailProbe is a best-effort estimator, not a guarantee — mail servers can and do change their
            minds. See the README for exactly what this deployment can and cannot check.
          </p>
          <p>No messages are ever sent to the addresses you check.</p>
        </div>
      </footer>
    </div>
  );
}
