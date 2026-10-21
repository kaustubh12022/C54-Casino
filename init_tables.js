// C54 Casino — Database Schema Setup (idempotent, safe to re-run)
// Creates every table, enables Row Level Security and applies the RLS policy set.
//
// ─────────────────────────────────────────────────────────────────────────────
// CREDENTIALS — READ THIS FIRST
// ─────────────────────────────────────────────────────────────────────────────
// The Postgres password is INTENTIONALLY NOT STORED IN THIS REPOSITORY.
//
//   A superuser connection string used to be hardcoded here and was published
//   to a public GitHub repo. A superuser bypasses Row Level Security
//   completely, so anyone who cloned the repo could read and tamper with every
//   row of the production database. The credential has been removed and the
//   password has been rotated at the provider level (see SECURITY.md).
//
//   How to get a connection string:
//     Supabase Dashboard → your project → Project Settings → Database →
//     Connection string → URI.
//
//   Which connection string to use:
//     • DDL (this script: CREATE TABLE / CREATE POLICY / ALTER PUBLICATION):
//       use the DIRECT connection (host `db.<project-ref>.supabase.co`, port 5432).
//       The session pooler (`*.pooler.supabase.com`) does not support some DDL
//       and does not expose the `postgres` publication we need.
//     • Everyday app traffic / long-lived scripts:
//       use the SESSION POOLER (`aws-0-<region>.pooler.supabase.com`, port 5432)
//       so you do not exhaust the small direct-connection pool.
//
//   How to run:
//     $ DATABASE_URL='postgresql://postgres.<user>:<password>@db.<project-ref>.supabase.co:5432/postgres' \
//       node init_tables.js
//
//   Never commit the real value. `.env` is git-ignored; `.env.example`
//   documents the shape of the variable without a real secret.
//
//   Safety net: this script refuses to touch the production database unless
//   ALLOW_PRODUCTION_SCHEMA=1 is set explicitly, so a stray `npm run db:init`
//   can never rewrite the live schema by accident.
// ─────────────────────────────────────────────────────────────────────────────

const { Client } = require('pg');

// ── Resolve the connection string from the environment (never a literal) ──────
const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!connectionString) {
    console.error('❌ DATABASE_URL is not set.');
    console.error('   Set it to your Supabase Postgres URI, e.g.:');
    console.error("     DATABASE_URL='postgresql://postgres.<user>:<password>@db.<project-ref>.supabase.co:5432/postgres' node init_tables.js");
    console.error('   Copy `.env.example` to `.env` and fill it in (`.env` is git-ignored).');
    console.error('   Get the value from: Supabase Dashboard → Project Settings → Database → Connection string → URI.');
    process.exit(1);
}

// Host of the live production database — guarded against accidental writes.
const PRODUCTION_DB_HOST = 'db.ixczvfnzttmiecgqoiek.supabase.co';

function describeTarget(connectionString) {
    try {
        const url = new URL(connectionString);
        return {
            host: url.hostname.toLowerCase(),
            database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
            user: decodeURIComponent(url.username || '')
        };
    } catch (e) {
        return { host: '', database: '', user: '' };
    }
}

const target = describeTarget(connectionString);

// Belt and braces: the parsed host OR the raw connection string must not
// point at production (the string check also covers connection strings that
// the URL parser cannot make sense of).
const targetsProduction = target.host === PRODUCTION_DB_HOST ||
    connectionString.toLowerCase().includes(PRODUCTION_DB_HOST);

if (targetsProduction && process.env.ALLOW_PRODUCTION_SCHEMA !== '1') {
    console.error('❌ Refusing to run the schema script against the PRODUCTION database.');
    console.error(`   Host: ${target.host} / database: ${target.database}`);
    console.error('   Applying DDL to the live database is a deliberate act — re-run with:');
    console.error('     ALLOW_PRODUCTION_SCHEMA=1 DATABASE_URL=... node init_tables.js');
    process.exit(1);
}

const client = new Client({ connectionString });

async function run() {
    let failed = false;
    try {
        await client.connect();

        // ── Game history tables ───────────────────────────────────────────────
        await client.query(`
            CREATE TABLE IF NOT EXISTS teen_patti_games (
                id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
                data jsonb NOT NULL
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS rummy_games (
                id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
                data jsonb NOT NULL
            );
        `);

        // Players table (replaces Firebase)
        await client.query(`
            CREATE TABLE IF NOT EXISTS players (
                id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
                name text NOT NULL UNIQUE,
                is_preset boolean DEFAULT false
            );
        `);

        // Live sessions table (for real-time sync across devices)
        await client.query(`
            CREATE TABLE IF NOT EXISTS live_sessions (
                id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                game_type text NOT NULL CHECK (game_type IN ('teenpatti', 'rummy')),
                session_data jsonb NOT NULL,
                status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
                created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
                updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
            );
        `);

        // Keep only one active live session per game before enforcing uniqueness.
        await client.query(`
            WITH ranked AS (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY game_type
                        ORDER BY updated_at DESC, created_at DESC, id DESC
                    ) AS rn
                FROM live_sessions
                WHERE status = 'active'
            )
            UPDATE live_sessions AS ls
            SET status = 'ended', updated_at = timezone('utc'::text, now())
            FROM ranked
            WHERE ls.id = ranked.id
                AND ranked.rn > 1;
        `);

        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS live_sessions_one_active_per_game_idx
            ON live_sessions (game_type)
            WHERE status = 'active';
        `);

        // Settlement ledger table (Splitwise-like)
        await client.query(`
            CREATE TABLE IF NOT EXISTS settlement_ledger (
                id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                from_player text NOT NULL,
                to_player text NOT NULL,
                amount numeric NOT NULL,
                paid_amount numeric NOT NULL DEFAULT 0,
                status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'settled')),
                game_label text,
                created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
                settled_at timestamptz
            );
        `);

        // Settle ups table (actual mistake correction records)
        await client.query(`
            CREATE TABLE IF NOT EXISTS settle_ups (
                id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                from_player text NOT NULL,
                to_player text NOT NULL,
                amount numeric NOT NULL,
                note text,
                created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
            );
        `);

        // ── Row Level Security ────────────────────────────────────────────────
        // NOTE: we deliberately do NOT use FORCE ROW LEVEL SECURITY. The table
        // owner / `postgres` role keeps full access (that is how the Supabase
        // dashboard, migrations and backups work); the policies below are the
        // boundary for the `anon` role, i.e. the key that ships inside the app.
        await client.query(`ALTER TABLE teen_patti_games ENABLE ROW LEVEL SECURITY;`);
        await client.query(`ALTER TABLE rummy_games ENABLE ROW LEVEL SECURITY;`);
        await client.query(`ALTER TABLE players ENABLE ROW LEVEL SECURITY;`);
        await client.query(`ALTER TABLE live_sessions ENABLE ROW LEVEL SECURITY;`);
        await client.query(`ALTER TABLE settlement_ledger ENABLE ROW LEVEL SECURITY;`);
        await client.query(`ALTER TABLE settle_ups ENABLE ROW LEVEL SECURITY;`);

        // ═════════════════════════════════════════════════════════════════════
        //  RLS POLICY SET
        // ═════════════════════════════════════════════════════════════════════
        // WHY THIS IS THE SECURITY BOUNDARY
        //   The browser ships the Supabase *anon* key. That key is public by
        //   design (a JWT with role "anon") — it grants nothing on its own.
        //   Every row the app can touch is filtered by the policies below.
        //   If a policy is missing, Postgres DENIES the operation (RLS is
        //   deny-by-default, not allow-by-default). So "no policy" is the safe
        //   default and every grant below is an explicit, reviewed decision.
        //
        //   THE TRADE-OFF (read this before adding a policy)
        //   This is a no-login PWA: there is no sign-in, therefore there is no
        //   "who is this caller" that a policy can key off. That is why the
        //   write policies below are scoped by *shape* rather than by *identity*:
        //   we constrain what a row may look like, not who may write it.
        //   Consequence: any visitor of the deployed app can still write rows
        //   that look like a legitimate game or settlement. That is a
        //   deliberate trade-off for a friends-and-family scorecard PWA.
        //
        //   HOW TO CLOSE IT PROPERLY (in order of effort)
        //   1. Supabase anonymous sign-in (`supabase.auth.signInAnonymously()`).
        //      Gives every browser a real `authenticated` JWT; policies can then
        //      use `auth.uid()` and (with a room/session id) restrict writes to
        //      the session that created them.
        //   2. A server-side proxy (Supabase Edge Function / a small API): the
        //      browser talks to your backend, the backend holds the service-role
        //      key and enforces ownership before writing.
        //   3. At minimum: move `live_sessions` writes behind a function and
        //      keep anon access read-only on the money tables.
        //
        // POLICY MATRIX (matches the operations app.js actually performs)
        //   table               SELECT   INSERT   UPDATE   DELETE
        //   teen_patti_games      yes      yes      no       no (explicit deny)
        //   rummy_games           yes      yes      no       no (explicit deny)
        //   players               yes      yes      no       no (explicit deny)
        //   live_sessions         yes      yes      yes*     no (explicit deny)
        //   settlement_ledger     yes      yes      no       no (explicit deny)
        //   settle_ups            yes      yes      no       no (explicit deny)
        //   * live_sessions UPDATE is scoped to rows that are still 'active'.
        // ═════════════════════════════════════════════════════════════════════

        // ── teen_patti_games ──────────────────────────────────────────────────
        await client.query(`
            DO $$
            BEGIN
                -- WHY: the leaderboard, the history list and the settlement
                -- screen all read every finished Teen Patti game
                -- (app.js: refreshLeaderboard / refreshSettlements).
                -- Rows are scorecards, not secrets, and there is no per-user
                -- ownership concept in this app.
                DROP POLICY IF EXISTS "Allow anon select teen_patti_games" ON teen_patti_games;
                CREATE POLICY "Allow anon select teen_patti_games" ON teen_patti_games FOR SELECT USING (true);

                -- WHY: saving a finished game (app.js: saveTpGame) inserts one
                -- row per game. The WITH CHECK keeps the row a *game record*:
                -- a JSON object that actually carries a "players" array.
                -- It does NOT stop a determined caller from forging scores —
                -- only auth (or a proxy) can do that.
                DROP POLICY IF EXISTS "Allow anon insert teen_patti_games" ON teen_patti_games;
                CREATE POLICY "Allow anon insert teen_patti_games" ON teen_patti_games FOR INSERT
                    WITH CHECK (data IS NOT NULL AND jsonb_typeof(data) = 'object' AND data ? 'players');

                -- WHY: history is append-only. RLS already denies DELETE when
                -- no policy matches; this policy makes the denial explicit and
                -- auditable instead of implicit. NOTE: app.js still renders a
                -- "🗑️ Delete Game" button, which therefore cannot delete
                -- anything (it has never been able to — there was no DELETE
                -- policy before this script either). The UI is vestigial and
                -- should be removed, or re-implemented behind a proxy.
                DROP POLICY IF EXISTS "Deny anon delete teen_patti_games" ON teen_patti_games;
                CREATE POLICY "Deny anon delete teen_patti_games" ON teen_patti_games FOR DELETE USING (false);
            END $$;
        `);

        // ── rummy_games ───────────────────────────────────────────────────────
        await client.query(`
            DO $$
            BEGIN
                -- WHY: identical to teen_patti_games — the leaderboard and the
                -- history list read every finished Rummy game (app.js).
                DROP POLICY IF EXISTS "Allow anon select rummy_games" ON rummy_games;
                CREATE POLICY "Allow anon select rummy_games" ON rummy_games FOR SELECT USING (true);

                -- WHY: saving a finished Rummy game (app.js: saveRumGame).
                -- Same shape constraint as Teen Patti: a JSON object with a
                -- "players" array.
                DROP POLICY IF EXISTS "Allow anon insert rummy_games" ON rummy_games;
                CREATE POLICY "Allow anon insert rummy_games" ON rummy_games FOR INSERT
                    WITH CHECK (data IS NOT NULL AND jsonb_typeof(data) = 'object' AND data ? 'players');

                -- WHY: append-only history, explicit deny (see above). The
                -- "🗑️ Delete Game" button in app.js is vestigial and has never
                -- had permission to delete anything.
                DROP POLICY IF EXISTS "Deny anon delete rummy_games" ON rummy_games;
                CREATE POLICY "Deny anon delete rummy_games" ON rummy_games FOR DELETE USING (false);
            END $$;
        `);

        // ── players ───────────────────────────────────────────────────────────
        await client.query(`
            DO $$
            BEGIN
                -- WHY: loadPlayers() reads the roster so previously added
                -- players show up as chips (app.js: .from('players').select('name')).
                DROP POLICY IF EXISTS "Allow anon select players" ON players;
                CREATE POLICY "Allow anon select players" ON players FOR SELECT USING (true);

                -- WHY: saveNewPlayer() adds a custom player (app.js:
                -- .from('players').insert([{ name, is_preset: false }])).
                -- The WITH CHECK keeps the row a *custom* player: it can never
                -- masquerade as a built-in preset, and the name must be a
                -- non-empty, sane-length string (the UI caps it at 20 chars).
                DROP POLICY IF EXISTS "Allow anon insert players" ON players;
                CREATE POLICY "Allow anon insert players" ON players FOR INSERT
                    WITH CHECK (is_preset = false AND char_length(btrim(name)) BETWEEN 1 AND 64);

                -- WHY: the app never renames or removes a player — there is no
                -- UPDATE/DELETE code path for the players table anywhere in
                -- app.js - so
                -- anon UPDATE/DELETE are deliberately NOT granted. Editing a
                -- roster is an owner action and belongs behind a proxy/login.
                DROP POLICY IF EXISTS "Deny anon delete players" ON players;
                CREATE POLICY "Deny anon delete players" ON players FOR DELETE USING (false);
            END $$;
        `);

        // ── live_sessions (the only genuinely write-heavy table) ─────────────
        await client.query(`
            DO $$
            BEGIN
                -- WHY: a joining device must be able to discover the active
                -- session and its game state (app.js: checkActiveSessions /
                -- joinLiveSession — .from('live_sessions').select('*')).
                DROP POLICY IF EXISTS "Allow anon select live_sessions" ON live_sessions;
                CREATE POLICY "Allow anon select live_sessions" ON live_sessions FOR SELECT USING (true);

                -- WHY: starting a game creates the shared session row
                -- (app.js: createLiveSession). The WITH CHECK restricts the row
                -- to a real session: a known game type, a JSON object payload
                -- and status 'active' (sessions are always created active and
                -- later transitioned to 'ended' by an UPDATE).
                -- TRADE-OFF: because there is no login, any visitor can open a
                -- session and own it. Closing this properly requires Supabase
                -- anonymous sign-in (auth.uid() based policies) or a server-side
                -- proxy that creates the session on the client's behalf.
                DROP POLICY IF EXISTS "Allow anon insert live_sessions" ON live_sessions;
                CREATE POLICY "Allow anon insert live_sessions" ON live_sessions FOR INSERT
                    WITH CHECK (
                        game_type IN ('teenpatti', 'rummy')
                        AND status = 'active'
                        AND session_data IS NOT NULL
                        AND jsonb_typeof(session_data) = 'object'
                    );

                -- WHY: real-time sync. syncLiveSession() writes the running
                -- scoreboard, endLiveSession()/endSessionById() close it and
                -- checkActiveSessions() ends stale sessions.
                -- The UPDATE is scoped to rows that are still 'active':
                --   USING (status = 'active')            -> an already closed
                --       session can no longer be rewritten after the fact.
                --   WITH CHECK (status IN ('active','ended')) -> the only
                --       allowed transition is active -> ended.
                -- TRADE-OFF: with no login, any visitor can still end another
                -- player's session. Restricting that needs auth or a proxy.
                DROP POLICY IF EXISTS "Allow anon update live_sessions" ON live_sessions;
                CREATE POLICY "Allow anon update live_sessions" ON live_sessions FOR UPDATE
                    USING (status = 'active')
                    WITH CHECK (status IN ('active', 'ended'));

                -- WHY: sessions are ephemeral; no client code deletes them.
                DROP POLICY IF EXISTS "Deny anon delete live_sessions" ON live_sessions;
                CREATE POLICY "Deny anon delete live_sessions" ON live_sessions FOR DELETE USING (false);
            END $$;
        `);

        // ── settlement_ledger ────────────────────────────────────────────────
        await client.query(`
            DO $$
            BEGIN
                -- WHY: read access to the settlement ledger (who owes whom) for
                -- the settlement screens and for auditing. The current app
                -- writes to it but derives the UI from game data + settle_ups;
                -- the read grant is kept because it is the natural source for
                -- that screen and it exposes nothing that is not already
                -- visible in the app.
                DROP POLICY IF EXISTS "Allow anon select settlement_ledger" ON settlement_ledger;
                CREATE POLICY "Allow anon select settlement_ledger" ON settlement_ledger FOR SELECT USING (true);

                -- WHY: every finished game pushes its transfers into the ledger
                -- (app.js: pushToSettlementLedger). The WITH CHECK keeps a row
                -- a well-formed obligation: a non-negative amount between two
                -- different players and a known status.
                DROP POLICY IF EXISTS "Allow anon insert settlement_ledger" ON settlement_ledger;
                CREATE POLICY "Allow anon insert settlement_ledger" ON settlement_ledger FOR INSERT
                    WITH CHECK (
                        status IN ('pending', 'partial', 'settled')
                        AND amount >= 0
                        AND from_player <> to_player
                    );

                -- WHY: the app never UPDATEs or DELETEs ledger rows — it only
                -- inserts them — so anon UPDATE/DELETE are deliberately NOT
                -- granted. The legacy permissive policy
                -- "Allow anon update settlement_ledger" (USING (true)) is
                -- removed by the policy sweep below, so re-running this script
                -- on the live database actually closes that hole instead of
                -- leaving the old policy in place.
                DROP POLICY IF EXISTS "Deny anon delete settlement_ledger" ON settlement_ledger;
                CREATE POLICY "Deny anon delete settlement_ledger" ON settlement_ledger FOR DELETE USING (false);
            END $$;
        `);

        // ── settle_ups ───────────────────────────────────────────────────────
        await client.query(`
            DO $$
            BEGIN
                -- WHY: settle_ups are the manual settle-up records; the
                -- leaderboard and settlement views read them to net out every
                -- player's balance (app.js: refreshLeaderboard / refreshSettlements).
                DROP POLICY IF EXISTS "Allow anon select settle_ups" ON settle_ups;
                CREATE POLICY "Allow anon select settle_ups" ON settle_ups FOR SELECT USING (true);

                -- WHY: recording a settlement (app.js: settleTransfer /
                -- settleAllTransfers) inserts a correction row. The WITH CHECK
                -- keeps it a plausible correction: non-negative amount between
                -- two different, non-empty players.
                DROP POLICY IF EXISTS "Allow anon insert settle_ups" ON settle_ups;
                CREATE POLICY "Allow anon insert settle_ups" ON settle_ups FOR INSERT
                    WITH CHECK (
                        amount >= 0
                        AND from_player <> to_player
                        AND char_length(btrim(from_player)) > 0
                        AND char_length(btrim(to_player)) > 0
                    );

                -- WHY: settle-ups are an audit trail of money movements —
                -- they are never edited or removed by the app, so anon
                -- UPDATE/DELETE are deliberately NOT granted. A settle-up can
                -- be compensated with a new, opposite settle-up row, which is
                -- what the app does today.
                DROP POLICY IF EXISTS "Deny anon delete settle_ups" ON settle_ups;
                CREATE POLICY "Deny anon delete settle_ups" ON settle_ups FOR DELETE USING (false);
            END $$;
        `);

        // ── Policy sweep: drop everything that is not in the matrix above ────
        // Keeps the script honest on an existing database: any legacy or
        // hand-made policy (for example the old permissive
        // "Allow anon update settlement_ledger") is removed instead of
        // silently lingering next to the new, tighter set.
        await client.query(`
            DO $sweep$
            DECLARE
                pol record;
                allowed_keys constant text[] := ARRAY[
                    'teen_patti_games|Allow anon select teen_patti_games',
                    'teen_patti_games|Allow anon insert teen_patti_games',
                    'teen_patti_games|Deny anon delete teen_patti_games',
                    'rummy_games|Allow anon select rummy_games',
                    'rummy_games|Allow anon insert rummy_games',
                    'rummy_games|Deny anon delete rummy_games',
                    'players|Allow anon select players',
                    'players|Allow anon insert players',
                    'players|Deny anon delete players',
                    'live_sessions|Allow anon select live_sessions',
                    'live_sessions|Allow anon insert live_sessions',
                    'live_sessions|Allow anon update live_sessions',
                    'live_sessions|Deny anon delete live_sessions',
                    'settlement_ledger|Allow anon select settlement_ledger',
                    'settlement_ledger|Allow anon insert settlement_ledger',
                    'settlement_ledger|Deny anon delete settlement_ledger',
                    'settle_ups|Allow anon select settle_ups',
                    'settle_ups|Allow anon insert settle_ups',
                    'settle_ups|Deny anon delete settle_ups'
                ];
            BEGIN
                FOR pol IN
                    SELECT tablename, policyname
                    FROM pg_policies
                    WHERE schemaname = 'public'
                      AND tablename IN (
                          'teen_patti_games', 'rummy_games', 'players',
                          'live_sessions', 'settlement_ledger', 'settle_ups'
                      )
                LOOP
                    IF (pol.tablename || '|' || pol.policyname) <> ALL(allowed_keys) THEN
                        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
                    END IF;
                END LOOP;
            END $sweep$;
        `);

        // Enable Realtime on live_sessions
        await client.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
                    IF NOT EXISTS (
                    SELECT 1
                    FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime'
                        AND schemaname = 'public'
                        AND tablename = 'live_sessions'
                ) THEN
                    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE live_sessions';
                END IF;
            ELSE
                -- Not a Supabase project (or the publication was removed):
                -- realtime replication cannot be configured here, but the rest
                -- of the schema is valid. Skip instead of failing the run.
                RAISE NOTICE 'publication supabase_realtime does not exist - skipping realtime publication setup';
            END IF;
            END $$;
        `);

        console.log('✅ All tables created successfully!');
        console.log('✅ RLS policies applied (tightened policy set + legacy policies swept).');
        console.log('✅ Realtime enabled for live_sessions!');
    } catch (e) {
        failed = true;
        console.error('Error:', e.message || e);
    } finally {
        await client.end();
        process.exit(failed ? 1 : 0);
    }
}

run();
