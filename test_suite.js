// Comprehensive Settlement Logic & App Logic Test Suite
//
// ═════════════════════════════════════════════════════════════════════════════
// ⚠️  THIS SUITE NEEDS AN ISOLATED TEST DATABASE — IT MUST NEVER RUN
// ⚠️  AGAINST PRODUCTION.
//
// Why this matters:
//   • The suite writes to the database (it inserts and removes its own probe
//     rows) and it asserts on database content.
//   • It used to connect to the live Supabase project with a hardcoded
//     superuser connection string and to assert hardcoded production row
//     counts, so `npm test` both mutated production and failed every time
//     real gameplay changed the numbers.
//
// Safety rails implemented in this file:
//   1. The connection string comes from the environment only
//      (TEST_DATABASE_URL, falling back to DATABASE_URL). There is no literal
//      credential anywhere in this repository any more.
//   2. A guard refuses to run when NODE_ENV === 'production'.
//   3. A guard refuses to run against the known production host
//      (db.ixczvfnzttmiecgqoiek.supabase.co) — including the production
//      "postgres" database.
//   4. A guard refuses to run against a database whose host / database name /
//      user does not contain a test marker ("test"), unless
//      ALLOW_NON_MARKERED_TEST_DB=1 is set explicitly. That escape hatch can
//      never unlock the production host.
//   5. With no test database configured the database section is SKIPPED (not
//      failed), so `npm test` passes on a machine that has no database.
//
// How to run it with a database:
//   TEST_DATABASE_URL='postgresql://postgres.<user>:<password>@db.<ref>.supabase.co:5432/c54_test' \
//     node test_suite.js
//
// The database assertions describe the production dataset (all debts settled,
// known career totals). Point them at a *copy* of that dataset, or run them
// against the marked "test" database after importing a snapshot — the
// dataset-dependent assertions are skipped automatically on an empty database.
// ═════════════════════════════════════════════════════════════════════════════

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Extract minimumTransactions and findZeroSumSubsets from app.js
const appJs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

const codeToEval = appJs.substring(
    appJs.indexOf('function minimumTransactions'),
    appJs.indexOf('function renderTransfers')
);

const fnExtractor = new Function(`
    ${codeToEval}
    return { minimumTransactions, findZeroSumSubsets };
`);
const { minimumTransactions, findZeroSumSubsets } = fnExtractor();

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

// A dataset-dependent assertion that cannot be evaluated on an empty database.
function skip(message) {
    console.log(`  SKIP: ${message}`);
}

// ── Test database safety guards ──────────────────────────────────────────────

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

// Returns null when the target is safe to use, otherwise the reason to refuse.
function checkTestDatabaseSafety(connectionString) {
    if (process.env.NODE_ENV === 'production') {
        return 'NODE_ENV is "production" — this suite must never run against a production environment.';
    }

    const target = describeTarget(connectionString);

    // Belt and braces: the raw connection string must not mention the
    // production host either, so an unparsable URI can never slip past.
    if (connectionString.toLowerCase().includes(PRODUCTION_DB_HOST)) {
        return `Refusing to run: the connection string points at the PRODUCTION host ${PRODUCTION_DB_HOST}.`;
    }

    if (!target.host) {
        return 'Could not parse the connection string — expected a postgres:// URI.';
    }

    if (target.host === PRODUCTION_DB_HOST && target.database === 'postgres') {
        return `Refusing to run against the PRODUCTION "postgres" database on ${PRODUCTION_DB_HOST}.`;
    }

    if (target.host === PRODUCTION_DB_HOST) {
        return `Refusing to run against the PRODUCTION host ${PRODUCTION_DB_HOST}.`;
    }

    const hasTestMarker = /test/i.test(target.host) ||
        /test/i.test(target.database) ||
        /test/i.test(target.user);

    if (!hasTestMarker) {
        if (process.env.ALLOW_NON_MARKERED_TEST_DB === '1') {
            return null;
        }
        return `The target "${target.database}" on host "${target.host}" does not look like a test database ` +
            '(the host, the database name or the user must contain "test"). ' +
            'Use a dedicated test database, or set ALLOW_NON_MARKERED_TEST_DB=1 if you have verified it is not production.';
    }

    return null;
}

function verifyConservation(balances, transfers) {
    const net = {};
    balances.forEach(b => { net[b.player] = 0; });
    transfers.forEach(t => {
        net[t.from] = (net[t.from] || 0) - Math.round(t.amount * 100);
        net[t.to] = (net[t.to] || 0) + Math.round(t.amount * 100);
    });
    return balances.every(b => {
        const expected = Math.round(b.balance * 100);
        const actual = net[b.player] || 0;
        return Math.abs(expected - actual) <= 1; // within 1 cent residual
    });
}

function runAlgorithmTests() {
    console.log('\n--- 1. Testing minimumTransactions Algorithm ---');

    // 1.1: Empty balances
    assert(minimumTransactions([]).length === 0, 'Empty balances returns empty transfers');

    // 1.2: Single player or all zero balances
    assert(minimumTransactions([{ player: 'A', balance: 0 }, { player: 'B', balance: 0 }]).length === 0, 'Zero balances returns empty transfers');

    // 1.3: Direct two-player transfer
    const t2 = minimumTransactions([{ player: 'A', balance: -50 }, { player: 'B', balance: 50 }]);
    assert(t2.length === 1 && t2[0].from === 'A' && t2[0].to === 'B' && t2[0].amount === 50, 'Two players: A pays B 50');

    // 1.4: Three players (1 debtor, 2 creditors)
    const t3 = minimumTransactions([
        { player: 'A', balance: -70 },
        { player: 'B', balance: 30 },
        { player: 'C', balance: 40 }
    ]);
    assert(t3.length === 2, 'Three players (1 debtor, 2 creditors) settled in 2 transfers');
    assert(verifyConservation([{ player: 'A', balance: -70 }, { player: 'B', balance: 30 }, { player: 'C', balance: 40 }], t3), 'Conservation verified for 3 players');

    // 1.5: Disjoint zero-sum subsets (optimal partition test)
    const t4 = minimumTransactions([
        { player: 'A', balance: -10 },
        { player: 'B', balance: 10 },
        { player: 'C', balance: -20 },
        { player: 'D', balance: 20 }
    ]);
    assert(t4.length === 2, 'Two disjoint pairs settled in exactly 2 transfers');
    assert(verifyConservation([
        { player: 'A', balance: -10 },
        { player: 'B', balance: 10 },
        { player: 'C', balance: -20 },
        { player: 'D', balance: 20 }
    ], t4), 'Conservation verified for disjoint pairs');

    // 1.6: Tricky subset sum (Splitwise benchmark)
    const t5 = minimumTransactions([
        { player: 'A', balance: -4 },
        { player: 'B', balance: -3 },
        { player: 'C', balance: -3 },
        { player: 'D', balance: 6 },
        { player: 'E', balance: 4 }
    ]);
    assert(t5.length === 3, `Tricky subset sum solved in 3 transfers (got ${t5.length})`);
    assert(verifyConservation([
        { player: 'A', balance: -4 },
        { player: 'B', balance: -3 },
        { player: 'C', balance: -3 },
        { player: 'D', balance: 6 },
        { player: 'E', balance: 4 }
    ], t5), 'Conservation verified for tricky subset sum');

    // 1.7: Decimal / Paise precision test (Rummy point values 0.1)
    const t6 = minimumTransactions([
        { player: 'Dhruv', balance: 4.1 },
        { player: 'Aniket', balance: 48.9 },
        { player: 'Nikhil', balance: -32.7 },
        { player: 'Shivam', balance: -20.3 }
    ]);
    assert(verifyConservation([
        { player: 'Dhruv', balance: 4.1 },
        { player: 'Aniket', balance: 48.9 },
        { player: 'Nikhil', balance: -32.7 },
        { player: 'Shivam', balance: -20.3 }
    ], t6), 'Rummy decimal point values conserved exact balances');

    // 1.8: Slight rounding mismatch handling (residue absorption)
    const t7 = minimumTransactions([
        { player: 'P1', balance: 10.01 },
        { player: 'P2', balance: -10.00 }
    ]);
    assert(t7.length === 1 && (t7[0].amount === 10.01 || t7[0].amount === 10.00), 'Handled 1-cent residual mismatch without hanging');

    // 1.9: Large 10-player complex table
    const b10 = [
        { player: 'P1', balance: -100 },
        { player: 'P2', balance: -50 },
        { player: 'P3', balance: -25 },
        { player: 'P4', balance: -10 },
        { player: 'P5', balance: -5 },
        { player: 'P6', balance: 100 },
        { player: 'P7', balance: 50 },
        { player: 'P8', balance: 25 },
        { player: 'P9', balance: 10 },
        { player: 'P10', balance: 5 }
    ];
    const t10 = minimumTransactions(b10);
    assert(t10.length <= 5, `10-player symmetrical match settled in <= 5 transfers (got ${t10.length})`);
    assert(verifyConservation(b10, t10), '10-player balances conserved');

    // 1.10: 1 debtor, 5 creditors
    const b1to5 = [
        { player: 'Debtor', balance: -150 },
        { player: 'C1', balance: 30 },
        { player: 'C2', balance: 30 },
        { player: 'C3', balance: 30 },
        { player: 'C4', balance: 30 },
        { player: 'C5', balance: 30 }
    ];
    const t1to5 = minimumTransactions(b1to5);
    assert(t1to5.length === 5, '1 debtor, 5 creditors produces 5 transfers');
    assert(verifyConservation(b1to5, t1to5), '1 debtor to 5 creditors conserved');

    // 1.11: 5 debtors, 1 creditor
    const b5to1 = [
        { player: 'D1', balance: -20 },
        { player: 'D2', balance: -30 },
        { player: 'D3', balance: -40 },
        { player: 'D4', balance: -50 },
        { player: 'D5', balance: -60 },
        { player: 'Creditor', balance: 200 }
    ];
    const t5to1 = minimumTransactions(b5to1);
    assert(t5to1.length === 5, '5 debtors, 1 creditor produces 5 transfers');
    assert(verifyConservation(b5to1, t5to1), '5 debtors to 1 creditor conserved');

    // 1.12: Multi-subset partitioning with 3 disjoint 3-player subsets (prev. failed with 7 transfers)
    const b3x3 = [
        { player: 'C1', balance: 9 },
        { player: 'D1', balance: -5 },
        { player: 'D2', balance: -4 },
        { player: 'C2', balance: 8 },
        { player: 'D3', balance: -6 },
        { player: 'D4', balance: -2 },
        { player: 'C3', balance: 7 },
        { player: 'D5', balance: -4 },
        { player: 'D6', balance: -3 }
    ];
    const t3x3 = minimumTransactions(b3x3);
    assert(t3x3.length === 6, `3 disjoint 3-player subsets solved in optimal 6 transfers (got ${t3x3.length})`);
    assert(verifyConservation(b3x3, t3x3), '3x3 subsets conserved');

    // 1.13: 4 disjoint pairs
    const b4pairs = [
        { player: 'A', balance: 10 },
        { player: 'B', balance: -10 },
        { player: 'C', balance: 20 },
        { player: 'D', balance: -20 },
        { player: 'E', balance: 30 },
        { player: 'F', balance: -30 },
        { player: 'G', balance: 40 },
        { player: 'H', balance: -40 }
    ];
    const t4pairs = minimumTransactions(b4pairs);
    assert(t4pairs.length === 4, `4 disjoint pairs solved in optimal 4 transfers (got ${t4pairs.length})`);
    assert(verifyConservation(b4pairs, t4pairs), '4 pairs conserved');
}

async function runDatabaseVerification() {
    console.log('\n--- 2. Verifying Current Supabase State ---');

    // ── Resolve the test database from the environment (never a literal) ──────
    const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';
    if (!connectionString) {
        skip('no test database configured (set TEST_DATABASE_URL to run the database suite)');
        return;
    }

    const refusal = checkTestDatabaseSafety(connectionString);
    if (refusal) {
        console.error(`\n❌ REFUSING TO RUN THE DATABASE TEST SUITE\n   ${refusal}\n`);
        process.exit(1);
    }

    const target = describeTarget(connectionString);
    console.log(`  (target: ${target.user || '?'}@${target.host}/${target.database})`);

    const client = new Client({ connectionString });
    await client.connect();

    // 2.1: Verify live_sessions has NO active sessions
    const activeSessions = await client.query("SELECT * FROM live_sessions WHERE status = 'active'");
    assert(activeSessions.rows.length === 0, `No active live sessions left hanging (count = ${activeSessions.rows.length})`);

    // 2.2: Verify settlement_ledger has NO pending items from old sessions
    const pendingLedger = await client.query("SELECT count(*) FROM settlement_ledger WHERE status = 'pending'");
    assert(parseInt(pendingLedger.rows[0].count) === 0, `All historical settlement_ledger entries marked settled (pending = ${pendingLedger.rows[0].count})`);

    // Read the game history (needed by 2.3, 2.4 and 2.5)
    const tp = await client.query('SELECT data FROM teen_patti_games');
    const rum = await client.query('SELECT data FROM rummy_games');

    // 2.3: Verify settle_ups table exists and has settlement records
    const settleUps = await client.query("SELECT * FROM settle_ups ORDER BY created_at DESC");

    // A populated dataset is what the "how many games have we played" style
    // assertions below describe. On an empty test database they cannot be
    // evaluated, so they are skipped instead of failed.
    const hasDataset = tp.rows.length > 0 || rum.rows.length > 0;
    if (hasDataset) {
        assert(settleUps.rows.length >= 7, `settle_ups table has recorded settlements (count = ${settleUps.rows.length})`);
    } else {
        skip('settle_ups settlement-count assertion needs a populated dataset (test database is empty)');
    }

    // 2.4: Verify active net balances across ALL games + settle_ups
    const allGames = [...tp.rows.map(r => r.data), ...rum.rows.map(r => r.data)];

    const currentNet = {};
    allGames.forEach(g => {
        (g.players || []).forEach(p => {
            const amt = p.netAmount ?? p.netBalance ?? 0;
            currentNet[p.name] = (currentNet[p.name] || 0) + amt;
        });
    });

    settleUps.rows.forEach(s => {
        const amt = parseFloat(s.amount);
        currentNet[s.from_player] = (currentNet[s.from_player] || 0) + amt;
        currentNet[s.to_player] = (currentNet[s.to_player] || 0) - amt;
    });

    Object.keys(currentNet).forEach(name => {
        let val = Math.round(currentNet[name] * 100) / 100;
        if (Math.abs(val) < 0.005) val = 0;
        currentNet[name] = val;
    });

    const nonZeroPlayers = Object.entries(currentNet).filter(([_, v]) => Math.abs(v) >= 0.01);
    assert(nonZeroPlayers.length === 0, `Current active values are reset to zero for ALL players (non-zero: ${JSON.stringify(nonZeroPlayers)})`);

    // 2.5: Verify the All-Time games history is intact — RELATIVE assertions.
    //
    // The previous version asserted hardcoded production counts (38 Teen Patti
    // games and 36 Rummy games). That is a bug, not a test: the counts change
    // every time somebody plays a game, so `npm test` failed against a
    // perfectly healthy database. The intent — "the history tables are
    // readable, writable, and keep exactly what was written" — is now checked
    // RELATIVE to what this test does itself:
    //   * COUNT(*) agrees with the number of rows fetched,
    //   * a row inserted by THIS test is immediately retrievable by id,
    //   * the row count grows by exactly 1 on insert,
    //   * the row count returns to the pre-test baseline after cleanup.
    const tpBaseline = tp.rows.length;
    const rumBaseline = rum.rows.length;

    const tpCount = await client.query('SELECT count(*)::int AS c FROM teen_patti_games');
    const rumCount = await client.query('SELECT count(*)::int AS c FROM rummy_games');
    assert(tpCount.rows[0].c === tpBaseline, `teen_patti_games COUNT(*) matches the fetched rows (${tpCount.rows[0].c} === ${tpBaseline})`);
    assert(rumCount.rows[0].c === rumBaseline, `rummy_games COUNT(*) matches the fetched rows (${rumCount.rows[0].c} === ${rumBaseline})`);

    const runMarker = `test-suite-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    async function probeHistoryTable(table, type, baseline) {
        const inserted = await client.query(
            `INSERT INTO ${table} (data) VALUES ($1) RETURNING id`,
            [JSON.stringify({ players: [], _type: type, __test_run__: runMarker })]
        );
        assert(inserted.rows.length === 1, `Test probe row inserted into ${table}`);

        const probeId = inserted.rows[0].id;

        const afterInsert = await client.query(`SELECT count(*)::int AS c FROM ${table}`);
        assert(afterInsert.rows[0].c === baseline + 1,
            `${table} row count grew by exactly 1 after the probe insert (${baseline} -> ${afterInsert.rows[0].c})`);

        const found = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [probeId]);
        assert(found.rows.length === 1, `Probe row in ${table} is retrievable by id`);

        const probeData = await client.query(`SELECT data FROM ${table} WHERE id = $1`, [probeId]);
        assert(probeData.rows.length === 1 && probeData.rows[0].data.__test_run__ === runMarker,
            `Probe row in ${table} kept its payload intact`);

        await client.query(`DELETE FROM ${table} WHERE id = $1`, [probeId]);

        const afterCleanup = await client.query(`SELECT count(*)::int AS c FROM ${table}`);
        assert(afterCleanup.rows[0].c === baseline,
            `${table} row count returned to the pre-test baseline after cleanup (${afterCleanup.rows[0].c} === ${baseline})`);
    }

    await probeHistoryTable('teen_patti_games', 'tp', tpBaseline);
    await probeHistoryTable('rummy_games', 'rum', rumBaseline);

    // 2.6: Test simulating a new game session and settling it
    console.log('\n--- 3. Simulating New Game & Settlement Workflow ---');
    const simNet = { ...currentNet };
    simNet['Alice'] = (simNet['Alice'] || 0) + 50;
    simNet['Bob'] = (simNet['Bob'] || 0) - 50;

    const activeBal = Object.entries(simNet)
        .filter(([_, bal]) => Math.abs(bal) >= 0.01)
        .map(([player, balance]) => ({ player, balance }));

    const simTransfers = minimumTransactions(activeBal);
    assert(simTransfers.length === 1, 'New game generates exactly 1 transfer');
    assert(simTransfers[0].from === 'Bob' && simTransfers[0].to === 'Alice' && simTransfers[0].amount === 50, 'Bob owes Alice 50');

    // Simulate settling that transfer
    simNet['Bob'] += 50;
    simNet['Alice'] -= 50;
    const postSettleBal = Object.entries(simNet).filter(([_, bal]) => Math.abs(bal) >= 0.01);
    assert(postSettleBal.length === 0, 'After settling, all active balances return to zero');

    // 2.7: Test partial payment simulation
    console.log('\n--- 4. Simulating Partial Settlement Workflow ---');
    const partNet = { ...currentNet };
    partNet['UserA'] = 100;
    partNet['UserB'] = -100;
    // UserB pays 40 of the 100
    partNet['UserB'] += 40;
    partNet['UserA'] -= 40;
    assert(partNet['UserB'] === -60 && partNet['UserA'] === 60, 'Partial payment correctly updates pending balances to 60');
    const partTransfers = minimumTransactions([
        { player: 'UserA', balance: partNet['UserA'] },
        { player: 'UserB', balance: partNet['UserB'] }
    ]);
    assert(partTransfers.length === 1 && partTransfers[0].amount === 60, 'Remaining transfer is exactly 60');

    // 2.8: Verify Leaderboard Current mode across all 3 sub-tabs
    console.log('\n--- 5. Verifying Leaderboard Current & All Time Dual Modes ---');
    // In Current mode when all previous sessions are settled, ALL 3 sub-tabs must show 0 active net
    const lbData = {
        tp: tp.rows.map(r => r.data),
        rum: rum.rows.map(r => r.data),
        settleUps: settleUps.rows
    };

    // Calculate All-Time stats
    const allTimeStats = { combined: {}, tp: {}, rum: {} };
    lbData.tp.forEach(g => {
        (g.players || []).forEach(p => {
            const amt = p.netAmount || 0;
            allTimeStats.combined[p.name] = (allTimeStats.combined[p.name] || 0) + amt;
            allTimeStats.tp[p.name] = (allTimeStats.tp[p.name] || 0) + amt;
        });
    });
    lbData.rum.forEach(g => {
        (g.players || []).forEach(p => {
            const amt = p.netBalance || 0;
            allTimeStats.combined[p.name] = (allTimeStats.combined[p.name] || 0) + amt;
            allTimeStats.rum[p.name] = (allTimeStats.rum[p.name] || 0) + amt;
        });
    });

    const sumAllTime = Object.values(allTimeStats.combined).reduce((s, v) => s + v, 0);
    assert(Math.abs(sumAllTime) < 0.01, `Exact zero-sum conservation for All-Time cumulative career stats (sum = ${sumAllTime})`);
    if (hasDataset) {
        assert(Math.round(allTimeStats.combined['Kaustubh'] * 10) / 10 === 371.1, `Kaustubh all-time career net is +371.10 (got ${allTimeStats.combined['Kaustubh']})`);
        assert(Math.round(allTimeStats.tp['Kaustubh'] * 10) / 10 === 239, `Kaustubh Teen Patti all-time net is +239 (got ${allTimeStats.tp['Kaustubh']})`);
        assert(Math.round(allTimeStats.rum['Kaustubh'] * 10) / 10 === 132.1, `Kaustubh Rummy all-time net is +132.10 (got ${allTimeStats.rum['Kaustubh']})`);
        assert(Math.round(allTimeStats.combined['Dhruv'] * 10) / 10 === -449.0, `Dhruv all-time career net is -449.00 (got ${allTimeStats.combined['Dhruv']})`);
    } else {
        skip('all-time career totals need a populated dataset (test database is empty)');
    }

    // Verify Current mode active values are 0 across all sub-tabs
    const hasActiveDebts = nonZeroPlayers.length > 0;
    assert(!hasActiveDebts, 'System has no active debts (all historical sessions fully settled)');

    await client.end();
}

async function main() {
    runAlgorithmTests();
    await runDatabaseVerification();
    console.log(`\n========================================`);
    console.log(`Test Results: ${passed} passed, ${failed} failed`);
    console.log(`========================================\n`);
    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
