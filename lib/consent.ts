/* The cookie notice. Connect sets only cookies it needs (sign-in, your settings), so the one real choice is the
   statistics: whether the days you open Connect are counted for the admins' usage charts. Counting needs no cookie;
   this one only remembers your answer, so the notice is not shown again. */
export const CONSENT_COOKIE = "consent";
export type Consent = "all" | "necessary";
export const readConsent = (v: string | undefined | null): Consent | null => (v === "all" || v === "necessary" ? v : null);
export const CONSENT_DAYS = 365;
/* The date of the terms people agree to at sign-up. Change it when the terms change in a way that matters. */
export const TERMS_DATE = "21 November 2026";
