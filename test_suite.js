// Comprehensive Settlement Logic & App Logic Test Suite
const { Client } = require('pg');
const fs = require('fs');

// Extract minimumTransactions and findZeroSumSubsets from app.js
const appJs = fs.readFileSync('./app.js', 'utf8');

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
    const client = new Client({ connectionString: 'postgresql://postgres:Kaustubh%401202@db.ixczvfnzttmiecgqoiek.supabase.co:5432/postgres' });
    await client.connect();

    // 2.1: Verify live_sessions has NO active sessions
    const activeSessions = await client.query("SELECT * FROM live_sessions WHERE status = 'active'");
    assert(activeSessions.rows.length === 0, `No active live sessions left hanging (count = ${activeSessions.rows.length})`);

    // 2.2: Verify settlement_ledger has NO pending items from old sessions
    const pendingLedger = await client.query("SELECT count(*) FROM settlement_ledger WHERE status = 'pending'");
    assert(parseInt(pendingLedger.rows[0].count) === 0, `All historical settlement_ledger entries marked settled (pending = ${pendingLedger.rows[0].count})`);

    // 2.3: Verify settle_ups table exists and has settlement records
    const settleUps = await client.query("SELECT * FROM settle_ups ORDER BY created_at DESC");
    assert(settleUps.rows.length >= 7, `settle_ups table has recorded settlements (count = ${settleUps.rows.length})`);

    // 2.4: Verify active net balances across ALL games + settle_ups
    const tp = await client.query('SELECT data FROM teen_patti_games');
    const rum = await client.query('SELECT data FROM rummy_games');
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

    // 2.5: Verify All-Time games history is preserved intact
    assert(tp.rows.length === 38, `All 38 Teen Patti games preserved in history (got ${tp.rows.length})`);
    assert(rum.rows.length === 36, `All 36 Rummy games preserved in history (got ${rum.rows.length})`);

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
    assert(Math.round(allTimeStats.combined['Kaustubh'] * 10) / 10 === 371.1, `Kaustubh all-time career net is +371.10 (got ${allTimeStats.combined['Kaustubh']})`);
    assert(allTimeStats.tp['Kaustubh'] === 239, `Kaustubh Teen Patti all-time net is +239 (got ${allTimeStats.tp['Kaustubh']})`);
    assert(Math.round(allTimeStats.rum['Kaustubh'] * 10) / 10 === 132.1, `Kaustubh Rummy all-time net is +132.10 (got ${allTimeStats.rum['Kaustubh']})`);
    assert(Math.round(allTimeStats.combined['Dhruv'] * 10) / 10 === -449.0, `Dhruv all-time career net is -449.00 (got ${allTimeStats.combined['Dhruv']})`);

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
