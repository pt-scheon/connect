/* Invented test accounts (scripts/seed.ts and scripts/demo-data.js). Google and LinkedIn accounts never carry these
   prefixes, so this is what decides who the passwordless test sign-in may open. */
export const sampleSql = (sub = "sub") => `(${sub} LIKE 'demo:%' OR ${sub} LIKE 'seed:%')`;
export const FAKE = " (fake)";
/* A name in two parts, so "(fake)" can be set small next to it. */
export const splitFake = (name: string): [string, boolean] => (name.endsWith(FAKE) ? [name.slice(0, -FAKE.length), true] : [name, false]);
