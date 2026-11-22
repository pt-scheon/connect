/* Invented test accounts (scripts/seed.ts and scripts/demo-data.js). Google and LinkedIn accounts never carry these
   prefixes, so this is what decides who the passwordless test sign-in may open. */
export const sampleSql = (sub = "sub") => `(${sub} LIKE 'demo:%' OR ${sub} LIKE 'seed:%')`;
export const FAKE = " (fake)";
/* A name in two parts, so "(fake)" can be set small next to it. */
export const splitFake = (name: string): [string, boolean] => (name.endsWith(FAKE) ? [name.slice(0, -FAKE.length), true] : [name, false]);
/* An opened college: one the Connect team or a student opened, or any where a real person is verified. It does not mean
   the college itself joined. The rest came from scripts/demo-data.js (requested_by 0) or are the seed's Demo College. */
export const openedSql = (c = "c") =>
  `(${c}.domains<>'college.example' AND (${c}.requested_by IS NULL OR ${c}.requested_by<>0 OR EXISTS (SELECT 1 FROM users r WHERE r.college_id=${c}.id AND r.verified=1 AND r.deleted=0 AND NOT ${sampleSql("r.sub")})))`;
