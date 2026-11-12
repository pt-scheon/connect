# Connect

A network for one college where students build projects together. Credit comes only from projects that ship, and teammates and outside reviewers decide what each person earned.

## Run it locally

```bash
npm install
npm run seed   # wipes the local database and adds invented sample people and projects
npm run dev
```

Open http://localhost:3000 and pick a sample person on the sign-in page. That list only exists in development.

## Going live

You need three things: sign-in keys, a server with a disk, and your college's email domain.

### 1. Sign-in keys

Copy `.env.example` to `.env.local` (or set the same names in your host's dashboard).

- **Google.** In Google Cloud Console go to APIs & Services, Credentials, Create OAuth client ID, Web application. Add the redirect URI `<APP_URL>/api/auth/google/callback`. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- **LinkedIn** (optional). Create an app at linkedin.com/developers, add the product "Sign In with LinkedIn using OpenID Connect", set the redirect URL to `<APP_URL>/api/auth/linkedin/callback`.

Someone who uses both with the same verified email lands on one account.

### 2. The rest of the settings

- `APP_URL`: the public address, e.g. `https://connect.yourcollege.in`.
- `SESSION_SECRET`: a long random string (`openssl rand -hex 32`).
- `COLLEGE_EMAIL_DOMAIN`: e.g. `college.ac.in`. A student who signs in with a Google account on this domain is verified at once. Everyone else gets a code by email.
- `RESEND_API_KEY` and `MAIL_FROM`: so the code is emailed. Without them the code is only printed in the server log.
- `ADMIN_EMAILS`: your own sign-in email. Admins approve alumni, register clubs, handle reports and can ship a project with a single review.
- `GEMINI_API_KEY`: turns on "Write with AI" for resumes.

### 3. Hosting

Data lives in one SQLite file, so the host needs a persistent disk. A `Dockerfile` is included:

```bash
docker build -t connect .
docker run -p 3000:3000 -v connect-data:/data --env-file .env.local connect
```

Railway, Fly.io and Render all build this Dockerfile directly. Attach a volume at `/data`. Serverless hosts such as Vercel will not keep the data without moving to a hosted database.

`/api/health` answers uptime checks. Back up `/data/connect.db` on a schedule.

Do not run `npm run seed` on the live server. It wipes everything.

## What sign-in does and does not prove

Google and LinkedIn only share name, photo and email. Neither shares education. So:

- Students are verified by signing in with a college Google account, or by a code sent to their college email. One account per address.
- Alumni are approved by an admin by hand.

## The credit rules

All numbers are in `lib/credit.ts` (`RULES`). Credit is never stored. It is worked out from team, review and split records each time, so it cannot drift or be edited.

- Verified students start with 20.
- A project ships when two people outside the team with 50+ credit review its proof (or one admin). They choose 100 (live and in use), 60 (works, demo only) or send it back. The stricter verdict wins.
- Each teammate splits 100 between the others. Your share is the middle value of what they gave you.
- Asking to join holds 10. It returns on ship and is lost if you leave or two thirds of the team mark you as gone.
- A lead who drops a project loses 10.
- Vouches only count between people who shipped together, once per pair, worth up to 5.
- Solo projects earn half. Credit older than 18 months counts half.

## Checks

```bash
npm test          # the credit rules
npm run typecheck
npm run build
```

## Where things are

- `lib/db.ts` schema and database helpers
- `lib/credit.ts` the credit rules
- `lib/auth.ts` sessions and account records
- `lib/oauth.ts` Google and LinkedIn settings
- `lib/notify.ts` inbox entries, project timeline, rate limits
- `lib/resume.ts` what the AI is given and the Gemini call
- `app/actions.ts` every write, with its permission checks
- `app/client.tsx` the interactive pieces (board, people search, split sliders, toasts)
- `app/landing.tsx` the public home page
- `app/**/page.tsx` the screens
- `scripts/seed.ts` sample data, `scripts/test.ts` tests
- `prototype/connect.html` the first clickable mock-up

## Not built yet

- Real payments. Funding records promises and "paid" marks. Money moves outside the app.
- Email notifications. The inbox is in-app only.
- More than one college per install.
- A privacy policy and terms page. Write these for your college before inviting people.
- Rate limits are kept in memory, which is fine for one server.
