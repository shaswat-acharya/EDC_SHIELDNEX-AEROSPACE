/**
 * Static reference data used by the verifier.
 *
 * These lists are deliberately small and curated — they are signals that
 * enrich the result, never the sole basis for a "bounce" verdict.
 */

import type { VerifyFlags } from "./types";

/** Well-known disposable / throwaway mailbox domains. Best-effort, not exhaustive. */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com", "mailinator.net", "mailinator.org", "sogetthis.com",
  "reallymymail.com", "mailinator2.com", "spamhereplease.com", "binkmail.com",
  "bobmail.info", "chammy.info", "devnullmail.com", "letthemeatspam.com",
  "mailin8r.com", "mailnesia.com", "maildrop.cc", "dispostable.com",
  "mailcatch.com", "yopmail.com", "yopmail.net", "yopmail.fr", "yopmail.biz",
  "cool.fr.nf", "jetable.fr.nf", "nospam.ze.tc", "courriel.fr.nf",
  "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf", "nomail.xl.cx",
  "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmail.net",
  "tempmail.dev", "tempmailo.com", "tempmailaddress.com", "tempr.email",
  "10minutemail.com", "10minutemail.net", "10minutemail.org", "10minutemail.co",
  "20minutemail.com", "1minmail.com", "7minutemail.net", "15minutemail.com",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamailblock.com", "sharklasers.com",
  "grr.la", "pokemail.net", "spam4.me", "throwawaymail.com",
  "trashmail.com", "trashmail.net", "trashmail.org", "trashmail.de",
  "trash-mail.com", "trash-mail.de", "wegwerfmail.de", "wegwerfmail.net",
  "mytrashmail.com", "getnada.com", "nada.email", "nada.ltd",
  "discard.email", "fakeinbox.com", "fakemailgenerator.com", "fakemail.net",
  "moakt.com", "moakt.ws", "tmpmail.org", "tmpmail.net", "tmpbox.net",
  "luxusmail.org", "emailondeck.com", "email-fake.com", "generator.email",
  "femailtor.com", "inboxbear.com", "mail7.io", "mohmal.com", "dropmail.me",
  "spamgourmet.com", "burnermail.io", "anonaddy.me", "simplelogin.io",
  "33mail.com", "mailimate.com", "instantemailaddress.com", "linshiyouxiang.net",
  "internxt.com", "mailtemp.uk", "mail-temp.com", "minuteinbox.com",
  "instant-mail.de", "mailsac.com", "inboxkitten.com", "tempinbox.com",
  "fake-mail.net", "throwam.com", "mailgon.net", "zippymail.info",
  "temporary-mail.net", "temporaryinbox.com", "mail.lt.temp", "brefmail.com",
  "ephemail.net", "one-time.email", "onetimemail.org", "instantmailaddress.com",
]);

/** Well-known free consumer mailbox providers. */
export const FREE_PROVIDERS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.co.in",
  "yahoo.fr", "yahoo.de", "yahoo.ca", "yahoo.com.au", "ymail.com",
  "rocketmail.com", "hotmail.com", "hotmail.co.uk", "hotmail.fr",
  "hotmail.de", "hotmail.it", "outlook.com", "outlook.fr", "outlook.de",
  "outlook.in", "outlook.co.uk", "live.com", "live.co.uk", "live.in",
  "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "aim.com",
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me", "zoho.com",
  "zohomail.com", "gmx.com", "gmx.net", "gmx.de", "gmx.at", "gmx.ch",
  "mail.com", "email.com", "usa.com", "europe.com", "yandex.com",
  "yandex.ru", "ya.ru", "mail.ru", "inbox.ru", "bk.ru", "list.ru",
  "rediffmail.com", "fastmail.com", "fastmail.fm", "hey.com", "tutanota.com",
  "tuta.io", "keemail.me", "web.de", "t-online.de", "freenet.de",
  "free.fr", "laposte.net", "orange.fr", "sfr.fr", "wanadoo.fr",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net",
  "cox.net", "charter.net", "earthlink.net", "juno.com", "optonline.net",
  "rogers.com", "shaw.ca", "sympatico.ca", "naver.com", "hanmail.net",
  "daum.net", "qq.com", "163.com", "126.com", "sina.com", "foxmail.com",
]);

/** Common role/shared mailbox local parts. */
export const ROLE_LOCALS: ReadonlySet<string> = new Set([
  "info", "information", "admin", "administrator", "administration",
  "webmaster", "postmaster", "hostmaster", "abuse", "noc", "security",
  "support", "help", "helpdesk", "service", "sales", "marketing",
  "contact", "contacts", "enquiries", "enquiry", "inquiry", "enquire",
  "billing", "accounts", "account", "finance", "invoice", "invoices",
  "hr", "careers", "jobs", "job", "recruiting", "recruitment", "resume",
  "office", "team", "hello", "hi", "mail", "email", "newsletter", "news",
  "no-reply", "noreply", "donotreply", "do-not-reply", "mailer",
  "mailer-daemon", "root", "sysadmin", "feedback", "press", "media",
  "legal", "privacy", "complaint", "complaints", "general", "main",
  "reception", "frontdesk", "manager", "orders", "order", "shop",
  "store", "customercare", "customerservice", "customersupport",
  "returns", "refund", "devnull", "it", "operations", "notices",
]);

/** Popular domains used to suggest corrections for likely typos. */
export const COMMON_EMAIL_DOMAINS: readonly string[] = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk",
  "hotmail.com", "outlook.com", "live.com", "msn.com", "icloud.com",
  "me.com", "aol.com", "proton.me", "protonmail.com", "zoho.com",
  "gmx.com", "gmx.net", "mail.com", "yandex.com", "rediffmail.com",
  "fastmail.com", "comcast.net", "verizon.net", "att.net", "example.com",
];

export function emptyFlags(): VerifyFlags {
  return { role: false, disposable: false, free: false, implicitMx: false };
}
