# Security Policy — C54 Casino

_Last updated: 2026-10-21_

This document explains how the C54 Casino app is secured, what was changed after
the credential incident, and what every contributor has to keep in mind.

---

## 1. The threat model in one paragraph

C54 Casino is a **no-login PWA**. There is no sign-up, no session, no password.
Every visitor of <https://c54-casino.vercel.app> gets the same public
credentials from `supabase-config.js` and talks to the Supabase REST API
directly. Therefore the **only** thing standing between "any person on the
internet" and "every row of the database" is **Row Level Security (RLS)**.

---

## 2. The Supabase anon key is public by design

`supabase-config.js` contains:

* `SUPABASE_URL` — the project URL (public information)
* `SUPABASE_ANON_KEY` — a JWT whose `role` claim is `anon` (public information)

This is **not a credential leak**. Every Supabase app ships the anon key to the
browser; it is designed to be visible, and by itself it grants nothing. The
security boundary is the **RLS policy set** defined in `init_tables.js`.

What must **never** appear in this repository, in the browser bundle, or in any
client-side code:

| Secret | Where it belongs |
| --- | --- |
| Postgres password / superuser connection string | Local `.env` only (git-ignored) |
| `service_role` key | Server-side only (Edge Function / backend) |
| Database password of any kind | Local `.env` only |

`npm test` (`security.test.js`) fails the build if a Postgres URL with a
literal password ever shows up in a tracked file again.

---

## 3. What happened, and what was fixed

| Issue | Status |
| --- | --- |
| A **superuser** Postgres connection string (with password) was committed in `init_tables.js` and in `test_suite.js` and published to a public GitHub repository. A superuser **bypasses RLS entirely**, so anyone who cloned the repo could read and tamper with every row. | **Removed** from the code and **purged from the git history** (`git filter-repo --replace-text`, all 24 commits, force-pushed). The live password was **not** rotated — see §7 for why and for the two-minute dashboard action that closes it. |
| `npm test` connected to the **production** database and asserted hardcoded production row counts (38 Teen Patti games / 36 Rummy games), so it both mutated production and failed whenever real gameplay changed the numbers. | **Fixed.** The suite now reads `TEST_DATABASE_URL` from the environment, refuses to run against production, and uses **relative** assertions. |
| RLS granted `USING (true)` to anonymous callers for SELECT/INSERT on all six tables and UPDATE on `live_sessions` / `settlement_ledger`. | **Tightened.** The policy set is now the minimum the app needs, with an explicit deny on anonymous DELETE, scoped INSERT checks, and a policy sweep that removes legacy permissive policies. |
| `supabase-config.js` was the only way to point the app at a project — a rebuild was needed for every change. | **Fixed.** Values can be overridden at runtime via `window.__ENV__`. |

---

## 4. The RLS policy set (the actual security boundary)

Applied by `init_tables.js` (idempotent, safe to re-run):

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `teen_patti_games` | anon | anon (shape-checked) | — | denied |
| `rummy_games` | anon | anon (shape-checked) | — | denied |
| `players` | anon | anon (`is_preset = false`) | — | denied |
| `live_sessions` | anon | anon (known game type, `status = 'active'`) | anon, only while `status = 'active'` | denied |
| `settlement_ledger` | anon | anon (non-negative amount, two different players) | — | denied |
| `settle_ups` | anon | anon (non-negative amount, two different players) | — | denied |

* RLS is **deny-by-default**: if no policy matches an operation, Postgres
  refuses it. The explicit `Deny anon delete …` policies exist so the intent
  is auditable instead of implicit.
* The `postgres` role (Supabase dashboard, migrations, backups) is **not**
  affected — it owns the tables and `FORCE ROW LEVEL SECURITY` is deliberately
  **not** enabled.
* `init_tables.js` ends with a **policy sweep**: any policy on these six
  tables that is not in the table above is dropped. That is how the old
  permissive `Allow anon update settlement_ledger` policy is actually removed
  from an existing database instead of lingering next to the new set.

### The trade-off (please read before adding a policy)

Because the app has **no login**, a policy cannot say *who* is writing — only
*what* may be written. Every write policy above is therefore scoped by the
**shape** of the row, not by identity. Consequence: a determined visitor can
still write rows that look like a legitimate game or settlement, and can still
end somebody else's live session.

To close that properly, in increasing order of effort:

1. **Supabase anonymous sign-in** — `supabase.auth.signInAnonymously()` gives
   every browser a real `authenticated` JWT, so policies can key on
   `auth.uid()` and on a per-session id.
2. **A server-side proxy** — a Supabase Edge Function (or a small API) holds
   the `service_role` key and enforces ownership before writing.
3. **Minimum viable** — make `live_sessions` writes go through a function and
   keep anonymous access read-only on the money tables.

---

## 5. Running the schema script

```bash
# 1. Copy the template and fill in your connection string
cp .env.example .env       # .env is git-ignored

# 2. Get the connection string:
#    Supabase Dashboard → Project Settings → Database → Connection string → URI
#
#    • DDL (this script): use the DIRECT connection
#        postgresql://postgres.<user>:<password>@db.<project-ref>.supabase.co:5432/postgres
#    • App traffic / long-lived scripts: use the SESSION POOLER
#        postgresql://postgres.<user>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

# 3. Run it
DATABASE_URL='postgresql://…' node init_tables.js
```

The script is **idempotent**: it uses `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, drops-and-recreates its policies, and can be run
as often as you like.

**Production guard:** the script refuses to run against the production host
(`db.ixczvfnzttmiecgqoiek.supabase.co`) unless `ALLOW_PRODUCTION_SCHEMA=1` is
set explicitly.

---

## 6. Running the tests

```bash
npm test          # runs test_suite.js AND security.test.js
```

* `test_suite.js` — settlement algorithm tests (no database needed) plus a
  database section that runs **only** when `TEST_DATABASE_URL` is set. It
  refuses to run against production, refuses to run when `NODE_ENV=production`,
  and refuses to run against a database whose host / name / user does not
  contain the word `test` (override with `ALLOW_NON_MARKERED_TEST_DB=1`).
  Without a test database it prints `SKIP: no test database …` and exits 0.
* `security.test.js` — the regression suite for everything on this page. It
  fails if a credential reappears, if the environment wiring is removed, if
  the anon key disappears from `supabase-config.js`, or if an anonymous DELETE
  grant is ever added back.

---

## 7. Known open items

* **The old superuser password is still valid, and it was still in the git
  history until 2026-10-21.** Both facts were corrected on that date:
  * **History cleaned.** The repository history was rewritten with
    `git filter-repo --replace-text`, replacing the password with
    `<REDACTED>` in all 24 commits, and the rewritten history was
    force-pushed. A scan of every commit in the rewritten history confirms
    the password no longer appears anywhere. The commit hashes changed as a
    result — anyone who cloned before this date should re-clone.
  * **The live database was never rotated, and the password still works.**
    The Supabase Management API refuses to rotate a database password on a
    Free Plan project, and the `postgres` role on this project is not a
    superuser (`rolsuper = false`), so it cannot run
    `ALTER USER postgres WITH PASSWORD ...` for itself either. The
    connection is only reachable over IPv6, which this host does not have.
    **Action required by the owner:** open
    *Supabase Dashboard → C54- Casino → Project Settings → Database →
    Reset database password*, then set the new value as `DATABASE_URL` in
    the local `.env` before running `init_tables.js`. This is a
    two-minute dashboard action and it closes the last open item.
  * Until that is done, the old password remains a live credential for a
    superuser role on a public database.
* **`node_modules/` is committed to the repository** (140 tracked files). It
  should be untracked; see `.gitignore`.
* **The app is a no-login PWA** — see the trade-off note in §4. Until
  anonymous sign-in or a proxy is in place, anonymous callers can write rows
  that look like games/settlements.
* **The "🗑️ Delete Game" buttons in `app.js` cannot delete anything.** They
  have never been able to (there was no anonymous DELETE policy before this
  change either); the UI is vestigial and should be removed or moved behind a
  proxy.

---

## 8. Keepalive — why the project was paused and how we avoid it

Supabase's **Free Plan pauses a project after 7 days of inactivity**. That is
exactly what happened here: project `ixczvfnzttmiecgqoiek` was paused on
**2026-09-27** after a quiet week, and the live app went down until the
project was restored by hand.

`keepalive.js` performs a single cheap authenticated read
(`GET /rest/v1/players?select=name&limit=1`) with the public anon key so the
platform sees recent activity and the project is never paused.

```bash
node keepalive.js          # exit 0 = project is awake, exit 1 = it did not answer

# e.g. a daily cron entry
0 9 * * * /usr/bin/node /path/to/c54-casino/keepalive.js >> /var/log/c54-keepalive.log 2>&1
```

The script never prints the anon key. A **paid** Supabase plan is never paused
for inactivity and removes the need for this script entirely.

---

## 9. Reporting a vulnerability

Please report security issues privately to the repository owner rather than
opening a public issue. Include: what you found, how to reproduce it, and the
impact. Do not include any real credentials in the report.
