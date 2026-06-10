// C54 Casino — Database Table Setup
// Run once to create all required Supabase tables
// Usage: node init_tables.js

const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:Kaustubh@1202@db.ixczvfnzttmiecgqoiek.supabase.co:5432/postgres' });

async function run() {
  try {
    await client.connect();

    // Game history tables
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
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // Enable RLS on all tables
    await client.query(`ALTER TABLE teen_patti_games ENABLE ROW LEVEL SECURITY;`);
    await client.query(`ALTER TABLE rummy_games ENABLE ROW LEVEL SECURITY;`);
    await client.query(`ALTER TABLE players ENABLE ROW LEVEL SECURITY;`);
    await client.query(`ALTER TABLE live_sessions ENABLE ROW LEVEL SECURITY;`);
    await client.query(`ALTER TABLE settlement_ledger ENABLE ROW LEVEL SECURITY;`);

    // RLS Policies — allow anon access for this app
    const tables = ['teen_patti_games', 'rummy_games', 'players', 'live_sessions', 'settlement_ledger'];
    for (const table of tables) {
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = 'Allow anon select ${table}') THEN
            CREATE POLICY "Allow anon select ${table}" ON ${table} FOR SELECT USING (true);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = 'Allow anon insert ${table}') THEN
            CREATE POLICY "Allow anon insert ${table}" ON ${table} FOR INSERT WITH CHECK (true);
          END IF;
        END $$;
      `);
    }

    // live_sessions also needs UPDATE policy for real-time sync
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'live_sessions' AND policyname = 'Allow anon update live_sessions') THEN
          CREATE POLICY "Allow anon update live_sessions" ON live_sessions FOR UPDATE USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `);

    // settlement_ledger needs UPDATE policy for settle-up actions
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settlement_ledger' AND policyname = 'Allow anon update settlement_ledger') THEN
          CREATE POLICY "Allow anon update settlement_ledger" ON settlement_ledger FOR UPDATE USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `);

    // Enable Realtime on live_sessions
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = 'live_sessions'
        ) THEN
          EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE live_sessions';
        END IF;
      END $$;
    `);

    console.log('✅ All tables created successfully!');
    console.log('✅ RLS policies applied!');
    console.log('✅ Realtime enabled for live_sessions!');
  } catch(e) {
    console.error('Error:', e.message || e);
  } finally {
    await client.end();
    process.exit(0);
  }
}

run();
