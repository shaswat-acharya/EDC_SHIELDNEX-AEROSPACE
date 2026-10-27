/**
 * Shared types for the email deliverability verifier.
 *
 * This module must stay free of any Node.js-only imports: the client
 * components import `VerifyResult` / `DeliveryStatus` from here.
 */

/** The three outcomes the tool reports. */
export type DeliveryStatus = "deliverable" | "bounce" | "unknown";

/** Where in the pipeline the outcome was decided. */
export type VerifyStage =
  | "syntax"
  | "dns"
  | "smtp"
  | "smtp-catchall"
  | "smtp-disabled";

export interface VerifyFlags {
  /** Address like info@, support@, admin@ — shared mailbox, not a person. */
  role: boolean;
  /** Domain is a known disposable / throwaway provider. */
  disposable: boolean;
  /** Domain is a well-known free consumer mailbox provider. */
  free: boolean;
  /** Domain has no MX record; the A/AAAA record is used as implicit MX (RFC 5321 §5.1). */
  implicitMx: boolean;
}

export interface VerifyResult {
  /** The raw token as pasted by the user (after whitespace trim). */
  input: string;
  /** The normalized address that was checked (or the cleaned token if syntax failed). */
  email: string;
  status: DeliveryStatus;
  /** Human-readable explanation of why this status was assigned. */
  reason: string;
  stage: VerifyStage;
  /** Mail server host that was contacted (best MX exchange). */
  mxHost?: string;
  /** Final SMTP reply line, when an SMTP conversation took place. */
  smtpReply?: string;
  /** Suggested correction when the domain looks like a typo of a common provider. */
  suggestion?: string;
  flags: VerifyFlags;
  /** ISO timestamp of the check. */
  checkedAt: string;
}

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  deliverable: "Likely deliverable",
  bounce: "Likely to bounce",
  unknown: "Unknown",
};
