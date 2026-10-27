"use client";

import * as React from "react";
import { CheckCircle2, XCircle, HelpCircle, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STATUS_LABELS, type DeliveryStatus, type VerifyResult } from "@/lib/email-verifier/types";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  DeliveryStatus,
  { icon: React.ComponentType<{ className?: string }>; badgeClass: string }
> = {
  deliverable: {
    icon: CheckCircle2,
    badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  bounce: {
    icon: XCircle,
    badgeClass: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  unknown: {
    icon: HelpCircle,
    badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
};

function MiniBadge({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] leading-none font-medium",
        warn
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "border-border bg-muted text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

function ResultRow({ result }: { result: VerifyResult }) {
  const meta = STATUS_META[result.status];
  const Icon = meta.icon;
  const { role, disposable, free, implicitMx } = result.flags;

  return (
    <TableRow className="group">
      <TableCell className="align-top">
        <Badge variant="outline" className={cn("gap-1 whitespace-nowrap", meta.badgeClass)}>
          <Icon className="size-3.5" aria-hidden />
          {STATUS_LABELS[result.status]}
        </Badge>
      </TableCell>
      <TableCell className="align-top">
        <div className="max-w-[22rem] font-mono text-[13px] leading-snug break-all">{result.email}</div>
        {(role || disposable || free || implicitMx || result.suggestion) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {role && <MiniBadge>Role account</MiniBadge>}
            {disposable && <MiniBadge warn>Disposable domain</MiniBadge>}
            {free && <MiniBadge>Free provider</MiniBadge>}
            {implicitMx && <MiniBadge>No MX record</MiniBadge>}
            {result.suggestion && <MiniBadge warn>Did you mean {result.suggestion}?</MiniBadge>}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top">
        <p className="text-sm leading-snug">{result.reason}</p>
        {(result.mxHost || result.smtpReply) && (
          <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
            {result.mxHost && <>MX: {result.mxHost}</>}
            {result.mxHost && result.smtpReply && " · "}
            {result.smtpReply && <>SMTP: {result.smtpReply}</>}
          </p>
        )}
      </TableCell>
    </TableRow>
  );
}

export function ResultsTable({ results }: { results: VerifyResult[] }) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <Inbox className="size-9 opacity-40" aria-hidden />
        <p className="text-sm">No results yet — paste addresses above and run a check.</p>
      </div>
    );
  }

  return (
    <div
      className="thin-scrollbar max-h-[540px] overflow-y-auto overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label="Verification results table"
    >
      <Table className="min-w-[640px]">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[170px]">Status</TableHead>
            <TableHead className="w-[240px]">Email</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((result) => (
            <ResultRow key={`${result.input}\u0000${result.email}`} result={result} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
