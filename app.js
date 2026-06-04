/* =========================================================
   C54 Casino — app.js
   Complete: Teen Patti, Rummy, Leaderboard, History
   Firebase Compat SDK (no ES module imports)
   ========================================================= */

// ── Globals ──
const PRESET_PLAYERS = ["Kaustubh","Atharva","Nikhil","Dhruv","Aniket","Rushikesh","Shivam"];
const RUMMY_POINT_VALUE = 0.10;

const state = {
    players: [],
    tpSelected: new Set(),
    rumSelected: new Set(),
};

// ── DOM helpers ──
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
    setupTabs();
    setupPlayerModal();
    setupTokenModal();
    setupRoundModal();
    setupTeenPatti();
    setupRummy();
    setupLeaderboard();
    await loadPlayers();
});

// ══════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════
function setupTabs() {
    $$('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.tab-btn').forEach(b => b.classList.remove('active'));
            $$('.view').forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            $(btn.dataset.target).classList.add('active');
            // Refresh leaderboard when switching to it
            if (btn.dataset.target === 'view-leaderboard') refreshLeaderboard();
        });
    });
}

// ══════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════
function toast(msg, duration = 2500) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 400); }, duration);
}

// ══════════════════════════════════════════════════════════
//  LOADING
// ══════════════════════════════════════════════════════════
function showLoading() { $('loading-overlay').classList.remove('hidden'); }
function hideLoading() { $('loading-overlay').classList.add('hidden'); }

// ══════════════════════════════════════════════════════════
//  PLAYER MANAGEMENT
// ══════════════════════════════════════════════════════════
async function loadPlayers() {
    // Show presets IMMEDIATELY — no waiting for Firestore
    state.players = [...PRESET_PLAYERS];
    renderChips();

    // Then try to fetch custom players from Firestore in background (with timeout)
    try {
        const firestorePromise = db.collection('players').get();
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Firestore timeout')), 4000)
        );
        const snap = await Promise.race([firestorePromise, timeoutPromise]);
        const custom = [];
        snap.forEach(d => { if (d.data().name) custom.push(d.data().name); });
        if (custom.length > 0) {
            state.players = [...new Set([...PRESET_PLAYERS, ...custom])];
            renderChips();
        }
    } catch (e) {
        console.warn('Firestore player load skipped:', e.message || e);
    }
}

function renderChips() {
    renderChipSet('tp-player-chips', state.tpSelected, 'tp');
    renderChipSet('rummy-player-chips', state.rumSelected, 'rum');
    updateStartBtns();
}

function renderChipSet(containerId, selectedSet, prefix) {
    const c = $(containerId);
    c.innerHTML = '';
    state.players.forEach(name => {
        const chip = document.createElement('div');
        chip.className = 'chip' + (selectedSet.has(name) ? ' selected' : '');
        chip.textContent = name;
        chip.addEventListener('click', () => {
            if (selectedSet.has(name)) { selectedSet.delete(name); chip.classList.remove('selected'); }
            else { selectedSet.add(name); chip.classList.add('selected'); }
            chip.style.transform = 'scale(.92)';
            setTimeout(() => chip.style.transform = '', 120);
            updateStartBtns();
        });
        c.appendChild(chip);
    });
}

function updateStartBtns() {
    $('btn-start-tp').disabled = state.tpSelected.size < 2;
    $('btn-start-rummy').disabled = state.rumSelected.size < 2;
}

// ── Add Player Modal ──
function setupPlayerModal() {
    const overlay = $('modal-overlay');
    const input = $('modal-player-name');

    $('btn-add-player-tp').onclick = () => openPlayerModal();
    $('btn-add-player-rummy').onclick = () => openPlayerModal();
    $('modal-cancel').onclick = () => overlay.classList.add('hidden');
    $('modal-save').onclick = () => saveNewPlayer();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') saveNewPlayer(); });

    function openPlayerModal() {
        input.value = '';
        overlay.classList.remove('hidden');
        setTimeout(() => input.focus(), 100);
    }

    async function saveNewPlayer() {
        const name = input.value.trim();
        if (!name) return;
        if (state.players.map(p=>p.toLowerCase()).includes(name.toLowerCase())) {
            toast('Player already exists!'); input.focus(); return;
        }
        overlay.classList.add('hidden');
        showLoading();
        try {
            await db.collection('players').add({
                name, isPreset: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            state.players.push(name);
            renderChips();
            toast('✅ ' + name + ' added!');
        } catch (e) { console.error(e); toast('❌ Failed to add player'); }
        hideLoading();
    }
}

// ══════════════════════════════════════════════════════════
//  TOKEN INPUT MODAL (with credit/paid toggle)
// ══════════════════════════════════════════════════════════
let tokenModalCb = null;
let tokenModalPaymentType = 'credit'; // 'credit' or 'paid'

function setupTokenModal() {
    $('token-modal-cancel').onclick = () => $('token-modal-overlay').classList.add('hidden');
    $('token-modal-save').onclick = () => {
        const val = parseInt($('token-modal-input').value) || 0;
        $('token-modal-overlay').classList.add('hidden');
        if (tokenModalCb && val > 0) tokenModalCb(val, tokenModalPaymentType);
        tokenModalCb = null;
    };
    $('token-modal-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') $('token-modal-save').click();
    });

    // Credit/Paid toggle buttons
    $('toggle-credit').addEventListener('click', () => {
        tokenModalPaymentType = 'credit';
        $('toggle-credit').classList.add('active');
        $('toggle-paid').classList.remove('active');
    });
    $('toggle-paid').addEventListener('click', () => {
        tokenModalPaymentType = 'paid';
        $('toggle-paid').classList.add('active');
        $('toggle-credit').classList.remove('active');
    });
}

function openTokenModal(title, defaultVal, showToggle, cb) {
    $('token-modal-title').textContent = title;
    $('token-modal-input').value = defaultVal || 50;
    tokenModalCb = cb;
    tokenModalPaymentType = 'credit';
    $('toggle-credit').classList.add('active');
    $('toggle-paid').classList.remove('active');

    if (showToggle) {
        $('token-modal-toggle').classList.remove('hidden');
    } else {
        $('token-modal-toggle').classList.add('hidden');
    }
    $('token-modal-overlay').classList.remove('hidden');
    setTimeout(() => { $('token-modal-input').select(); $('token-modal-input').focus(); }, 100);
}

// ══════════════════════════════════════════════════════════
//  TEEN PATTI
// ══════════════════════════════════════════════════════════
let tpGame = null;

function setupTeenPatti() {
    $('btn-start-tp').addEventListener('click', startTpSetup);
    $('btn-begin-tp').addEventListener('click', beginTpGame);
    $('btn-end-tp').addEventListener('click', endTpGame);
    $('btn-save-tp').addEventListener('click', saveTpGame);
    $('btn-newgame-tp').addEventListener('click', resetTpUI);
}

// Step 1: Show initial token buy screen
function startTpSetup() {
    const tokenPrice = parseFloat($('tp-token-price').value) || 1;
    const players = {};
    state.tpSelected.forEach(p => {
        players[p] = {
            initialTokens: 0,    // set on initial screen
            isPaid: false,       // credit by default
            boughtMore: 0,       // additional tokens during game
            returned: 0,         // tokens returned during game
            remainingTokens: 0,  // entered at end
            netAmount: 0,
            // Track all transactions for history
            transactions: []
        };
    });

    tpGame = { tokenPrice, players, stage: 'initial' };
    $('tp-setup-card').classList.add('hidden');
    $('tp-initial-card').classList.remove('hidden');
    renderInitialTokenScreen();
}

function renderInitialTokenScreen() {
    const list = $('tp-initial-list');
    list.innerHTML = '';
    const names = Object.keys(tpGame.players);

    names.forEach(name => {
        const p = tpGame.players[name];
        const row = document.createElement('div');
        row.className = 'init-token-row';
        row.innerHTML = `
            <div class="init-row-left">
                <span class="init-player-name">${name}</span>
                <div class="init-toggle">
                    <button class="toggle-btn small ${p.isPaid ? '' : 'active'}" data-name="${name}" data-val="credit">Credit</button>
                    <button class="toggle-btn small ${p.isPaid ? 'active' : ''}" data-name="${name}" data-val="paid">Paid</button>
                </div>
            </div>
            <input type="number" class="init-token-input" data-name="${name}" value="${p.initialTokens || 100}" min="0" placeholder="Tokens">
        `;
        list.appendChild(row);
    });

    // Toggle event listeners
    list.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.name;
            const val = btn.dataset.val;
            tpGame.players[name].isPaid = (val === 'paid');
            // Update button states
            list.querySelectorAll(`.toggle-btn[data-name="${name}"]`).forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

// Step 2: Begin game with initial tokens
function beginTpGame() {
    const inputs = $('tp-initial-list').querySelectorAll('.init-token-input');
    let valid = true;
    inputs.forEach(inp => {
        const val = parseInt(inp.value);
        if (isNaN(val) || val < 0) { valid = false; return; }
        const name = inp.dataset.name;
        tpGame.players[name].initialTokens = val;
        tpGame.players[name].transactions.push({
            type: 'initial',
            amount: val,
            paymentType: tpGame.players[name].isPaid ? 'paid' : 'credit'
        });
    });
    if (!valid) { toast('❌ Enter valid token amounts for all players'); return; }

    tpGame.stage = 'ingame';
    $('tp-price-badge').textContent = '₹' + tpGame.tokenPrice + '/token';
    $('tp-initial-card').classList.add('hidden');
    $('tp-ingame-card').classList.remove('hidden');
    renderTpTracking();
}

function renderTpTracking() {
    const list = $('tp-tracking-list');
    list.innerHTML = '';
    const names = Object.keys(tpGame.players);

    names.forEach(name => {
        const p = tpGame.players[name];
        const totalBought = p.initialTokens + p.boughtMore;
        const holdings = totalBought - p.returned;
        const row = document.createElement('div');
        row.className = 'p-row';

        const paymentBadge = p.isPaid
            ? '<span class="payment-badge paid">💵 Paid</span>'
            : '<span class="payment-badge credit">🏷️ Credit</span>';

        if (tpGame.stage === 'ingame') {
            row.innerHTML = `
                <div class="p-row-top">
                    <div class="p-row-name-area">
                        <span class="p-row-name">${name}</span>
                        ${paymentBadge}
                    </div>
                    <span class="p-row-tokens">${holdings} 🪙</span>
                </div>
                <div class="p-row-stats">
                    <span>Initial: ${p.initialTokens}</span>
                    ${p.boughtMore > 0 ? `<span>Bought More: +${p.boughtMore}</span>` : ''}
                    ${p.returned > 0 ? `<span>Returned: −${p.returned}</span>` : ''}
                </div>
                <div class="p-row-actions">
                    <button class="btn-take" data-name="${name}">+ Buy More</button>
                    <button class="btn-return" data-name="${name}">− Return</button>
                </div>`;
        } else if (tpGame.stage === 'ending') {
            row.innerHTML = `
                <div class="p-row-top">
                    <div class="p-row-name-area">
                        <span class="p-row-name">${name}</span>
                        ${paymentBadge}
                    </div>
                    <span class="p-row-tokens">${holdings} 🪙 expected</span>
                </div>
                <div class="p-row-stats">
                    <span>Initial: ${p.initialTokens}</span>
                    ${p.boughtMore > 0 ? `<span>Bought: +${p.boughtMore}</span>` : ''}
                    ${p.returned > 0 ? `<span>Returned: −${p.returned}</span>` : ''}
                </div>
                <div class="p-row-final">
                    <label>Remaining tokens in hand:</label>
                    <input type="number" class="final-input" data-name="${name}" value="${holdings}" min="0">
                </div>`;
        }
        list.appendChild(row);
    });

    // Attach action button events
    if (tpGame.stage === 'ingame') {
        list.querySelectorAll('.btn-take').forEach(btn => {
            btn.addEventListener('click', () => {
                openTokenModal(`${btn.dataset.name} — Buy More Tokens`, 50, true, (val, payType) => {
                    tpGame.players[btn.dataset.name].boughtMore += val;
                    tpGame.players[btn.dataset.name].transactions.push({
                        type: 'buy_more',
                        amount: val,
                        paymentType: payType
                    });
                    renderTpTracking();
                    toast(`${btn.dataset.name} bought ${val} more tokens (${payType})`);
                });
            });
        });
        list.querySelectorAll('.btn-return').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = tpGame.players[btn.dataset.name];
                const maxReturn = p.initialTokens + p.boughtMore - p.returned;
                openTokenModal(`${btn.dataset.name} — Return Tokens`, Math.min(50, maxReturn), false, (val) => {
                    if (val > maxReturn) {
                        toast(`❌ Can't return more than ${maxReturn} tokens`);
                        return;
                    }
                    tpGame.players[btn.dataset.name].returned += val;
                    tpGame.players[btn.dataset.name].transactions.push({
                        type: 'return',
                        amount: val
                    });
                    renderTpTracking();
                    toast(`${btn.dataset.name} returned ${val} tokens`);
                });
            });
        });
    }
}

function endTpGame() {
    if (tpGame.stage === 'ingame') {
        tpGame.stage = 'ending';
        $('btn-end-tp').textContent = '📊 Calculate Settlement';
        renderTpTracking();
        return;
    }
    // stage === 'ending': collect remaining tokens and settle
    let ok = true;
    $('tp-tracking-list').querySelectorAll('.final-input').forEach(inp => {
        const name = inp.dataset.name;
        const val = parseInt(inp.value);
        if (isNaN(val) || val < 0) { ok = false; return; }
        tpGame.players[name].remainingTokens = val;
    });
    if (!ok) { toast('❌ Please fill all fields correctly'); return; }

    calculateTpSettlement();
}

function calculateTpSettlement() {
    $('tp-ingame-card').classList.add('hidden');
    $('tp-settlement-card').classList.remove('hidden');
    tpGame.stage = 'settlement';

    const balances = [];
    let resultsHTML = '';

    Object.entries(tpGame.players).forEach(([name, p]) => {
        // Total tokens acquired = initial + boughtMore - returned
        const totalAcquired = p.initialTokens + p.boughtMore - p.returned;
        // Net P/L = (remaining - totalAcquired) × tokenPrice
        // Positive = won (has more than acquired), Negative = lost
        const net = (p.remainingTokens - totalAcquired) * tpGame.tokenPrice;
        p.netAmount = Math.round(net * 100) / 100;
        balances.push({ player: name, balance: p.netAmount });

        let cls = 'neutral', display = '₹0';
        if (p.netAmount > 0) { cls = 'winner'; display = '+₹' + p.netAmount.toFixed(2); }
        else if (p.netAmount < 0) { cls = 'loser'; display = '−₹' + Math.abs(p.netAmount).toFixed(2); }

        const paymentBadge = p.isPaid
            ? '<span class="payment-badge paid small">💵 Paid</span>'
            : '<span class="payment-badge credit small">🏷️ Credit</span>';

        resultsHTML += `<div class="result-row ${cls}">
            <span>${name} ${paymentBadge}
                <small style="color:var(--text-muted);display:block;font-size:.75rem;">
                    Took ${p.initialTokens}${p.boughtMore > 0 ? '+' + p.boughtMore : ''}${p.returned > 0 ? '−' + p.returned : ''} = ${totalAcquired} | Remaining: ${p.remainingTokens}
                </small>
            </span>
            <span class="r-amount">${display}</span>
        </div>`;
    });
    $('tp-settlement-results').innerHTML = resultsHTML;

    const transfers = minimumTransactions(balances);
    tpGame.transfers = transfers;
    renderTransfers('tp-transfers-list', transfers);
}

async function saveTpGame() {
    showLoading();
    try {
        const playersArr = Object.entries(tpGame.players).map(([name, p]) => ({
            name,
            initialTokens: p.initialTokens,
            isPaid: p.isPaid,
            boughtMore: p.boughtMore,
            returned: p.returned,
            remainingTokens: p.remainingTokens,
            netAmount: p.netAmount,
            transactions: p.transactions
        }));

        let timeoutId;
        const timeout = new Promise((_, reject) =>
            timeoutId = setTimeout(() => reject(new Error('Save timed out — check your internet')), 15000)
        );
        const saveOp = db.collection('teenPattiGames').add({
            date: firebase.firestore.FieldValue.serverTimestamp(),
            tokenPrice: tpGame.tokenPrice,
            players: playersArr,
            settlements: tpGame.transfers,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await Promise.race([saveOp, timeout]);
        clearTimeout(timeoutId);
        toast('✅ Teen Patti game saved!');
        resetTpUI();
    } catch (e) {
        console.error(e);
        toast('❌ ' + (e.message || 'Save failed'));
    } finally {
        hideLoading();
    }
}

function resetTpUI() {
    $('tp-settlement-card').classList.add('hidden');
    $('tp-ingame-card').classList.add('hidden');
    $('tp-initial-card').classList.add('hidden');
    $('tp-setup-card').classList.remove('hidden');
    $('btn-end-tp').textContent = 'End Game & Settle';
    tpGame = null;
}

// ══════════════════════════════════════════════════════════
//  RUMMY
// ══════════════════════════════════════════════════════════
let rumGame = null;

function setupRummy() {
    $('btn-start-rummy').addEventListener('click', startRumGame);
    $('btn-add-round').addEventListener('click', () => openRoundInputModal());
    $('btn-end-rummy').addEventListener('click', endRumGame);
    $('btn-save-rummy').addEventListener('click', saveRumGame);
    $('btn-newgame-rummy').addEventListener('click', resetRumUI);
}

function startRumGame() {
    const players = {};
    state.rumSelected.forEach(p => { players[p] = { rounds: [], total: 0 }; });
    rumGame = { players, rounds: [], stage: 'ingame' };
    $('rummy-setup-card').classList.add('hidden');
    $('rummy-ingame-card').classList.remove('hidden');
    renderRumScoreboard();
}

function renderRumScoreboard() {
    const names = Object.keys(rumGame.players);
    // Sort by total points ascending (lower = better)
    const sorted = names.map(n => ({ name: n, total: rumGame.players[n].total }))
        .sort((a, b) => a.total - b.total);

    let html = '<table class="scoreboard"><thead><tr><th>#</th><th>Player</th><th>Points</th></tr></thead><tbody>';
    sorted.forEach((p, i) => {
        const cls = i === 0 && rumGame.rounds.length > 0 ? 'rank-1' : '';
        html += `<tr class="${cls}"><td>${i + 1}</td><td>${p.name}</td><td>${p.total}</td></tr>`;
    });
    html += '</tbody></table>';
    $('rummy-scoreboard').innerHTML = html;

    // Round history
    let histHTML = '';
    if (rumGame.rounds.length > 0) {
        histHTML = '<div class="round-history">';
        rumGame.rounds.forEach((r, i) => {
            histHTML += '<div class="round-item"><span class="round-label">R' + (i + 1) + ':</span>';
            Object.entries(r).forEach(([name, pts]) => {
                histHTML += `<span>${name}: ${pts}</span>`;
            });
            histHTML += '</div>';
        });
        histHTML += '</div>';
    }
    $('rummy-round-history').innerHTML = histHTML;
}

// ── Round Input Modal ──
function setupRoundModal() {
    $('round-modal-cancel').onclick = () => $('round-modal-overlay').classList.add('hidden');
    $('round-modal-save').onclick = saveRound;
}

function openRoundInputModal() {
    if (!rumGame) return;
    const names = Object.keys(rumGame.players);
    $('round-modal-title').textContent = 'Round ' + (rumGame.rounds.length + 1);
    let html = '';
    names.forEach(name => {
        html += `<div class="round-input-row">
            <label>${name}</label>
            <input type="number" class="round-pt-input" data-name="${name}" value="0" min="0">
        </div>`;
    });
    $('round-modal-inputs').innerHTML = html;
    $('round-modal-overlay').classList.remove('hidden');
    // Focus first input
    setTimeout(() => {
        const first = $('round-modal-inputs').querySelector('input');
        if (first) { first.select(); first.focus(); }
    }, 100);
}

function saveRound() {
    const inputs = $('round-modal-inputs').querySelectorAll('.round-pt-input');
    const round = {};
    let valid = true;
    inputs.forEach(inp => {
        const val = parseInt(inp.value);
        if (isNaN(val) || val < 0) { valid = false; return; }
        round[inp.dataset.name] = val;
    });
    if (!valid) { toast('❌ Enter valid points for all players'); return; }

    rumGame.rounds.push(round);
    // Update totals
    Object.entries(round).forEach(([name, pts]) => {
        rumGame.players[name].rounds.push(pts);
        rumGame.players[name].total += pts;
    });

    $('round-modal-overlay').classList.add('hidden');
    renderRumScoreboard();
    toast('Round ' + rumGame.rounds.length + ' added');
}

function endRumGame() {
    if (rumGame.rounds.length === 0) { toast('❌ Play at least one round first'); return; }
    calculateRumSettlement();
}

function calculateRumSettlement() {
    $('rummy-ingame-card').classList.add('hidden');
    $('rummy-settlement-card').classList.remove('hidden');
    rumGame.stage = 'settlement';

    const names = Object.keys(rumGame.players);
    const balances = [];
    let resultsHTML = '';

    // Pairwise calculation
    names.forEach(pName => {
        let netPoints = 0;
        const pTotal = rumGame.players[pName].total;
        names.forEach(qName => {
            if (pName === qName) return;
            const qTotal = rumGame.players[qName].total;
            netPoints += (qTotal - pTotal); // positive = good (others scored more)
        });
        const netAmount = Math.round(netPoints * RUMMY_POINT_VALUE * 100) / 100;
        rumGame.players[pName].netBalance = netAmount;
        balances.push({ player: pName, balance: netAmount });

        let cls = 'neutral', display = '₹0';
        if (netAmount > 0) { cls = 'winner'; display = '+₹' + netAmount.toFixed(2); }
        else if (netAmount < 0) { cls = 'loser'; display = '−₹' + Math.abs(netAmount).toFixed(2); }
        resultsHTML += `<div class="result-row ${cls}">
            <span>${pName} <small style="color:var(--text-muted)">(${rumGame.players[pName].total} pts)</small></span>
            <span class="r-amount">${display}</span>
        </div>`;
    });
    $('rummy-settlement-results').innerHTML = resultsHTML;

    // Verify sum = 0
    const sum = balances.reduce((s, b) => s + b.balance, 0);
    const verifyEl = $('rummy-verify');
    if (Math.abs(sum) < 0.01) {
        verifyEl.className = 'verify-badge pass';
        verifyEl.textContent = '✅ Verified: Net sum = ₹0';
    } else {
        verifyEl.className = 'verify-badge fail';
        verifyEl.textContent = '⚠️ Mismatch: Net sum = ₹' + sum.toFixed(2);
    }

    const transfers = minimumTransactions(balances);
    rumGame.transfers = transfers;
    renderTransfers('rummy-transfers-list', transfers);
}

async function saveRumGame() {
    showLoading();
    try {
        const playersArr = Object.entries(rumGame.players).map(([name, p]) => ({
            name, rounds: p.rounds, totalPoints: p.total, netBalance: p.netBalance
        }));

        let timeoutId;
        const timeout = new Promise((_, reject) =>
            timeoutId = setTimeout(() => reject(new Error('Save timed out — check your internet')), 15000)
        );
        const saveOp = db.collection('rummyGames').add({
            date: firebase.firestore.FieldValue.serverTimestamp(),
            pointValue: RUMMY_POINT_VALUE,
            players: playersArr,
            rounds: rumGame.rounds,
            settlements: rumGame.transfers,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await Promise.race([saveOp, timeout]);
        clearTimeout(timeoutId);
        toast('✅ Rummy game saved!');
        resetRumUI();
    } catch (e) {
        console.error(e);
        toast('❌ ' + (e.message || 'Save failed'));
    } finally {
        hideLoading();
    }
}

function resetRumUI() {
    $('rummy-settlement-card').classList.add('hidden');
    $('rummy-ingame-card').classList.add('hidden');
    $('rummy-setup-card').classList.remove('hidden');
    rumGame = null;
}

// ══════════════════════════════════════════════════════════
//  MINIMUM TRANSACTION SETTLEMENT ALGORITHM
// ══════════════════════════════════════════════════════════
function minimumTransactions(balances) {
    // Deep copy to avoid mutating originals
    let debtors = balances.filter(b => b.balance < -0.001)
        .map(b => ({ ...b, balance: Math.round(b.balance * 100) / 100 }))
        .sort((a, b) => a.balance - b.balance); // most negative first
    let creditors = balances.filter(b => b.balance > 0.001)
        .map(b => ({ ...b, balance: Math.round(b.balance * 100) / 100 }))
        .sort((a, b) => b.balance - a.balance); // most positive first

    const transfers = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
        const amount = Math.round(Math.min(Math.abs(debtors[i].balance), creditors[j].balance) * 100) / 100;
        if (amount > 0) {
            transfers.push({ from: debtors[i].player, to: creditors[j].player, amount });
        }
        debtors[i].balance = Math.round((debtors[i].balance + amount) * 100) / 100;
        creditors[j].balance = Math.round((creditors[j].balance - amount) * 100) / 100;
        if (Math.abs(debtors[i].balance) < 0.01) i++;
        if (Math.abs(creditors[j].balance) < 0.01) j++;
    }
    return transfers;
}

function renderTransfers(containerId, transfers) {
    const c = $(containerId);
    if (transfers.length === 0) {
        c.innerHTML = '<div class="transfer-item">No transfers needed 🎉</div>';
        return;
    }
    c.innerHTML = transfers.map(t =>
        `<div class="transfer-item">
            <strong>${t.from}</strong>
            <span class="t-arrow">→</span>
            <strong>${t.to}</strong>
            <span class="t-amount">₹${t.amount.toFixed(2)}</span>
        </div>`
    ).join('');
}

// ══════════════════════════════════════════════════════════
//  LEADERBOARD & HISTORY
// ══════════════════════════════════════════════════════════
let lbData = { tp: [], rum: [] };

function setupLeaderboard() {
    $$('#lb-sub-tabs .sub-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#lb-sub-tabs .sub-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderLeaderboardTable(btn.dataset.lb);
        });
    });
    $$('#history-sub-tabs .sub-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#history-sub-tabs .sub-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderHistory(btn.dataset.hist);
        });
    });
}

async function refreshLeaderboard() {
    showLoading();
    try {
        let timeoutId;
        const timeout = new Promise((_, reject) =>
            timeoutId = setTimeout(() => reject(new Error('Leaderboard fetch timeout')), 10000)
        );

        const fetchData = async () => {
            const tpSnap = await db.collection('teenPattiGames').orderBy('createdAt','desc').get();
            lbData.tp = [];
            tpSnap.forEach(d => { const data = d.data(); data._id = d.id; lbData.tp.push(data); });

            const rumSnap = await db.collection('rummyGames').orderBy('createdAt','desc').get();
            lbData.rum = [];
            rumSnap.forEach(d => { const data = d.data(); data._id = d.id; lbData.rum.push(data); });
        };

        await Promise.race([fetchData(), timeout]);
        clearTimeout(timeoutId);
    } catch (e) {
        console.warn('Leaderboard load failed:', e.message || e);
        toast('⚠️ ' + (e.message || 'Could not load data — showing cached'));
    } finally {
        hideLoading();
    }

    // Determine active sub-tab
    const activeLb = document.querySelector('#lb-sub-tabs .sub-tab.active');
    renderLeaderboardTable(activeLb ? activeLb.dataset.lb : 'combined');
    const activeHist = document.querySelector('#history-sub-tabs .sub-tab.active');
    renderHistory(activeHist ? activeHist.dataset.hist : 'all');
}

function renderLeaderboardTable(type) {
    const playerStats = {}; // { name: { won: 0, lost: 0, games: 0 } }

    function addStats(name, amount) {
        if (!playerStats[name]) playerStats[name] = { won: 0, lost: 0, games: 0 };
        if (amount > 0) playerStats[name].won += amount;
        else playerStats[name].lost += Math.abs(amount);
        playerStats[name].games++;
    }

    if (type === 'combined' || type === 'teenpatti') {
        lbData.tp.forEach(game => {
            (game.players || []).forEach(p => {
                addStats(p.name, p.netAmount || 0);
            });
        });
    }
    if (type === 'combined' || type === 'rummy') {
        lbData.rum.forEach(game => {
            (game.players || []).forEach(p => {
                addStats(p.name, p.netBalance || 0);
            });
        });
    }

    const entries = Object.entries(playerStats)
        .map(([name, s]) => ({ name, net: Math.round((s.won - s.lost) * 100) / 100, won: s.won, lost: s.lost, games: s.games }))
        .sort((a, b) => b.net - a.net);

    if (entries.length === 0) {
        $('lb-content').innerHTML = '<div class="empty-state">No games played yet. Start a game!</div>';
        return;
    }

    let html = `<table class="lb-table"><thead><tr><th>#</th><th>Player</th><th>Net</th><th>Won</th><th>Lost</th><th>Games</th></tr></thead><tbody>`;
    entries.forEach((e, i) => {
        const netCls = e.net > 0 ? 'lb-pos' : e.net < 0 ? 'lb-neg' : '';
        const netStr = e.net > 0 ? '+₹' + e.net.toFixed(2) : e.net < 0 ? '−₹' + Math.abs(e.net).toFixed(2) : '₹0';
        html += `<tr>
            <td class="lb-rank">${i + 1}</td>
            <td>${e.name}${i === 0 ? ' 🏆' : ''}${i === entries.length - 1 && entries.length > 1 ? ' 📉' : ''}</td>
            <td class="${netCls}">${netStr}</td>
            <td>₹${e.won.toFixed(2)}</td>
            <td>₹${e.lost.toFixed(2)}</td>
            <td>${e.games}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    $('lb-content').innerHTML = html;
}

function renderHistory(type) {
    let games = [];
    if (type === 'all' || type === 'teenpatti') {
        lbData.tp.forEach(g => games.push({ ...g, _type: 'tp' }));
    }
    if (type === 'all' || type === 'rummy') {
        lbData.rum.forEach(g => games.push({ ...g, _type: 'rum' }));
    }

    // Sort by date descending
    games.sort((a, b) => {
        const da = a.createdAt ? a.createdAt.toDate() : new Date(0);
        const db2 = b.createdAt ? b.createdAt.toDate() : new Date(0);
        return db2 - da;
    });

    if (games.length === 0) {
        $('history-content').innerHTML = '<div class="empty-state">No games saved yet.</div>';
        return;
    }

    let html = '';
    games.forEach(g => {
        const date = g.createdAt ? g.createdAt.toDate().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Unknown';
        const typeCls = g._type === 'tp' ? 'tp' : 'rm';
        const typeLabel = g._type === 'tp' ? 'Teen Patti' : 'Rummy';
        const playerNames = (g.players || []).map(p => p.name).join(', ');

        let detailHTML = '';
        (g.players || []).forEach(p => {
            const amt = g._type === 'tp' ? p.netAmount : p.netBalance;
            const amtStr = amt > 0 ? '+₹' + amt.toFixed(2) : amt < 0 ? '−₹' + Math.abs(amt).toFixed(2) : '₹0';
            const cls = amt > 0 ? 'lb-pos' : amt < 0 ? 'lb-neg' : '';
            detailHTML += `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span>${p.name}</span><span class="${cls}">${amtStr}</span></div>`;
        });
        if (g.settlements && g.settlements.length > 0) {
            detailHTML += '<div class="history-settlement"><strong>Transfers:</strong>';
            g.settlements.forEach(t => {
                detailHTML += `<div>${t.from} → ${t.to}: ₹${t.amount.toFixed(2)}</div>`;
            });
            detailHTML += '</div>';
        }

        html += `<div class="history-card" onclick="this.classList.toggle('expanded')">
            <div class="history-card-top">
                <span class="history-type ${typeCls}">${typeLabel}</span>
                <span class="history-date">${date}</span>
            </div>
            <div class="history-players">${playerNames}</div>
            <div class="history-detail">${detailHTML}</div>
        </div>`;
    });
    $('history-content').innerHTML = html;
}

// ══════════════════════════════════════════════════════════
//  PWA SERVICE WORKER & INSTALL PROMPT
// ══════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                console.log('SW registered:', reg.scope);
                // Force check for new service worker on every page load
                reg.update();
            })
            .catch(err => console.warn('SW registration failed:', err));
    });
}

// Custom PWA Install Prompt handling
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallPromotion();
});

function showInstallPromotion() {
    // Only add if not already there
    if ($('pwa-install-btn')) return;
    
    const installBtn = document.createElement('button');
    installBtn.id = 'pwa-install-btn';
    installBtn.className = 'btn-outline';
    installBtn.style.padding = '4px 10px';
    installBtn.style.fontSize = '0.75rem';
    installBtn.style.marginLeft = 'auto';
    installBtn.style.marginRight = '12px';
    installBtn.style.borderRadius = '20px';
    installBtn.style.background = 'rgba(99,102,241,0.15)';
    installBtn.style.borderColor = 'var(--accent)';
    installBtn.style.color = 'var(--accent2)';
    installBtn.innerHTML = '📱 Install App';
    
    installBtn.addEventListener('click', async () => {
        installBtn.style.display = 'none';
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        deferredPrompt = null;
    });

    const header = document.querySelector('header');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.flexWrap = 'wrap';
    
    // Add button next to logo
    const logo = document.querySelector('.logo');
    logo.style.marginBottom = '0'; // Remove margin to align with button
    header.insertBefore(installBtn, document.querySelector('.tabs'));
    
    // Adjust header layout
    document.querySelector('.tabs').style.width = '100%';
    document.querySelector('.tabs').style.marginTop = '12px';
}
