"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeliveryStatus, VerifyResult } from "@/lib/email-verifier/types";

interface StatDef {
  key: DeliveryStatus;
  label: string;
  caption: string;
  icon: React.ComponentType<{ className?: string }>;
  textClass: string;
  barClass: string;
}

const STATS: StatDef[] = [
  {
    key: "deliverable",
    label: "Likely deliverable",
    caption: "Server confirmed the mailbox",
    icon: CheckCircle2,
    textClass: "text-emerald-600 dark:text-emerald-400",
    barClass: "bg-emerald-500",
  },
  {
    key: "bounce",
    label: "Likely to bounce",
    caption: "Invalid, dead, or rejected",
    icon: XCircle,
    textClass: "text-red-600 dark:text-red-400",
    barClass: "bg-red-500",
  },
  {
    key: "unknown",
    label: "Unknown",
    caption: "Server would not confirm",
    icon: HelpCircle,
    textClass: "text-amber-600 dark:text-amber-400",
    barClass: "bg-amber-500",
  },
];

export function StatCards({ results }: { results: VerifyResult[] }) {
  const counts: Record<DeliveryStatus, number> = { deliverable: 0, bounce: 0, unknown: 0 };
  for (const r of results) counts[r.status] += 1;
  const total = results.length;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {STATS.map((stat, i) => {
        const count = counts[stat.key];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const Icon = stat.icon;
        return (
          <motion.div
            key={stat.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
          >
            <Card className="gap-3 py-4">
              <CardHeader className="pb-0">
                <CardDescription className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
                  <Icon className={`size-4 ${stat.textClass}`} aria-hidden />
                  {stat.label}
                </CardDescription>
                <CardTitle className="text-3xl tabular-nums">
                  {total > 0 ? count : "—"}
                  {total > 0 && (
                    <span className="ml-2 align-middle text-sm font-normal text-muted-foreground tabular-nums">
                      {pct}%
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={`${stat.label}: ${count} of ${total}`}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className={`h-full rounded-full ${stat.barClass} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{stat.caption}</p>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
