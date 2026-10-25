"use client";

import * as React from "react";
import {
  AtSign,
  Globe,
  MailQuestion,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  HelpCircle,
  TriangleAlert,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PIPELINE = [
  {
    icon: AtSign,
    title: "1 · Syntax & normalization",
    body: "Each address is parsed with RFC-style rules — local part length, dot placement, domain labels, TLD shape. Duplicates are folded together and common paste formats (\"Name <a@b.com>\") are handled.",
  },
  {
    icon: Globe,
    title: "2 · DNS / MX lookup",
    body: "The domain's MX records are resolved (with an A/AAAA fallback for implicit MX, and null-MX detection). A domain with no mail route is an immediate bounce verdict.",
  },
  {
    icon: MailQuestion,
    title: "3 · SMTP RCPT probe",
    body: "When reachable, the tool opens one connection to the mail server and runs EHLO → MAIL FROM → RCPT TO. The server's answer to RCPT TO is the closest thing to a delivery prediction — and the session quits before the DATA stage, so no email is ever sent.",
  },
];

const MEANINGS = [
  {
    icon: CheckCircle2,
    title: "Likely deliverable",
    tone: "text-emerald-600 dark:text-emerald-400",
    body: "Syntax is valid, the domain has mail servers, and the server explicitly accepted the address (and the domain is not a catch-all).",
  },
  {
    icon: XCircle,
    title: "Likely to bounce",
    tone: "text-red-600 dark:text-red-400",
    body: "The address is syntactically broken, the domain is dead or accepts no mail, or the server explicitly rejected the recipient.",
  },
  {
    icon: HelpCircle,
    title: "Unknown",
    tone: "text-amber-600 dark:text-amber-400",
    body: "The server would not confirm the mailbox: catch-all domains, greylisting, unreachable or slow servers, or SMTP checks disabled. This is a valid, honest answer — many providers deliberately never confirm mailboxes.",
  },
];

export function HowItWorks() {
  return (
    <section className="mt-12 space-y-6" aria-labelledby="how-it-works-heading">
      <div>
        <h2 id="how-it-works-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">
          How MailProbe decides
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every address runs through the same three-stage pipeline, and the weakest link decides the verdict.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PIPELINE.map((step) => {
          const Icon = step.icon;
          return (
            <Card key={step.title} className="gap-3">
              <CardHeader>
                <CardDescription className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Icon className="size-4" aria-hidden />
                  {step.title}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {MEANINGS.map((m) => {
          const Icon = m.icon;
          return (
            <Card key={m.title} className="gap-3 border-dashed">
              <CardHeader>
                <CardTitle className={cn("flex items-center gap-2 text-base", m.tone)}>
                  <Icon className="size-4" aria-hidden />
                  {m.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">{m.body}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="gap-3 border-amber-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-600 dark:text-amber-400">
              <TriangleAlert className="size-4" aria-hidden />
              Hosting providers often block port 25
            </CardTitle>
            <CardDescription>
              What the deployed version can and cannot check.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">Always works:</strong> syntax validation, domain existence,
              MX/mail-route checks, disposable/role/free-provider signals, and typo suggestions — these only
              need DNS.
            </p>
            <p>
              <strong className="text-foreground">May not work:</strong> the mailbox-level SMTP probe. Most
              cloud hosting providers block outbound connections on port 25 to fight spam, so on those hosts
              every SMTP-dependent result comes back <em>Unknown</em> with a “could not reach the mail server”
              reason. Run MailProbe locally (where port 25 is usually open) for full mailbox checks.
            </p>
          </CardContent>
        </Card>

        <Card className="gap-3 border-emerald-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-4" aria-hidden />
              No email is ever sent
            </CardTitle>
            <CardDescription>Read-only probing, by construction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              An SMTP “probe” here is a handshake, not a delivery: the session ends with QUIT immediately
              after the server answers <span className="font-mono text-xs">RCPT TO</span>. The
              <span className="font-mono text-xs"> DATA</span> command — the only step that actually
              transmits a message body — is never issued, so nothing is ever delivered to the addresses you
              check.
            </p>
            <p>
              Probes use the RFC 5321 null sender, a configurable HELO name, short timeouts, and low
              concurrency, to stay as polite as possible to the servers being asked. Don&apos;t use this
              tool to enumerate mailboxes at scale — see the README for the full ethics notes.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
