const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:Kaustubh@1202@db.ixczvfnzttmiecgqoiek.supabase.co:5432/postgres' });
async function run() {
  try {
    await client.connect();
    await client.query(`create table if not exists teen_patti_games (id uuid default gen_random_uuid() primary key, created_at timestamp with time zone default timezone('utc'::text, now()) not null, data jsonb not null);`);
    await client.query(`create table if not exists rummy_games (id uuid default gen_random_uuid() primary key, created_at timestamp with time zone default timezone('utc'::text, now()) not null, data jsonb not null);`);
    console.log('Tables created successfully!');
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
