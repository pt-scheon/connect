# Rating and credit redesign

Status: design agreed. The decisions taken are listed at the end.

## 1. What changes

Today a profile shows one number, credit. It mixes three questions: how much has this person done, how good are
they at a given thing, and can their word be trusted. One number is easy to game because pushing on any of the
three moves it.

The redesign shows three separate things.

| | Answers | Used for | Moves when |
|---|---|---|---|
| **Credit** | How much verified work has this person done? | Staking to join, escrow for commissions, the reviewer threshold | A project ships, a commission is signed off, a review turns out right |
| **Competency** (per skill, 0–100, with confidence) | How good are they at React, PCB design, ...? | Matching people to roles and commissions | Verified evidence that names the skill |
| **Credibility** (0–100) | How much should we trust what they say and sign? | Weight of their vouches, reviews, splits and client ratings | They finish what they join, review accurately, get reported, or look like part of a ring |

Rules that hold everywhere:

- **Nothing typed counts.** No text a person writes about themselves changes any of the three. This includes the
  skills list on the profile, "what I did", claims, and a pasted GitHub link.
- **Computed on read.** No score is stored. Each is worked out from raw records (teams, reviews, splits, vouches,
  evidence, commissions) every time, so it cannot drift and every number can be explained line by line.
- **College scope.** All records are created through actions that check `college_id`, so every edge in the graph
  (teammate, vouch, review, commission) joins two people at the same college.

Order of calculation, one pass with no loops:
`credit base → credibility → vouch credit → competency → relevance`.
Credibility never reads competency, and competency never reads relevance.

## 2. Constants

All numbers live in one object in `lib/credit.ts`, extending today's `RULES`. Existing keys keep their values.

```ts
export const RULES = {
  // ---- credit (unchanged) ----
  starter: 20, stake: 10, live: 100, demo: 60, soloFactor: 0.5,
  vouch: 5, fullWeightAt: 200, fadeMonths: 18, reviewerMin: 50, reviewsNeeded: 2,

  // ---- credit (new) ----
  cutover: 0,               // unix time of the release; vouches made before it keep their old weight
  vouchesCounted: 5,        // only your 5 strongest vouches count
  ringSize: 4,              // a closed vouch group of this size or smaller is a ring
  ringFactor: 0.25,         // vouches inside a ring count a quarter
  reviewReward: 3,          // credit for a review that matched the final outcome
  reviewRewardCap: 15,      // per 30 days

  // ---- credibility ----
  cred: {
    weights: { finish: 0.35, reviews: 0.25, claims: 0.20, age: 0.10, breadth: 0.10 },
    k: 2,                   // strength of the starting assumption, in "events"
    priorFinish: 0.7, priorReviews: 0.7, priorClaims: 0.5,
    ageFullMonths: 6,       // account age counts fully after 6 months
    breadthFullAt: 5,       // distinct people shipped with, for full marks
    reportPenalty: 15,      // per upheld report, fading with halfLifeMonths
    circlePenalty: 10,      // closed-circle flag
    ringPenalty: 15,        // member of a vouch ring
    floor: 0.2,             // lowest multiplier a signature can have (credibility 0 still counts 0.2)
  },

  // ---- competency ----
  skill: {
    prior: 30,              // score for a skill with no evidence
    k: 2,                   // one full-weight project moves you a third of the way
    halfLifeMonths: 18,
    tier: { A: 1, B: 0.5, C: 0 },
    qLive: 0.9, qDemo: 0.65,
    shareBoost: 0.25,       // quality moves with your share relative to an equal split
    qHackWin: 0.9, qHackFinal: 0.75, qHackTookPart: 0.5,
    qInternship: 0.7,
    confLow: 0.33, confHigh: 0.66,
  },

  // ---- relevance ----
  fit: {
    confFloor: 0.5,         // unproven skills count half, never zero
    notOpen: 0.6,           // not marked "open to projects"
    freeLoad: 2,            // active projects before the load penalty starts
    loadStep: 0.2,          // lost per extra active project, down to loadMin
    loadMin: 0.4,
    teamBonus: 0.1,         // has shipped with someone already on the team
  },

  // ---- reviewers ----
  review: { minDistance: 2, invited: 4, splitFlagAt: 2 /* × an equal share */ },

  // ---- commissions ----
  comm: {
    minClientCredit: 30,    // earned credit needed to post
    minReward: 5, maxReward: 60,
    reviewerAbove: 40,      // rewards above this need an outside reviewer too
    pairWindowMonths: 6,
    pairMaxCount: 2,        // paid commissions between the same two people per window
    pairMaxCredit: 60,      // and total credit between them per window
    openMax: 3,             // commissions one person can have open at once
    alumAllowance: 40,      // credit an alum's commissions can award per 30 days (minted, not spent)
  },

  // ---- gifts (sending credit to someone) ----
  gift: {
    minSenderCredit: 50,    // earned credit needed to send any
    windowDays: 30,
    pairMax: 20,            // between the same two people, both directions added together, per window
    senderMax: 40,          // one person can send this much per window
    receiverMax: 40,        // and receive this much per window
    minAccountDays: 30,     // both accounts must be at least this old
  },
};
```

## 3. Credit

### What stays

`shares()` (median of what teammates gave you, rescaled to 100), pots of 100/60, solo half, the stake, the lead's
penalty for dropping, the 18-month fade, and the ledger are unchanged. A person's ledger lines from projects,
stakes and the starter credit come out identical before and after.

### What is added

**Two views of the same ledger.** Credit becomes spendable in commissions, so one number would let someone "lose
their record" by hiring. `Standing` gets:

- `earned`: the sum of everything earned, minus penalties (lost stakes, dropped projects). Spending does not
  lower it. This is the number shown on profiles and used for the reviewer and client thresholds.
- `credit` (the balance): `earned` minus stakes held, escrow held and credit paid to doers. This is what you can
  stake or put in escrow.

For anyone who has never commissioned work, `earned` equals today's credit plus held stakes.

**New ledger lines**

| Line | Amount |
|---|---|
| Commission done (doer) | + reward, at sign-off |
| Commission escrow held (client) | − reward while open, assigned, delivered or disputed (balance only) |
| Commission paid (client) | − reward at sign-off (balance only) |
| Review matched the outcome | + `reviewReward`, at most `reviewRewardCap` per 30 days |

**Vouches.** A vouch is worth `vouch × credibility(voucher)/100`, halved if mutual (as now), and multiplied by
`ringFactor` if both people are in the same ring. Only the `vouchesCounted` strongest count. Vouches made before
`cutover` keep the old weight (`min(1, base/fullWeightAt)`), so nobody's credit drops on release day.

**Rings.** Build the directed vouch graph. A ring is a group of 2 to `ringSize` people in which every member
vouched for another member and nobody in the group has a vouch from outside it. Members are flagged (shown the
same way as today's "closed circle"), their vouches to each other count a quarter, and each loses `ringPenalty`
credibility. Today's circle flag (3+ shipped projects, 2 or fewer distinct teammates) stays.

**Gifts.** A person can send credit to someone at their college, for example to cover a newcomer's stake.
Gifts move the **balance only**: the sender's balance drops, the receiver's rises, and nobody's earned credit,
competency or credibility changes. So a gift lets a friend stake or post a commission, but it cannot make them
look more accomplished, and it cannot get them to the reviewer or client thresholds. Limits (all in `RULES.gift`):
the sender needs 50 earned credit, both accounts must be 30 days old, at most 20 between the same two people in
30 days counting both directions, and at most 40 sent and 40 received per person in 30 days. Gifted credit is
labelled as a gift on both ledgers.

## 4. Credibility (0–100)

Five parts, each between 0 and 1. The first three use a smoothed rate so that one event cannot swing them:
`rate = (good + k·prior) / (total + k)`.

| Part | Weight | good / total |
|---|---|---|
| Finishing | 0.35 | shipped / (shipped + left + dropped as lead) |
| Review accuracy | 0.25 | reviews that matched the outcome / reviews that have an outcome |
| Claims verified | 0.20 | evidence items verified / evidence items verified or rejected |
| Account age | 0.10 | min(1, months since joining / 6) |
| Breadth | 0.10 | min(1, distinct people shipped with / 5) |

```
credibility = 100 × Σ weight × part
              − reportPenalty × Σ 0.5^(age of each upheld report / 18 months)
              − circlePenalty (if closed circle) − ringPenalty (if in a vouch ring)
clamped to 0..100
```

A brand-new verified student lands at 52: 0.35×0.7 + 0.25×0.7 + 0.20×0.5 = 0.52.

Notes:

- "Claims" here means evidence a person sent for checking (section 6). Lines left as "No proof" are not sent for
  checking and do not count either way, so writing or deleting them changes nothing.
- A review "matched" if it equals the final verdict. The final verdict is an admin's verdict when there is one,
  otherwise the middle verdict of the reviewers (section 7).
- A report is "upheld" when an admin closes it as upheld. Today reports are only opened and closed; a `result`
  column is added.
- When credibility is used as a multiplier it is `max(floor, credibility/100)`. Admins acting as admins count 1.

## 5. Competency, per skill

### Skill names

Skills are free text today. A new `lib/skills.ts` holds a short alias table ("nextjs" → "next.js",
"react.js" → "react") and the groups from `RELATED` in `lib/match.ts`. Everything is compared by its normalised
name. Unknown skills are kept as typed, lower-cased.

### Where evidence comes from

A skill only counts for a person on a project when **someone else** says they used it:

- **Team projects**: when teammates split the credit, each also ticks which of the project's skills each other
  teammate used. A skill counts for you when at least half of your teammates (and at least one) ticked it.
- **Solo projects**: reviewers tick the skills the proof actually shows.
- **Commissions**: the skills are set by the client when posting, and count for the doer at sign-off.
- **Tier B evidence**: the admin or teammate who verifies the item confirms its skills.

### Formula

```
score(skill) = 100 × (k × prior/100 + Σ wᵢ × qᵢ) / (k + Σ wᵢ)
confidence   = Σ wᵢ / (Σ wᵢ + k)
wᵢ = tier × recency × share × verifier
```

| Term | Value |
|---|---|
| tier | A = 1, B = 0.5, C = 0 |
| recency | 0.5 ^ (months since the evidence / 18) |
| share | team project: min(1, your share / an equal share); solo project: `soloFactor`; everything else: 1 |
| verifier | average credibility multiplier of the people who confirmed it (reviewers and the teammates who ticked the skill; the client for a commission; 1 for an admin) |

Quality `qᵢ`:

| Evidence | q |
|---|---|
| Shipped project | (`qLive` or `qDemo`) × clamp(1 − shareBoost + shareBoost × your share / equal share, 0.6, 1.1), capped at 1 |
| Commission | client rating / 5 |
| Hackathon | 0.9 won, 0.75 finalist, 0.5 took part |
| Internship | 0.7 |

Worked example: one live three-person project with an equal split, signed by people of credibility 80, shipped
this month. w = 1 × 1 × 1 × 0.8 = 0.8, q = 0.9. Score = 100 × (2×0.30 + 0.8×0.9) / 2.8 = 47, confidence 0.29
("low, based on 1 shipped project"). Three such projects: score 60, confidence 0.55. Nobody becomes an expert on
one project.

**Display.** Each skill shows the score, a confidence word (low / medium / high from `confLow`, `confHigh`) and
the reason: "62 · medium · based on 3 shipped projects and 1 commission". Skills a person listed but has no
evidence for show as "No proof" with no score. Scores are shown as 0–100, not as letter bands or percentiles.

## 6. Evidence tiers

| Tier | What | Weight |
|---|---|---|
| **A**: verified by Connect | Shipped project confirmed by reviewers and signed by teammates; commission signed off by the client; a review that matched the outcome; a live URL Connect pinged and found up; commits in the project's linked repo by a GitHub account the person proved they own | 1 |
| **B**: verified by a third party or admin | Hackathon result with proof, confirmed by a teammate on Connect or an admin; internship confirmed by a work email code or an admin-checked letter | 0.5 |
| **C**: self-claimed | Anything typed. Shown with "No proof" | 0 |

Marks and CGPA are not used anywhere: they are not evidence of any tier.

**Tier B flow.** A person submits an item (kind, title, link or uploaded file, skills, and for a hackathon the
placing). It sits in the college admin's queue as pending. An admin verifies or rejects it with a
note. A hackathon item can instead be confirmed by a verified teammate who is named on it. Files go through the
existing `lib/files.ts` checks and are visible only to the owner and admins. Rejected items lower the "claims
verified" part of credibility; pending ones do nothing.

**Live check.** A project can name one live URL. Connect requests it when the project is sent for review and
when a reviewer opens it, at most once a day, https only, public addresses only (no private or local IPs, no
redirects to them), 5 second limit. The result is stored in `live_checks`. Reviewers see "Up, checked 2 hours
ago" or "Did not answer". It informs the reviewer's verdict; it does not set the pot.

**GitHub.** A typed GitHub link proves nothing. Proving ownership needs "Sign in with GitHub" (a new OAuth app,
which needs a client id and secret from the owner of this project). Once linked, and when a project names a
public repo, Connect reads the repo's contributor counts when the project ships and stores them on `members`.
They are used for one thing: the split check below. They never add to any score. Until the OAuth app exists
this check is skipped.

## 7. Reviewers and splits

**Who reviews.** When a project goes for review, Connect picks `invited` reviewers and records them:

1. Eligible: verified, not suspended, `earned ≥ reviewerMin`, never on this project, and at graph distance
   `minDistance` or more from every team member (distance 1 = has been on a team with them).
2. Picked at random, with chance proportional to credibility.
3. If fewer than `reviewsNeeded` people are eligible (a small or new college), the college admins review. One
   admin review is enough, as now.

Only invited reviewers and admins can review. Today anyone with 50 credit can, including a team's friends.

**Verdict.** Two matching reviews decide. If the two disagree, a third invited reviewer (or an admin) breaks the
tie and the middle verdict wins. This replaces "the stricter verdict wins", so that a lenient and a strict
reviewer are judged by the same rule. An admin's verdict always wins.

**Split check.** Median-of-peers stays. A shipped project is flagged for admins when someone's share is
`splitFlagAt` × an equal share or more **and** the contribution signals disagree: no commits in the linked repo
while teammates have some, or no milestone they ticked and no update they posted. A flag changes nothing by
itself; an admin looks at it.

## 8. Relevance for a role or commission

Roles and commissions list the skills they need, each with an importance of 1 to 3.

```
skillFit = Σ importance × score/100 × (confFloor + (1 − confFloor) × confidence) / Σ importance
fit      = skillFit × finishRate × availability × (1 + teamBonus if they shipped with someone on the team)

finishRate   = the smoothed finishing rate from credibility
availability = (1 if open to projects, else notOpen)
               × max(loadMin, 1 − loadStep × max(0, active projects and commissions − freeLoad))
```

Every suggestion carries its reason, built from the same records: "Fits: 2 reviewer-confirmed React projects,
finished 5 of 5 joined, shipped BusPing with Riya".

People with **no** evidence for any needed skill are not ranked. If they listed a matching skill they appear in
a separate row, "New here, no proof yet", in no particular order, so newcomers can still be found without typed
text beating proof.

The board's "Fits you" filter keeps matching a role against the viewer's proven skills and the skills they
listed. That only changes what the viewer sees on their own board.

Roles on existing projects have no skill list. Until a lead adds one, the role's skills are guessed from its
title with today's `roleSkills()`, all at importance 2.

## 9. Commissions

A verified student (for themselves or for a club they lead) or an approved alum posts: what is needed, skills
with importance, a deadline, milestones, and a reward in credit.

```
open → assigned → delivered → done
  ↘ cancelled        ↘ disputed → done | refunded (admin decides)
```

- **Posting** holds the reward in escrow from the client's balance. Cancelling before anyone is picked returns it.
- **Applying** is free. Applicants are listed by relevance (section 8) with reasons.
- **Assigned**: the client picks one person. The doer ticks milestones; the client can see progress.
- **Delivered**: the doer marks it delivered with a proof link.
- **Sign-off**: the client signs off and gives a rating from 1 to 5. Above `reviewerAbove` credit, one outside
  reviewer (picked as in section 7) must also confirm the proof. The doer then receives the reward and one piece
  of Tier A evidence for each listed skill, weighted by the client's credibility.
- **No answer**: if the client does not respond within 14 days of delivery, the doer can send it to the admins.
- **Disputes**: either side can open one with a reason. A college admin pays the doer, refunds the client, or
  splits the reward. A dispute an admin decides against someone counts as an upheld report for credibility.

Guard rails:

- The client needs `minClientCredit` earned credit, and at most `openMax` commissions open at once.
- Reward between `minReward` and `maxReward`.
- **Pair cap.** Within `pairWindowMonths`, the same two people (in either direction) can complete at most
  `pairMaxCount` paid commissions and move at most `pairMaxCredit` credit. Picking someone over the cap is
  refused with a plain message. The cap is checked again at sign-off.
- A commission does not count as "shipped together", so it cannot unlock vouches.
- **Alumni** have no credit to spend. An alum's commissions award credit from an allowance of `alumAllowance`
  per 30 days, always need an outside reviewer, and follow the same pair cap.
- **No coursework.** Graded coursework, assignments, lab records, exams and anything submitted for marks are not
  allowed. This is stated in the terms, shown as a checkbox the client must tick on the posting form, and added
  as a report reason ("This is graded coursework"). An admin who upholds such a report cancels the commission,
  refunds nothing to the client, and it counts as an upheld report.
- **Money.** Only alumni and clubs can attach money to a commission. It is an amount and a note recorded on the
  commission, with a "marked as paid" tick, exactly like alumni grants. Connect never holds or moves it. A
  commission between two students is credit only.

## 10. Data model

New tables:

```sql
role_skills        (role_id, skill, importance, PRIMARY KEY (role_id, skill))
project_skills     (project_id, skill, PRIMARY KEY (project_id, skill))          -- the skills a project used
member_skills      (project_id, user_id, skill, by_id, PRIMARY KEY (project_id, user_id, skill, by_id))
review_invites     (project_id, reviewer_id, created_at, PRIMARY KEY (project_id, reviewer_id))
live_checks        (id, project_id, url, ok, status, created_at)
evidence           (id, user_id, college_id, kind, title, url, file_key, skills, value, status, method,
                    decided_by, note, created_at, decided_at)
evidence_confirms  (evidence_id, user_id, PRIMARY KEY (evidence_id, user_id))
commissions        (id, college_id, client_id, club_id, title, brief, deadline, reward, money, money_note,
                    money_paid, status, doer_id, proof_url, rating, rating_note, reviewer_id, review_ok,
                    dispute_by, dispute_reason, resolution, paid_credit,
                    created_at, assigned_at, delivered_at, closed_at)
commission_skills      (commission_id, skill, importance, PRIMARY KEY (commission_id, skill))
commission_apps        (id, commission_id, user_id, note, status, created_at, UNIQUE (commission_id, user_id))
commission_milestones  (id, commission_id, title, done)
gifts                  (id, college_id, from_id, to_id, amount, note, created_at)
```

New columns, added through `COLUMNS` in `lib/db.ts`:

```
projects.live_url TEXT, projects.repo TEXT
members.commits INTEGER
reviews.created_at INTEGER, reviews.audit INTEGER DEFAULT 0     -- audit = an admin's verdict
reports.result TEXT DEFAULT ''                                  -- '', 'upheld', 'dismissed'
reports.reason_kind TEXT DEFAULT ''                             -- '', 'coursework', ...
users.github_id TEXT, users.github_login TEXT                   -- set only by GitHub sign-in
```

Code layout:

- `lib/credit.ts`: `RULES`, `shares()`, `compute()` (extended with earned/balance, commissions, review rewards,
  vouch caps and rings).
- `lib/credibility.ts`, `lib/skills.ts` (names and competency), `lib/relevance.ts` (replaces the scoring in
  `lib/match.ts`; `roleSkills()` and `fitFor()` stay), `lib/commissions.ts` (pair cap and state rules).
- Each calculation is a pure function over plain rows, with a thin wrapper that loads the rows, so the tests can
  call the formulas without a database.

## 11. Migration

- Only new tables and columns. No existing row is rewritten, and nothing is deleted.
- **Carry-over.** Project, stake and starter lines are untouched. Vouches made before `cutover` keep their old
  weight. So on release day every person's credit is the same as the day before. A test seeds the sample data,
  records everyone's credit with the old `compute()`, and asserts the new one gives the same numbers.
- **Old shipped projects have no confirmed skills**, so they start with no competency evidence. Each teammate of
  an old shipped project gets a one-time prompt: "Tick the skills your teammates used on BusPing". Once half the
  team has answered, the project counts. Old solo projects need an admin to confirm the skills. Until then those
  people show credit and credibility but "No proof yet" for skills.
- Old reviews have no outcome record beyond the pot; a review counts as "matched" if its verdict equals the pot.
- Before trying any of this on real data: copy `data/connect.db` first. All development runs on a scratch copy
  through `DATABASE_PATH`.

## 12. Build phases

Each phase ends with tests and one commit.

1. **Credibility**: `lib/credibility.ts`, `reports.result`, shown on profiles; vouch cap, ring detection and
   credibility-weighted vouches in `compute()`; earned vs balance.
2. **Competency**: skill names, `role_skills`, `project_skills`, `member_skills`, ticking skills in the split
   form and the review form, the backfill prompt, skill scores on profiles.
3. **Evidence and admin queues**: `evidence` with upload, the admin queue, teammate confirmation, live
   URL check, reviewer invites with distance and the tie-break verdict, split flags.
4. **Relevance**: `lib/relevance.ts`, suggestions with reasons on the project page, "Fits you" on the board.
5. **Commissions and gifts**: tables, actions, pages, pair cap, disputes in admin, the coursework rule in terms,
   form and report reasons; sending credit with its limits.
6. **`/rules`**: rewritten in plain words, every number read from `RULES`.

GitHub sign-in is left out of the phases until the OAuth app exists; the split check works without it, using
milestones and updates only.

Tests to add in `scripts/test.ts`, one per formula and one per attack:

- A self-claim, a typed skill and a typed GitHub link change no number.
- A vouch ring is detected and down-weighted; a sixth vouch adds nothing; a low-credibility vouch is worth less.
- A lone 95% split is pulled to the median.
- One project cannot lift a skill above 50; confidence grows with evidence; old evidence counts half at 18 months.
- A skill ticked only by the person themselves, or by under half the team, does not count.
- Marks: there is no evidence kind for CGPA, so a submitted transcript cannot be stored or scored.
- A gift raises the receiver's balance but not their earned credit, skills or credibility; the pair, sender and
  receiver limits hold.
- Tier B moves a skill less than the same evidence at Tier A; rejected evidence lowers credibility.
- A reviewer inside the team's network is never invited; an inaccurate reviewer loses credibility.
- A third commission between the same pair inside the window is refused; the credit cap holds in both directions.
- Escrow lowers the balance but not earned credit; a cancelled commission returns it.
- A client below `minClientCredit` cannot post.
- Relevance: proof beats a listed skill, an overloaded person ranks lower, each suggestion has a reason.
- Carry-over: sample data gives identical credit before and after.

## 13. Decisions taken

1. **CGPA**: not used. No marks of any kind feed any score.
2. **Money on commissions**: alumni and clubs only, recorded and never handled. Student-to-student is credit only.
3. **Transfers**: allowed as capped gifts that move balance only (section 3).
4. **Display**: 0–100 with a confidence word and the reason.
