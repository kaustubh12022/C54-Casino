// ─────────────────────────────────────────────────────────────────────────────
// C54 Casino — Security regression tests
//
// These tests guard the fixes made after the hardcoded-credential incident:
//   1. No file in the repository (node_modules excluded) may contain a Postgres
//      connection string with an inline password.
//   2. init_tables.js must read its connection string from the environment.
//   3. test_suite.js must read from the environment and must REFUSE to run
//      against the production database.
//   4. supabase-config.js must still ship the expected anon key, so a broken
//      build is caught before it reaches production.
//   5. The RLS block in init_tables.js must not grant anonymous DELETE on the
//      history tables.
//
// Style follows test_suite.js: hand-rolled assert() + pass/fail counters.
// Run with: node security.test.js
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`  PASS: ${message}`);
    } else {
        failed++;
        console.error(`  FAIL: ${message}`);
    }
}

const ROOT = __dirname;
const SKIP_DIRS = new Set(['node_modules', '.git', '.vercel', '.next', 'dist', 'build', 'coverage', '.cache']);

// The production database host. The test suite must never be able to touch it.
const PRODUCTION_DB_HOST = 'db.ixczvfnzttmiecgqoiek.supabase.co';

// The public anon key — it is public by design, and it must stay in
// supabase-config.js so the deployed app keeps working.
const EXPECTED_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4Y3p2Zm56dHRtaWVjZ3FvaWVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODEyNzAsImV4cCI6MjA5NjE1NzI3MH0.aFvyi9hsXxN-21AS1ecaBI0OzYLkdxbsqVLIJtC3xGU';
const EXPECTED_SUPABASE_URL = 'https://ixczvfnzttmiecgqoiek.supabase.co';

// ── Helpers ──────────────────────────────────────────────────────────────────

function listFiles(dir, acc) {
    acc = acc || [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return acc;
    }
    entries.forEach(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) return;
            listFiles(full, acc);
        } else if (entry.isFile()) {
            acc.push(full);
        }
    });
    return acc;
}

function readTextFile(file) {
    let buf;
    try {
        buf = fs.readFileSync(file);
    } catch (e) {
        return null;
    }
    // Skip binary files (images, fonts, ...).
    const probe = buf.slice(0, 8000);
    for (let i = 0; i < probe.length; i++) {
        if (probe[i] === 0) return null;
    }
    return buf.toString('utf8');
}

// A connection string with an inline password: scheme://user:password@host
const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/[^\s:/'"]+:([^@\s'"]+)@/g;
// Placeholders are not credentials — they are documentation.
function isPlaceholderPassword(password) {
    return /^(?:<[^>]*>|\{\{[^}]*\}\}|\$\{[^}]*\}|YOUR_[A-Z0-9_]*|your_[a-z0-9_]*|x{3,}|X{3,}|\*{3,}|changeme|change[_-]?me|placeholder|redacted|password|passwd|example|dummy)$/i
        .test(password);
}

function extractParenExpr(text, keyword) {
    if (!text) return null;
    const idx = text.toUpperCase().indexOf(keyword.toUpperCase());
    if (idx === -1) return null;
    const open = text.indexOf('(', idx);
    if (open === -1) return null;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) return text.slice(open + 1, i).trim();
        }
    }
    return null;
}

function parsePolicies(sql) {
    const re = /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+([a-z_]+)\s+FOR\s+(SELECT|INSERT|UPDATE|DELETE)([\s\S]*?);/gi;
    const policies = [];
    let m;
    while ((m = re.exec(sql)) !== null) {
        const body = m[4] || '';
        policies.push({
            name: m[1],
            table: m[2],
            command: m[3].toUpperCase(),
            using: extractParenExpr(body, 'USING'),
            withCheck: extractParenExpr(body, 'WITH CHECK')
        });
    }
    return policies;
}

// ── 1. No credentials anywhere in the repository ─────────────────────────────

function testNoInlineCredentials() {
    console.log('\n--- 1. No inline database credentials in the repository ---');

    const files = listFiles(ROOT, []);
    const offenders = [];

    files.forEach(file => {
        const text = readTextFile(file);
        if (text === null) return;
        for (const match of text.matchAll(CONNECTION_STRING_PATTERN)) {
            const password = match[1];
            if (isPlaceholderPassword(password)) continue; // documentation, not a credential
            offenders.push(path.relative(ROOT, file));
        }
    });

    const unique = Array.from(new Set(offenders));
    assert(unique.length === 0,
        `No repository file contains a Postgres URL with a literal password (checked ${files.length} files)${unique.length ? ' — offenders: ' + unique.join(', ') : ''}`);
}

// ── 2. init_tables.js reads its credentials from the environment ─────────────

function testInitTablesUsesEnvironment() {
    console.log('\n--- 2. init_tables.js reads the connection string from the environment ---');

    const src = readTextFile(path.join(ROOT, 'init_tables.js')) || '';

    assert(/process\.env\.DATABASE_URL/.test(src), 'init_tables.js reads DATABASE_URL from process.env');
    assert(/process\.env\.SUPABASE_DB_URL/.test(src), 'init_tables.js accepts SUPABASE_DB_URL as an alternative');
    assert(!/connectionString\s*:\s*['"]postgres/i.test(src), 'init_tables.js has no inline connectionString literal');
    assert(/ALLOW_PRODUCTION_SCHEMA/.test(src), 'init_tables.js guards against accidental production DDL');

    const envExample = readTextFile(path.join(ROOT, '.env.example'));
    assert(envExample !== null && /DATABASE_URL/.test(envExample), '.env.example exists and documents DATABASE_URL');
}

// ── 3. test_suite.js is environment-driven and refuses production ───────────

function testTestSuiteRefusesProduction() {
    console.log('\n--- 3. test_suite.js is environment-driven and refuses production ---');

    const src = readTextFile(path.join(ROOT, 'test_suite.js')) || '';

    assert(/process\.env\.TEST_DATABASE_URL/.test(src), 'test_suite.js reads TEST_DATABASE_URL from process.env');
    assert(/process\.env\.DATABASE_URL/.test(src), 'test_suite.js falls back to DATABASE_URL from process.env');
    assert(src.includes(PRODUCTION_DB_HOST), 'test_suite.js knows the production database host');
    assert(!/connectionString\s*:\s*['"]postgres/i.test(src), 'test_suite.js has no inline connectionString literal');

    // Behavioural check: pointing the suite at production must abort.
    const prodUrl = `postgresql://postgres:<password>@${PRODUCTION_DB_HOST}:5432/postgres`;
    const prodRun = spawnSync(process.execPath, [path.join(ROOT, 'test_suite.js')], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
            TEST_DATABASE_URL: prodUrl,
            DATABASE_URL: prodUrl,
            NODE_ENV: 'test'
        })
    });
    const prodOutput = `${prodRun.stdout || ''}${prodRun.stderr || ''}`;
    assert(prodRun.status !== 0, 'test_suite.js exits with a non-zero code when pointed at production');
    assert(/REFUSING TO RUN/i.test(prodOutput), 'test_suite.js prints a refusal when pointed at production');
    assert(prodOutput.includes(PRODUCTION_DB_HOST), 'the refusal message names the production host');

    // Behavioural check: no test database configured must skip cleanly.
    const noDbRun = spawnSync(process.execPath, [path.join(ROOT, 'test_suite.js')], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
            TEST_DATABASE_URL: '',
            DATABASE_URL: '',
            NODE_ENV: 'test'
        })
    });
    const noDbOutput = `${noDbRun.stdout || ''}${noDbRun.stderr || ''}`;
    assert(noDbRun.status === 0, 'test_suite.js exits 0 when no test database is configured');
    assert(/SKIP/i.test(noDbOutput) && /no test database/i.test(noDbOutput),
        'test_suite.js prints a "skipped: no test database" line when no test database is configured');
}

// ── 4. supabase-config.js still ships a working configuration ────────────────

function testSupabaseConfig() {
    console.log('\n--- 4. supabase-config.js ships the expected public configuration ---');

    const src = readTextFile(path.join(ROOT, 'supabase-config.js')) || '';

    assert(src.includes(EXPECTED_ANON_KEY), 'supabase-config.js still contains the expected anon key');
    assert(src.includes(EXPECTED_SUPABASE_URL), 'supabase-config.js still contains the expected project URL');
    assert(/__ENV__/.test(src), 'supabase-config.js supports runtime overrides via window.__ENV__');
    assert(/typeof window\s*!==\s*["']undefined["']/.test(src), 'supabase-config.js is safe to load in Node (window may be undefined)');

    // The anon key is public by design — but it must not leak into scripts
    // that print it.
    const keepalive = readTextFile(path.join(ROOT, 'keepalive.js')) || '';
    assert(keepalive.length > 0, 'keepalive.js exists');
    assert(!keepalive.includes(EXPECTED_ANON_KEY), 'keepalive.js does not embed the anon key');
    assert(/rest\/v1\/players/.test(keepalive), 'keepalive.js pings the players endpoint');
}

// ── 5. RLS policy set is tight ──────────────────────────────────────────────

function testRlsPolicies() {
    console.log('\n--- 5. RLS policies in init_tables.js ---');

    const src = readTextFile(path.join(ROOT, 'init_tables.js')) || '';
    const policies = parsePolicies(src);

    const tables = ['teen_patti_games', 'rummy_games', 'players', 'live_sessions', 'settlement_ledger', 'settle_ups'];
    const historyTables = ['teen_patti_games', 'rummy_games'];

    assert(policies.length > 0, `init_tables.js defines RLS policies (found ${policies.length})`);

    // No policy may grant anonymous DELETE.
    const deleteGrants = policies.filter(p =>
        p.command === 'DELETE' &&
        ((p.using || '').toLowerCase() !== 'false' || (p.withCheck || '').toLowerCase() === 'true')
    );
    assert(deleteGrants.length === 0,
        `No RLS policy grants anonymous DELETE (${deleteGrants.map(p => p.name).join(', ') || 'none'})`);

    // Every table has an explicit deny-delete policy.
    tables.forEach(table => {
        const deny = policies.find(p => p.table === table && p.command === 'DELETE' && (p.using || '').toLowerCase() === 'false');
        assert(!!deny, `${table} has an explicit "deny anonymous DELETE" policy`);
    });

    // The history tables in particular must not be deletable by anon callers.
    historyTables.forEach(table => {
        const bad = policies.filter(p => p.table === table && p.command === 'DELETE' && (p.using || '').toLowerCase() !== 'false');
        assert(bad.length === 0, `${table} has no anonymous DELETE grant`);
    });

    // Every table must remain readable and writable-for-app-purposes.
    tables.forEach(table => {
        assert(policies.some(p => p.table === table && p.command === 'SELECT'), `${table} keeps an anonymous SELECT policy`);
        assert(policies.some(p => p.table === table && p.command === 'INSERT'), `${table} keeps an anonymous INSERT policy`);
    });

    // Only live_sessions may be updated by anonymous callers.
    const updateTables = Array.from(new Set(policies.filter(p => p.command === 'UPDATE').map(p => p.table)));
    assert(updateTables.length === 1 && updateTables[0] === 'live_sessions',
        `Only live_sessions is updatable by anonymous callers (found: ${updateTables.join(', ') || 'none'})`);

    // The live_sessions UPDATE must be scoped, not blanket.
    const liveUpdate = policies.find(p => p.table === 'live_sessions' && p.command === 'UPDATE');
    assert(!!liveUpdate && (liveUpdate.using || '').toLowerCase() !== 'true',
        'The live_sessions UPDATE policy is scoped (not USING (true))');

    // INSERT policies must be scoped by shape, not blanket.
    const blanketInserts = policies.filter(p => p.command === 'INSERT' && (p.withCheck || '').toLowerCase() === 'true');
    assert(blanketInserts.length === 0,
        `No INSERT policy is a blanket WITH CHECK (true) (${blanketInserts.map(p => p.name).join(', ') || 'none'})`);
}

// ── 6. Supporting files ──────────────────────────────────────────────────────

function testSupportingFiles() {
    console.log('\n--- 6. Supporting files ---');

    const gitignore = readTextFile(path.join(ROOT, '.gitignore')) || '';
    const ignoreLines = gitignore.split('\n').map(l => l.trim()).filter(Boolean);

    assert(ignoreLines.includes('.env'), '.gitignore ignores .env');
    assert(ignoreLines.includes('.env.*'), '.gitignore ignores .env.*');
    assert(!ignoreLines.includes('.env.example'), '.gitignore does not ignore .env.example');
    assert(ignoreLines.some(l => l === '!.env.example'), '.gitignore explicitly re-includes .env.example');

    const security = readTextFile(path.join(ROOT, 'SECURITY.md'));
    assert(security !== null && security.length > 0, 'SECURITY.md exists');

    const pkg = readTextFile(path.join(ROOT, 'package.json')) || '';
    assert(/test_suite\.js/.test(pkg) && /security\.test\.js/.test(pkg), 'package.json runs both test files under npm test');
}

// ── Runner ───────────────────────────────────────────────────────────────────

function main() {
    console.log('C54 Casino — Security Regression Tests');
    console.log('========================================');

    testNoInlineCredentials();
    testInitTablesUsesEnvironment();
    testTestSuiteRefusesProduction();
    testSupabaseConfig();
    testRlsPolicies();
    testSupportingFiles();

    console.log(`\n========================================`);
    console.log(`Security Results: ${passed} passed, ${failed} failed`);
    console.log(`========================================\n`);
    if (failed > 0) process.exit(1);
}

main();
