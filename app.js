/* =========================================================
   C54 Casino — app.js
   Complete: Teen Patti, Rummy, Leaderboard, History
   Live Sessions via Supabase Realtime
   ========================================================= */

// ── Globals ──
const PRESET_PLAYERS = ["Kaustubh","Atharva","Nikhil","Dhruv","Aniket","Rushikesh","Shivam"];
const RUMMY_POINT_VALUE = 0.10;
const TEEN_PATTI_DEFAULT_INITIAL_TOKENS = 20;

const state = {
    players: [],
    tpSelected: new Set(),
    rumSelected: new Set(),
};

// Live session tracking is intentionally separated by game type.
const liveSessions = {
    teenpatti: { id: null, channel: null, isGuest: false, lastSyncTimestamp: null },
    rummy: { id: null, channel: null, isGuest: false, lastSyncTimestamp: null }
};

function getLiveSessionState(gameType) {
    const session = liveSessions[gameType];
    if (!session) throw new Error('Unknown live session game type: ' + gameType);
    return session;
}

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
    checkActiveSessions();
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
            if (btn.dataset.target === 'view-leaderboard') refreshLeaderboard();
            if (btn.dataset.target === 'view-settlements') refreshSettlements();
            if (btn.dataset.target === 'view-teenpatti' || btn.dataset.target === 'view-rummy') checkActiveSessions();
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
//  PLAYER MANAGEMENT (Supabase)
// ══════════════════════════════════════════════════════════
async function loadPlayers() {
    state.players = [...PRESET_PLAYERS];
    renderChips();

    try {
        const { data, error } = await supabaseClient
            .from('players')
            .select('name')
            .order('created_at', { ascending: true });

        if (!error && data && data.length > 0) {
            const custom = data.map(d => d.name).filter(Boolean);
            state.players = [...new Set([...PRESET_PLAYERS, ...custom])];
            renderChips();
        }
    } catch (e) {
        console.warn('Player load skipped:', e.message || e);
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
        if (state.players.map(p => p.toLowerCase()).includes(name.toLowerCase())) {
            toast('Player already exists!'); input.focus(); return;
        }
        overlay.classList.add('hidden');
        showLoading();
        try {
            const { error } = await supabaseClient
                .from('players')
                .insert([{ name, is_preset: false }]);
            if (error) throw new Error(error.message);
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
let tokenModalPaymentType = 'credit';

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
    $('btn-delete-tp').addEventListener('click', deleteSavedTpGame);
    $('btn-newgame-tp').addEventListener('click', resetTpUI);
}

// Step 1: Show initial token buy screen
function startTpSetup() {
    const tokenPrice = parseFloat($('tp-token-price').value) || 1;
    const players = {};
    state.tpSelected.forEach(p => {
        players[p] = {
            initialTokens: TEEN_PATTI_DEFAULT_INITIAL_TOKENS,
            isPaid: false,
            boughtMore: 0,
            returned: 0,
            remainingTokens: 0,
            netAmount: 0,
            transactions: []
        };
    });

    tpGame = { tokenPrice, players, stage: 'initial' };
    $('tp-setup-card').classList.add('hidden');
    $('tp-join-banner').classList.add('hidden');
    $('tp-initial-card').classList.remove('hidden');
    renderInitialTokenScreen();
}

function renderInitialTokenScreen() {
    const list = $('tp-initial-list');
    list.innerHTML = '';
    const names = Object.keys(tpGame.players);

    names.forEach((name, i) => {
        const p = tpGame.players[name];
        const row = document.createElement('div');
        row.className = 'init-token-row animate-in';
        row.style.animationDelay = `${i * 0.05}s`;
        row.innerHTML = `
            <div class="init-row-left">
                <span class="init-player-name">${name}</span>
                <div class="init-toggle">
                    <button class="toggle-btn small ${p.isPaid ? '' : 'active'}" data-name="${name}" data-val="credit">Credit</button>
                    <button class="toggle-btn small ${p.isPaid ? 'active' : ''}" data-name="${name}" data-val="paid">Paid</button>
                </div>
            </div>
            <input type="number" class="init-token-input" data-name="${name}" value="${p.initialTokens ?? TEEN_PATTI_DEFAULT_INITIAL_TOKENS}" min="0" placeholder="Tokens">
        `;
        list.appendChild(row);
    });

    // Toggle event listeners
    list.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.name;
            const val = btn.dataset.val;
            tpGame.players[name].isPaid = (val === 'paid');
            list.querySelectorAll(`.toggle-btn[data-name="${name}"]`).forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

// Step 2: Begin game with initial tokens
async function beginTpGame() {
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

    // Create live session
    await createLiveSession('teenpatti', tpGame);
}

// ── Render In-Game Tracking with Preset Buttons ──
function renderTpTracking() {
    const list = $('tp-tracking-list');
    const isUpdate = list.children.length > 0;
    list.innerHTML = '';
    const names = Object.keys(tpGame.players);

    names.forEach((name, i) => {
        const p = tpGame.players[name];
        const totalBought = p.initialTokens + p.boughtMore;
        const holdings = totalBought - p.returned;
        const row = document.createElement('div');
        row.className = isUpdate ? 'p-row' : 'p-row animate-in';
        if (!isUpdate) row.style.animationDelay = `${i * 0.05}s`;

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
                    <span class="p-row-tokens animate-number">${holdings} 🪙</span>
                </div>
                <div class="p-row-stats">
                    <span>Initial: ${p.initialTokens}</span>
                    ${p.boughtMore > 0 ? `<span>Bought More: +${p.boughtMore}</span>` : ''}
                    ${p.returned > 0 ? `<span>Returned: −${p.returned}</span>` : ''}
                </div>
                <div class="preset-ui">
                    <div class="preset-group">
                        <span class="preset-label label-red">Return</span>
                        <div class="preset-btns">
                            <button class="preset-btn return" data-name="${name}" data-amount="10">−10</button>
                            <button class="preset-btn return" data-name="${name}" data-amount="5">−5</button>
                        </div>
                    </div>
                    <div class="preset-group">
                        <span class="preset-label label-green">Buy</span>
                        <div class="preset-btns">
                            <button class="preset-btn buy" data-name="${name}" data-amount="5">+5</button>
                            <button class="preset-btn buy" data-name="${name}" data-amount="10">+10</button>
                        </div>
                    </div>
                    <div class="preset-actions">
                        <button class="preset-btn custom" data-name="${name}" title="Custom amount">⋯</button>
                        ${p.transactions.length > 1 ? `<button class="preset-btn undo btn-undo" data-name="${name}" title="Undo Last">↩</button>` : ''}
                    </div>
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

    // Attach action button events for in-game stage
    if (tpGame.stage === 'ingame') {
        // Preset Buy buttons (+5, +10)
        list.querySelectorAll('.preset-btn.buy').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.name;
                const amount = parseInt(btn.dataset.amount);
                tpGame.players[name].boughtMore += amount;
                tpGame.players[name].transactions.push({
                    type: 'buy_more', amount: amount, paymentType: 'credit'
                });
                btn.classList.add('btn-pop');
                setTimeout(() => btn.classList.remove('btn-pop'), 300);
                renderTpTracking();
                syncLiveSession('teenpatti', tpGame);
                toast(`${name} +${amount} tokens`);
            });
        });

        // Preset Return buttons (−5, −10)
        list.querySelectorAll('.preset-btn.return').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.name;
                const amount = parseInt(btn.dataset.amount);
                const p = tpGame.players[name];
                const maxReturn = p.initialTokens + p.boughtMore - p.returned;
                if (amount > maxReturn) {
                    toast(`❌ ${name} only has ${maxReturn} tokens`);
                    return false;
                }
                p.returned += amount;
                p.transactions.push({ type: 'return', amount: amount });
                btn.classList.add('btn-pop');
                setTimeout(() => btn.classList.remove('btn-pop'), 300);
                renderTpTracking();
                syncLiveSession('teenpatti', tpGame);
                toast(`${name} −${amount} tokens`);
            });
        });

        // Custom button (⋯) — opens choice dialog
        list.querySelectorAll('.preset-btn.custom').forEach(btn => {
            btn.addEventListener('click', () => {
                openCustomTokenChoice(btn.dataset.name);
            });
        });

        // Undo last transaction
        list.querySelectorAll('.btn-undo').forEach(btn => {
            btn.addEventListener('click', () => {
                undoLastTpTransaction(btn.dataset.name);
            });
        });
    }
}

// ── Custom Token Choice Overlay ──
function openCustomTokenChoice(name) {
    const p = tpGame.players[name];
    const maxReturn = p.initialTokens + p.boughtMore - p.returned;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'custom-choice-overlay';
    overlay.innerHTML = `
        <div class="modal glass-card" style="animation:modalPop .25s cubic-bezier(.16,1,.3,1)">
            <h3>${name} — Custom Amount</h3>
            <div class="custom-choice-btns">
                <button class="btn-primary" id="custom-buy-btn" style="margin-top:0;">+ Buy More</button>
                <button class="btn-outline" id="custom-return-btn">− Return Tokens</button>
            </div>
            <button class="btn-outline" id="custom-cancel-btn" style="margin-top:10px;color:var(--text-dim);font-size:.82rem;">Cancel</button>
        </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#custom-cancel-btn').onclick = () => overlay.remove();

    overlay.querySelector('#custom-buy-btn').onclick = () => {
        overlay.remove();
        openTokenModal(`${name} — Buy More Tokens`, 50, true, (val, payType) => {
            tpGame.players[name].boughtMore += val;
            tpGame.players[name].transactions.push({
                type: 'buy_more', amount: val, paymentType: payType
            });
            renderTpTracking();
            syncLiveSession('teenpatti', tpGame);
            toast(`${name} bought ${val} more tokens (${payType})`);
        });
    };

    overlay.querySelector('#custom-return-btn').onclick = () => {
        overlay.remove();
        openTokenModal(`${name} — Return Tokens`, Math.min(50, maxReturn), false, (val) => {
            if (val > maxReturn) {
                toast(`❌ Can't return more than ${maxReturn} tokens`);
                return;
            }
            tpGame.players[name].returned += val;
            tpGame.players[name].transactions.push({ type: 'return', amount: val });
            renderTpTracking();
            syncLiveSession('teenpatti', tpGame);
            toast(`${name} returned ${val} tokens`);
        });
    };
}

// ── Undo Last Transaction ──
function undoLastTpTransaction(name) {
    const p = tpGame.players[name];
    if (p.transactions.length <= 1) {
        toast('❌ Cannot undo initial tokens');
        return;
    }
    const last = p.transactions.pop();
    if (last.type === 'buy_more') {
        p.boughtMore -= last.amount;
    } else if (last.type === 'return') {
        p.returned -= last.amount;
    }
    renderTpTracking();
    syncLiveSession('teenpatti', tpGame);
    toast(`↩ Undid ${last.type === 'buy_more' ? 'buy' : 'return'} of ${last.amount} for ${name}`);
}

// ── End Game / Calculate Settlement ──
function endTpGame() {
    if (tpGame.stage === 'ingame') {
        tpGame.stage = 'ending';
        $('btn-end-tp').textContent = '📊 Calculate Settlement';
        renderTpTracking();
        syncLiveSession('teenpatti', tpGame);
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

// ── Settlement with Mismatch Distribution ──
function calculateTpSettlement() {
    $('tp-ingame-card').classList.add('hidden');
    $('tp-settlement-card').classList.remove('hidden');
    tpGame.stage = 'settlement';

    // First pass: calculate raw net amounts
    let totalAcquired = 0;
    let totalRemaining = 0;

    Object.entries(tpGame.players).forEach(([name, p]) => {
        const acquired = p.initialTokens + p.boughtMore - p.returned;
        totalAcquired += acquired;
        totalRemaining += p.remainingTokens;
        const net = (p.remainingTokens - acquired) * tpGame.tokenPrice;
        p.netAmount = Math.round(net * 100) / 100;
    });

    // ── Mismatch Detection & Distribution ──
    const tokenMismatch = totalRemaining - totalAcquired;
    tpGame.mismatchInfo = null;

    if (tokenMismatch !== 0) {
        const absMismatch = Math.abs(tokenMismatch);

        if (tokenMismatch > 0) {
            // Extra tokens: profits are overstated → adjust winners down
            const winners = Object.entries(tpGame.players)
                .filter(([_, p]) => p.netAmount > 0)
                .sort((a, b) => b[1].netAmount - a[1].netAmount);

            if (winners.length > 0) {
                const perPlayer = Math.floor(absMismatch / winners.length);
                const remainder = absMismatch % winners.length;

                winners.forEach(([wName, p], idx) => {
                    let adj = perPlayer;
                    if (idx === 0) adj += remainder;
                    p.netAmount -= adj * tpGame.tokenPrice;
                    p.netAmount = Math.round(p.netAmount * 100) / 100;
                });

                tpGame.mismatchInfo = {
                    tokenMismatch, totalRemaining, totalAcquired,
                    direction: 'extra',
                    adjustedGroup: 'winners',
                    adjustedCount: winners.length,
                    perPlayer, remainder,
                    biggestPlayer: winners[0][0]
                };
            }
        } else {
            // Missing tokens: losses are overstated → adjust losers up (reduce loss)
            const losers = Object.entries(tpGame.players)
                .filter(([_, p]) => p.netAmount < 0)
                .sort((a, b) => a[1].netAmount - b[1].netAmount);

            if (losers.length > 0) {
                const perPlayer = Math.floor(absMismatch / losers.length);
                const remainder = absMismatch % losers.length;

                losers.forEach(([lName, p], idx) => {
                    let adj = perPlayer;
                    if (idx === 0) adj += remainder;
                    p.netAmount += adj * tpGame.tokenPrice;
                    p.netAmount = Math.round(p.netAmount * 100) / 100;
                });

                tpGame.mismatchInfo = {
                    tokenMismatch, totalRemaining, totalAcquired,
                    direction: 'missing',
                    adjustedGroup: 'losers',
                    adjustedCount: losers.length,
                    perPlayer, remainder,
                    biggestPlayer: losers[0][0]
                };
            }
        }
    }

    // Render mismatch banner
    $('tp-mismatch-info').innerHTML = renderMismatchHTML(tpGame.mismatchInfo);

    // Build results with (potentially adjusted) netAmounts
    const balances = [];
    let resultsHTML = '';

    Object.entries(tpGame.players).forEach(([name, p]) => {
        const totalAcq = p.initialTokens + p.boughtMore - p.returned;
        balances.push({ player: name, balance: p.netAmount });

        let cls = 'neutral', display = '₹0';
        if (p.netAmount > 0) { cls = 'winner'; display = '+₹' + p.netAmount.toFixed(2); }
        else if (p.netAmount < 0) { cls = 'loser'; display = '−₹' + Math.abs(p.netAmount).toFixed(2); }

        const paymentBadge = p.isPaid
            ? '<span class="payment-badge paid small">💵 Paid</span>'
            : '<span class="payment-badge credit small">🏷️ Credit</span>';

        const isUpdate = $('tp-settlement-results').children.length > 0;
        const clsBase = 'result-row ' + cls;
        resultsHTML += `<div class="${isUpdate ? clsBase : clsBase + ' animate-in'}">
            <span>${name} ${paymentBadge}
                <small style="color:var(--text-muted);display:block;font-size:.75rem;">
                    Took ${p.initialTokens}${p.boughtMore > 0 ? '+' + p.boughtMore : ''}${p.returned > 0 ? '−' + p.returned : ''} = ${totalAcq} | Remaining: ${p.remainingTokens}
                </small>
            </span>
            <span class="r-amount">${display}</span>
        </div>`;
    });
    $('tp-settlement-results').innerHTML = resultsHTML;

    const transfers = minimumTransactions(balances);
    tpGame.transfers = transfers;
    renderTransfers('tp-transfers-list', transfers);

    // Sync final state
    syncLiveSession('teenpatti', tpGame);
}

// ── Mismatch Banner Renderer ──
function renderMismatchHTML(info) {
    if (!info || info.tokenMismatch === 0) return '';

    const abs = Math.abs(info.tokenMismatch);
    const isExtra = info.direction === 'extra';

    return `
        <div class="mismatch-banner warning animate-in">
            <div class="mismatch-icon">⚠️</div>
            <div class="mismatch-text">
                <strong>Token Mismatch: ${isExtra ? '+' : '−'}${abs} token${abs > 1 ? 's' : ''} ${isExtra ? '(extra)' : '(missing)'}</strong>
                <p>Remaining: ${info.totalRemaining} tokens | Acquired: ${info.totalAcquired} tokens</p>
                <p>Adjusted ${info.adjustedCount} ${info.adjustedGroup} equally (${info.perPlayer} token${info.perPlayer !== 1 ? 's' : ''} each${info.remainder > 0 ? `, +${info.remainder} extra to ${info.biggestPlayer}` : ''})</p>
            </div>
        </div>`;
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

        const payload = {
            tokenPrice: tpGame.tokenPrice,
            players: playersArr,
            settlements: tpGame.transfers,
            mismatchInfo: tpGame.mismatchInfo || null,
            _type: 'tp',
            createdAt: Date.now()
        };

        const { data, error } = await supabaseClient
            .from('teen_patti_games')
            .insert([{ data: payload }])
            .select('id')
            .single();

        if (error) throw new Error(error.message);

        tpGame._savedId = data.id;
        toast('✅ Teen Patti game saved!');
        await endLiveSession('teenpatti');

        // Push transfers to settlement ledger
        await pushToSettlementLedger(tpGame.transfers, 'Teen Patti');

        // Show delete button, hide save button
        $('btn-save-tp').classList.add('hidden');
        $('btn-delete-tp').classList.remove('hidden');
    } catch (e) {
        console.error(e);
        toast('❌ ' + (e.message || 'Save failed'));
    } finally {
        hideLoading();
    }
}

async function deleteSavedTpGame() {
    const id = tpGame && tpGame._savedId;
    if (!id) { toast('❌ No saved game to delete'); return; }

    if (!confirm('🗑️ Delete this game? It will be removed from leaderboard & history permanently.')) return;

    showLoading();
    try {
        const { error } = await supabaseClient
            .from('teen_patti_games')
            .delete()
            .eq('id', id);

        if (error) throw new Error(error.message);
        toast('🗑️ Game deleted');
        resetTpUI();
    } catch (e) {
        console.error(e);
        toast('❌ ' + (e.message || 'Delete failed'));
    } finally {
        hideLoading();
    }
}

function resetTpUI() {
    if (liveSessions.teenpatti.id) {
        endLiveSession('teenpatti');
    }
    $('tp-settlement-card').classList.add('hidden');
    $('tp-ingame-card').classList.add('hidden');
    $('tp-initial-card').classList.add('hidden');
    $('tp-setup-card').classList.remove('hidden');
    $('btn-end-tp').textContent = 'End Game & Settle';
    $('btn-save-tp').classList.remove('hidden');
    $('btn-delete-tp').classList.add('hidden');
    tpGame = null;
    liveSessions.teenpatti.isGuest = false;
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
    $('btn-delete-rummy').addEventListener('click', deleteSavedRumGame);
    $('btn-newgame-rummy').addEventListener('click', resetRumUI);
}

async function startRumGame() {
    const players = {};
    state.rumSelected.forEach(p => { players[p] = { rounds: [], total: 0 }; });
    rumGame = { players, rounds: [], stage: 'ingame' };
    $('rummy-setup-card').classList.add('hidden');
    $('rummy-join-banner').classList.add('hidden');
    $('rummy-ingame-card').classList.remove('hidden');
    renderRumScoreboard();

    // Create live session
    await createLiveSession('rummy', rumGame);
}

function renderRumScoreboard() {
    const list = $('rummy-scoreboard');
    const isUpdate = list.children.length > 0;
    
    const names = Object.keys(rumGame.players);
    // Sort by total points ascending (lower = better)
    const sorted = names.map(n => ({ name: n, total: rumGame.players[n].total }))
        .sort((a, b) => a.total - b.total);

    let html = '<table class="scoreboard"><thead><tr><th>#</th><th>Player</th><th>Points</th></tr></thead><tbody>';
    sorted.forEach((p, i) => {
        const cls = i === 0 && rumGame.rounds.length > 0 ? 'rank-1' : '';
        const anim = isUpdate ? '' : `class="animate-in" style="animation-delay:${i * 0.05}s"`;
        html += `<tr class="${cls}" ${anim}><td>${i + 1}</td><td>${p.name}</td><td>${p.total}</td></tr>`;
    });
    html += '</tbody></table>';
    $('rummy-scoreboard').innerHTML = html;

    // Round history with edit buttons
    let histHTML = '';
    if (rumGame.rounds.length > 0) {
        histHTML = '<div class="round-history">';
        rumGame.rounds.forEach((r, i) => {
            const anim = isUpdate ? '' : `class="round-item animate-in" style="animation-delay:${i * 0.03}s"`;
            histHTML += `<div ${isUpdate ? 'class="round-item"' : anim}>
                <span class="round-label">R${i + 1}:</span>`;
            Object.entries(r).forEach(([name, pts]) => {
                histHTML += `<span>${name}: ${pts}</span>`;
            });
            histHTML += `<button class="btn-edit-round" data-round="${i}" title="Edit Round ${i + 1}">✏️</button>`;
            histHTML += '</div>';
        });
        histHTML += '</div>';
    }
    $('rummy-round-history').innerHTML = histHTML;

    // Attach edit round handlers
    document.querySelectorAll('.btn-edit-round').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditRoundModal(parseInt(btn.dataset.round));
        });
    });
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
    $('round-modal-save').removeAttribute('data-edit-round');
    $('round-modal-save').textContent = 'Save Round';
    $('round-modal-overlay').classList.remove('hidden');
    setTimeout(() => {
        const first = $('round-modal-inputs').querySelector('input');
        if (first) { first.select(); first.focus(); }
    }, 100);
}

// ── Edit Existing Round ──
function openEditRoundModal(roundIdx) {
    if (!rumGame || roundIdx >= rumGame.rounds.length) return;
    const round = rumGame.rounds[roundIdx];
    const names = Object.keys(rumGame.players);
    $('round-modal-title').textContent = '✏️ Edit Round ' + (roundIdx + 1);
    let html = '';
    names.forEach(name => {
        html += `<div class="round-input-row">
            <label>${name}</label>
            <input type="number" class="round-pt-input" data-name="${name}" value="${round[name] || 0}" min="0">
        </div>`;
    });
    $('round-modal-inputs').innerHTML = html;
    $('round-modal-save').setAttribute('data-edit-round', roundIdx);
    $('round-modal-save').textContent = '✏️ Update Round';
    $('round-modal-overlay').classList.remove('hidden');
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

    const editAttr = $('round-modal-save').getAttribute('data-edit-round');
    const isEdit = editAttr !== null && editAttr !== '';

    if (isEdit) {
        // ── Edit existing round ──
        const idx = parseInt(editAttr);
        const oldRound = rumGame.rounds[idx];

        // Subtract old values
        Object.entries(oldRound).forEach(([name, pts]) => {
            rumGame.players[name].total -= pts;
        });
        // Add new values
        Object.entries(round).forEach(([name, pts]) => {
            rumGame.players[name].total += pts;
            rumGame.players[name].rounds[idx] = pts;
        });
        rumGame.rounds[idx] = round;

        $('round-modal-overlay').classList.add('hidden');
        renderRumScoreboard();
        syncLiveSession('rummy', rumGame);
        toast('✏️ Round ' + (idx + 1) + ' updated');
    } else {
        // ── Add new round ──
        rumGame.rounds.push(round);
        Object.entries(round).forEach(([name, pts]) => {
            rumGame.players[name].rounds.push(pts);
            rumGame.players[name].total += pts;
        });

        $('round-modal-overlay').classList.add('hidden');
        renderRumScoreboard();
        syncLiveSession('rummy', rumGame);
        toast('Round ' + rumGame.rounds.length + ' added');
    }
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
        const isUpdate = $('rummy-settlement-results').children.length > 0;
        const clsBase = 'result-row ' + cls;
        resultsHTML += `<div class="${isUpdate ? clsBase : clsBase + ' animate-in'}">
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

    // Sync settlement
    syncLiveSession('rummy', rumGame);
}

async function saveRumGame() {
    showLoading();
    try {
        const playersArr = Object.entries(rumGame.players).map(([name, p]) => ({
            name, rounds: p.rounds, totalPoints: p.total, netBalance: p.netBalance
        }));

        const payload = {
            pointValue: RUMMY_POINT_VALUE,
            players: playersArr,
            rounds: rumGame.rounds,
            settlements: rumGame.transfers,
            _type: 'rum',
            createdAt: Date.now()
        };

        const { data, error } = await supabaseClient
            .from('rummy_games')
            .insert([{ data: payload }])
            .select('id')
            .single();

        if (error) throw new Error(error.message);

        rumGame._savedId = data.id;
        toast('✅ Rummy game saved!');
        await endLiveSession('rummy');

        // Push transfers to settlement ledger
        await pushToSettlementLedger(rumGame.transfers, 'Rummy');

        // Show delete button, hide save button
        $('btn-save-rummy').classList.add('hidden');
        $('btn-delete-rummy').classList.remove('hidden');
    } catch (e) {
        console.error(e);
        toast('❌ ' + (e.message || 'Save failed'));
    } finally {
        hideLoading();
    }
}

async function deleteSavedRumGame() {
    const id = rumGame && rumGame._savedId;
    if (!id) { toast('❌ No saved game to delete'); return; }

    if (!confirm('🗑️ Delete this game? It will be removed from leaderboard & history permanently.')) return;

    showLoading();
    try {
        const { error } = await supabaseClient
            .from('rummy_games')
            .delete()
            .eq('id', id);

        if (error) throw new Error(error.message);
        toast('🗑️ Game deleted');
        resetRumUI();
    } catch (e) {
        console.error(e);
        toast('❌ ' + (e.message || 'Delete failed'));
    } finally {
        hideLoading();
    }
}

function resetRumUI() {
    if (liveSessions.rummy.id) {
        endLiveSession('rummy');
    }
    $('rummy-settlement-card').classList.add('hidden');
    $('rummy-ingame-card').classList.add('hidden');
    $('rummy-setup-card').classList.remove('hidden');
    $('btn-save-rummy').classList.remove('hidden');
    $('btn-delete-rummy').classList.add('hidden');
    rumGame = null;
    liveSessions.rummy.isGuest = false;
}

// ══════════════════════════════════════════════════════════
//  LIVE SESSION MANAGEMENT (Supabase Realtime)
// ══════════════════════════════════════════════════════════

async function createLiveSession(gameType, gameData) {
    const sessionState = getLiveSessionState(gameType);
    try {
        const { data: activeSameGame, error: activeGameError } = await supabaseClient
            .from('live_sessions')
            .select('id, updated_at, created_at')
            .eq('status', 'active')
            .eq('game_type', gameType)
            .order('updated_at', { ascending: false })
            .limit(1);

        if (activeGameError) throw activeGameError;
        if (activeSameGame && activeSameGame.length > 0 && activeSameGame[0].id !== sessionState.id) {
            toast(gameType === 'teenpatti'
                ? 'A Teen Patti live session is already active'
                : 'A Rummy live session is already active');
            checkActiveSessions();
            return false;
        }

        // Check if any selected players are already in an active session
        const { data: existingSessions } = await supabaseClient
            .from('live_sessions')
            .select('*')
            .eq('status', 'active');

        if (existingSessions && existingSessions.length > 0) {
            const currentPlayers = Object.keys(gameData.players);
            for (const session of existingSessions) {
                if (session.id === sessionState.id) continue;
                const sessionPlayers = Object.keys(session.session_data?.players || {});
                const overlap = currentPlayers.filter(p => sessionPlayers.includes(p));
                if (overlap.length > 0) {
                    toast(`⚠️ ${overlap.join(', ')} already in an active session`);
                    return;
                }
            }
        }

        const { data, error } = await supabaseClient
            .from('live_sessions')
            .insert([{
                game_type: gameType,
                session_data: gameData,
                status: 'active'
            }])
            .select()
            .single();

        if (error) throw error;

        sessionState.id = data.id;
        sessionState.isGuest = false;
        sessionState.lastSyncTimestamp = null;
        subscribeToLiveSession(data.id, gameType);
        toast('Live session started');
        checkActiveSessions();
        return true;
    } catch (e) {
        if (e.code === '23505') {
            toast(gameType === 'teenpatti'
                ? 'A Teen Patti live session is already active'
                : 'A Rummy live session is already active');
            checkActiveSessions();
            return false;
        }
        console.warn('Live session creation skipped:', e.message || e);
        // Game still works locally without live session
        return false;
    }
}

async function syncLiveSession(gameType, gameData) {
    const sessionState = getLiveSessionState(gameType);
    if (!sessionState.id) return;
    try {
        const ts = new Date().toISOString();
        sessionState.lastSyncTimestamp = ts;
        await supabaseClient
            .from('live_sessions')
            .update({
                session_data: JSON.parse(JSON.stringify(gameData)),
                updated_at: ts
            })
            .eq('id', sessionState.id)
            .eq('game_type', gameType);
    } catch (e) {
        console.warn('Live sync failed:', e.message || e);
    }
}

async function endLiveSession(gameType) {
    const sessionState = getLiveSessionState(gameType);
    if (!sessionState.id) return;
    try {
        await supabaseClient
            .from('live_sessions')
            .update({ status: 'ended', updated_at: new Date().toISOString() })
            .eq('id', sessionState.id)
            .eq('game_type', gameType);
    } catch (e) {
        console.warn('End live session failed:', e.message || e);
    }
    unsubscribeLiveSession(gameType);
    checkActiveSessions();
}

function subscribeToLiveSession(sessionId, gameType) {
    const sessionState = getLiveSessionState(gameType);
    if (sessionState.channel) {
        supabaseClient.removeChannel(sessionState.channel);
    }

    sessionState.id = sessionId;
    sessionState.channel = supabaseClient
        .channel('live-session-' + gameType + '-' + sessionId)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'live_sessions',
            filter: `id=eq.${sessionId}`
        }, (payload) => {
            const newData = payload.new;

            // Skip our own update
            if (newData.updated_at === sessionState.lastSyncTimestamp) return;

            if (newData.status === 'ended') {
                toast('📡 Session ended');
                if (gameType === 'teenpatti' && newData.session_data) {
                    tpGame = newData.session_data;
                    if (tpGame.stage === 'settlement') {
                        renderTpSettlementFromData();
                    }
                } else if (gameType === 'rummy' && newData.session_data) {
                    rumGame = newData.session_data;
                    if (rumGame.stage === 'settlement') {
                        renderRumSettlementFromData();
                    }
                }
                unsubscribeLiveSession(gameType);
                checkActiveSessions();
                return;
            }

            // Apply live update
            if (gameType === 'teenpatti') {
                applyLiveTpUpdate(newData.session_data);
            } else if (gameType === 'rummy') {
                applyLiveRumUpdate(newData.session_data);
            }
        })
        .subscribe();
}

function unsubscribeLiveSession(gameType) {
    const sessionState = getLiveSessionState(gameType);
    if (sessionState.channel) {
        supabaseClient.removeChannel(sessionState.channel);
        sessionState.channel = null;
    }
    sessionState.id = null;
    sessionState.isGuest = false;
    sessionState.lastSyncTimestamp = null;
}

// ── Apply Realtime Updates ──
function applyLiveTpUpdate(sessionData) {
    if (!sessionData) return;
    tpGame = sessionData;

    $('tp-price-badge').textContent = '₹' + tpGame.tokenPrice + '/token';

    if (tpGame.stage === 'ingame' || tpGame.stage === 'ending') {
        $('tp-setup-card').classList.add('hidden');
        $('tp-initial-card').classList.add('hidden');
        $('tp-ingame-card').classList.remove('hidden');
        $('tp-settlement-card').classList.add('hidden');
        $('btn-end-tp').textContent = tpGame.stage === 'ending' ? '📊 Calculate Settlement' : 'End Game & Settle';
        renderTpTracking();
    } else if (tpGame.stage === 'settlement') {
        renderTpSettlementFromData();
    }
}

function renderTpSettlementFromData() {
    $('tp-setup-card').classList.add('hidden');
    $('tp-initial-card').classList.add('hidden');
    $('tp-ingame-card').classList.add('hidden');
    $('tp-settlement-card').classList.remove('hidden');

    // Render mismatch banner
    $('tp-mismatch-info').innerHTML = renderMismatchHTML(tpGame.mismatchInfo);

    let resultsHTML = '';
    const balances = [];

    Object.entries(tpGame.players).forEach(([name, p]) => {
        const totalAcq = p.initialTokens + p.boughtMore - p.returned;
        balances.push({ player: name, balance: p.netAmount });

        let cls = 'neutral', display = '₹0';
        if (p.netAmount > 0) { cls = 'winner'; display = '+₹' + p.netAmount.toFixed(2); }
        else if (p.netAmount < 0) { cls = 'loser'; display = '−₹' + Math.abs(p.netAmount).toFixed(2); }

        const paymentBadge = p.isPaid
            ? '<span class="payment-badge paid small">💵 Paid</span>'
            : '<span class="payment-badge credit small">🏷️ Credit</span>';

        const isUpdate = $('tp-settlement-results').children.length > 0;
        const clsBase = 'result-row ' + cls;
        resultsHTML += `<div class="${isUpdate ? clsBase : clsBase + ' animate-in'}">
            <span>${name} ${paymentBadge}
                <small style="color:var(--text-muted);display:block;font-size:.75rem;">
                    Took ${p.initialTokens}${p.boughtMore > 0 ? '+' + p.boughtMore : ''}${p.returned > 0 ? '−' + p.returned : ''} = ${totalAcq} | Remaining: ${p.remainingTokens}
                </small>
            </span>
            <span class="r-amount">${display}</span>
        </div>`;
    });
    $('tp-settlement-results').innerHTML = resultsHTML;

    const transfers = tpGame.transfers || minimumTransactions(balances);
    renderTransfers('tp-transfers-list', transfers);
}

function applyLiveRumUpdate(sessionData) {
    if (!sessionData) return;
    rumGame = sessionData;

    if (rumGame.stage === 'ingame') {
        $('rummy-setup-card').classList.add('hidden');
        $('rummy-ingame-card').classList.remove('hidden');
        $('rummy-settlement-card').classList.add('hidden');
        renderRumScoreboard();
    } else if (rumGame.stage === 'settlement') {
        renderRumSettlementFromData();
    }
}

function renderRumSettlementFromData() {
    $('rummy-setup-card').classList.add('hidden');
    $('rummy-ingame-card').classList.add('hidden');
    $('rummy-settlement-card').classList.remove('hidden');

    let resultsHTML = '';
    const balances = [];

    Object.entries(rumGame.players).forEach(([name, p]) => {
        const netAmount = p.netBalance || 0;
        balances.push({ player: name, balance: netAmount });

        let cls = 'neutral', display = '₹0';
        if (netAmount > 0) { cls = 'winner'; display = '+₹' + netAmount.toFixed(2); }
        else if (netAmount < 0) { cls = 'loser'; display = '−₹' + Math.abs(netAmount).toFixed(2); }

        const isUpdate = $('rummy-settlement-results').children.length > 0;
        const clsBase = 'result-row ' + cls;
        resultsHTML += `<div class="${isUpdate ? clsBase : clsBase + ' animate-in'}">
            <span>${name} <small style="color:var(--text-muted)">(${p.total} pts)</small></span>
            <span class="r-amount">${display}</span>
        </div>`;
    });
    $('rummy-settlement-results').innerHTML = resultsHTML;

    const sum = balances.reduce((s, b) => s + b.balance, 0);
    const verifyEl = $('rummy-verify');
    if (Math.abs(sum) < 0.01) {
        verifyEl.className = 'verify-badge pass';
        verifyEl.textContent = '✅ Verified: Net sum = ₹0';
    } else {
        verifyEl.className = 'verify-badge fail';
        verifyEl.textContent = '⚠️ Mismatch: Net sum = ₹' + sum.toFixed(2);
    }

    const transfers = rumGame.transfers || minimumTransactions(balances);
    renderTransfers('rummy-transfers-list', transfers);
}

// ── Check for Active Sessions & Show Join Banners ──
const STALE_SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours

async function checkActiveSessions() {
    try {
        const { data, error } = await supabaseClient
            .from('live_sessions')
            .select('*')
            .eq('status', 'active')
            .order('updated_at', { ascending: false });

        if (error || !data) return;

        const tpBanner = $('tp-join-banner');
        const rumBanner = $('rummy-join-banner');

        if (tpBanner) tpBanner.classList.add('hidden');
        if (rumBanner) rumBanner.classList.add('hidden');

        // Auto-cleanup stale sessions (older than 12 hours)
        const now = Date.now();
        const staleIds = [];
        const activeSessions = data.filter(session => {
            const updatedAt = new Date(session.updated_at).getTime();
            if (now - updatedAt > STALE_SESSION_MS) {
                staleIds.push(session.id);
                return false;
            }
            return true;
        });

        if (staleIds.length > 0) {
            // End stale sessions in background
            supabaseClient
                .from('live_sessions')
                .update({ status: 'ended', updated_at: new Date().toISOString() })
                .in('id', staleIds)
                .then(() => console.log('Cleaned up', staleIds.length, 'stale session(s)'))
                .catch(e => console.warn('Stale session cleanup failed:', e.message || e));
        }

        const activeByGame = {};
        activeSessions.forEach(session => {
            if (!liveSessions[session.game_type]) return;
            if (!activeByGame[session.game_type]) {
                activeByGame[session.game_type] = session;
            }
        });

        setupJoinBanner(activeByGame.teenpatti, 'teenpatti', tpBanner, tpGame);
        setupJoinBanner(activeByGame.rummy, 'rummy', rumBanner, rumGame);
    } catch (e) {
        // live_sessions table might not exist yet — silent fail
        console.warn('Session check skipped:', e.message || e);
    }
}

function setupJoinBanner(session, gameType, banner, currentGame) {
    if (!session || !banner || currentGame) return;
    if (session.id === liveSessions[gameType].id) return;

    const players = Object.keys(session.session_data?.players || {}).join(', ');
    banner.classList.remove('hidden');
    banner.querySelector('.join-players').textContent = 'Players: ' + players;
    banner.querySelector('.btn-join-session').onclick = () => joinLiveSession(session.id, gameType);

    // Wire up End Session button
    const endBtn = banner.querySelector('.btn-end-session');
    if (endBtn) {
        endBtn.onclick = (e) => {
            e.stopPropagation();
            endSessionById(session.id, gameType);
        };
    }
}

async function endSessionById(sessionId, gameType) {
    if (!confirm('End this live session? It will be closed for all devices.')) return;
    try {
        showLoading();
        await supabaseClient
            .from('live_sessions')
            .update({ status: 'ended', updated_at: new Date().toISOString() })
            .eq('id', sessionId);
        toast('Session ended');
    } catch (e) {
        console.warn('Failed to end session:', e.message || e);
        toast('Failed to end session');
    } finally {
        hideLoading();
        checkActiveSessions();
    }
}

async function joinLiveSession(sessionId, gameType) {
    try {
        showLoading();
        const { data, error } = await supabaseClient
            .from('live_sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (error || !data) throw new Error('Session not found');
        if (data.status !== 'active') { toast('Session has ended'); hideLoading(); return; }
        if (data.game_type !== gameType) throw new Error('Session type mismatch');

        const sessionState = getLiveSessionState(gameType);
        sessionState.id = sessionId;
        sessionState.isGuest = true;
        sessionState.lastSyncTimestamp = null;

        if (gameType === 'teenpatti') {
            tpGame = data.session_data;
            $('tp-setup-card').classList.add('hidden');
            $('tp-join-banner').classList.add('hidden');
            $('tp-price-badge').textContent = '₹' + tpGame.tokenPrice + '/token';

            if (tpGame.stage === 'settlement') {
                renderTpSettlementFromData();
            } else {
                $('tp-ingame-card').classList.remove('hidden');
                $('btn-end-tp').textContent = tpGame.stage === 'ending' ? '📊 Calculate Settlement' : 'End Game & Settle';
                renderTpTracking();
            }
            // Switch to TP tab
            $$('.tab-btn').forEach(b => b.classList.remove('active'));
            $$('.view').forEach(v => v.classList.remove('active'));
            document.querySelector('[data-target="view-teenpatti"]').classList.add('active');
            $('view-teenpatti').classList.add('active');
        } else if (gameType === 'rummy') {
            rumGame = data.session_data;
            $('rummy-setup-card').classList.add('hidden');
            $('rummy-join-banner').classList.add('hidden');

            if (rumGame.stage === 'settlement') {
                renderRumSettlementFromData();
            } else {
                $('rummy-ingame-card').classList.remove('hidden');
                renderRumScoreboard();
            }
            // Switch to Rummy tab
            $$('.tab-btn').forEach(b => b.classList.remove('active'));
            $$('.view').forEach(v => v.classList.remove('active'));
            document.querySelector('[data-target="view-rummy"]').classList.add('active');
            $('view-rummy').classList.add('active');
        }

        subscribeToLiveSession(sessionId, gameType);
        toast('📡 Joined live session!');
    } catch (e) {
        console.error(e);
        toast('❌ Failed to join session');
    } finally {
        hideLoading();
    }
}

// ══════════════════════════════════════════════════════════
//  MINIMUM TRANSACTION SETTLEMENT ALGORITHM
// ══════════════════════════════════════════════════════════
function minimumTransactions(balances) {
    let debtors = balances.filter(b => b.balance < -0.001)
        .map(b => ({ ...b, balance: Math.round(b.balance * 100) / 100 }))
        .sort((a, b) => a.balance - b.balance);
    let creditors = balances.filter(b => b.balance > 0.001)
        .map(b => ({ ...b, balance: Math.round(b.balance * 100) / 100 }))
        .sort((a, b) => b.balance - a.balance);

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
        c.innerHTML = '<div class="transfer-item animate-in">No transfers needed 🎉</div>';
        return;
    }
    c.innerHTML = transfers.map((t, i) =>
        `<div class="transfer-item animate-in" style="animation-delay:${i * 0.08}s">
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
        const [tpRes, rumRes] = await Promise.all([
            supabaseClient.from('teen_patti_games').select('id,data').order('created_at', { ascending: false }).limit(50),
            supabaseClient.from('rummy_games').select('id,data').order('created_at', { ascending: false }).limit(50)
        ]);

        if (tpRes.error) throw new Error(tpRes.error.message);
        if (rumRes.error) throw new Error(rumRes.error.message);

        lbData.tp = tpRes.data.map(row => ({ ...row.data, _rowId: row.id }));
        lbData.rum = rumRes.data.map(row => ({ ...row.data, _rowId: row.id }));

    } catch (e) {
        console.warn('Leaderboard load failed:', e.message || e);
        toast('⚠️ ' + (e.message || 'Could not load data — showing cached'));
    } finally {
        hideLoading();
    }

    const activeLb = document.querySelector('#lb-sub-tabs .sub-tab.active');
    renderLeaderboardTable(activeLb ? activeLb.dataset.lb : 'combined');
    const activeHist = document.querySelector('#history-sub-tabs .sub-tab.active');
    renderHistory(activeHist ? activeHist.dataset.hist : 'all');
}

function renderLeaderboardTable(type) {
    const playerStats = {};

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
        html += `<tr class="animate-in" style="animation-delay:${i * 0.04}s">
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
        const da = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const db2 = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return db2 - da;
    });

    if (games.length === 0) {
        $('history-content').innerHTML = '<div class="empty-state">No games saved yet.</div>';
        return;
    }

    let html = '';
    games.forEach((g, gi) => {
        const date = g.createdAt ? new Date(g.createdAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Unknown';
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

        html += `<div class="history-card animate-in" style="animation-delay:${gi * 0.04}s" onclick="this.classList.toggle('expanded')">
            <div class="history-card-top">
                <span class="history-type ${typeCls}">${typeLabel}</span>
                <span class="history-date">${date}</span>
            </div>
            <div class="history-players">${playerNames}</div>
            <div class="history-detail">${detailHTML}</div>
            ${g._rowId ? `<button class="btn-delete-history" data-id="${g._rowId}" data-table="${g._type === 'tp' ? 'teen_patti_games' : 'rummy_games'}" onclick="event.stopPropagation(); deleteHistoryGame(this)">🗑️ Delete Game</button>` : ''}
        </div>`;
    });
    $('history-content').innerHTML = html;
}

async function deleteHistoryGame(btn) {
    const id = btn.dataset.id;
    const table = btn.dataset.table;
    if (!id || !table) return;

    if (!confirm('🗑️ Delete this game? It will be removed from leaderboard & history permanently.')) return;

    showLoading();
    try {
        const { error } = await supabaseClient
            .from(table)
            .delete()
            .eq('id', id);

        if (error) throw new Error(error.message);
        toast('🗑️ Game deleted');
        await refreshLeaderboard();
    } catch (e) {
        console.error(e);
        toast('❌ ' + (e.message || 'Delete failed'));
    } finally {
        hideLoading();
    }
}

// ══════════════════════════════════════════════════════════
//  SETTLEMENT — Player-Centric Aggregation
// ══════════════════════════════════════════════════════════

async function pushToSettlementLedger(transfers, gameLabel) {
    if (!transfers || transfers.length === 0) return;
    try {
        const rows = transfers.map(t => ({
            from_player: t.from,
            to_player: t.to,
            amount: t.amount,
            paid_amount: 0,
            status: 'pending',
            game_label: gameLabel,
            created_at: new Date().toISOString()
        }));

        const { error } = await supabaseClient
            .from('settlement_ledger')
            .insert(rows);

        if (error) throw error;
    } catch (e) {
        console.warn('Settlement ledger push skipped:', e.message || e);
    }
}

async function refreshSettlements() {
    showLoading();
    try {
        // Fetch all game data (same source as leaderboard)
        const [tpRes, rumRes] = await Promise.all([
            supabaseClient.from('teen_patti_games').select('id,data').limit(500),
            supabaseClient.from('rummy_games').select('id,data').limit(500)
        ]);

        if (tpRes.error) throw new Error(tpRes.error.message);
        if (rumRes.error) throw new Error(rumRes.error.message);

        const allGames = [
            ...(tpRes.data || []).map(r => r.data),
            ...(rumRes.data || []).map(r => r.data)
        ].filter(Boolean);

        // Step 1: Compute per-player net balance from game data (matches leaderboard)
        const playerNet = {};

        allGames.forEach(game => {
            if (!game || !game.players) return;
            const players = Array.isArray(game.players)
                ? game.players
                : Object.entries(game.players).map(([name, p]) => ({ name, ...p }));

            players.forEach(p => {
                if (!p.name) return;
                const amt = p.netAmount ?? p.netBalance ?? 0;
                if (!playerNet[p.name]) playerNet[p.name] = 0;
                playerNet[p.name] = Math.round((playerNet[p.name] + amt) * 100) / 100;
            });
        });

        // Step 2: Build balances and handle mismatch (sum must be 0 for algorithm)
        const balances = Object.entries(playerNet)
            .filter(([_, bal]) => Math.abs(bal) > 0.005)
            .map(([player, balance]) => ({ player, balance: Math.round(balance * 100) / 100 }));

        const rawSum = Math.round(balances.reduce((s, b) => s + b.balance, 0) * 100) / 100;
        let mismatchAmount = 0;

        if (Math.abs(rawSum) > 0.01) {
            mismatchAmount = Math.abs(rawSum);
            // Distribute mismatch across winners proportionally (losers stay exact)
            if (rawSum < 0) {
                // More debt than credit → increase winners to absorb
                const winners = balances.filter(b => b.balance > 0.001);
                const totalCredit = winners.reduce((s, b) => s + b.balance, 0);
                if (totalCredit > 0) {
                    const absSum = Math.abs(rawSum);
                    let distributed = 0;
                    winners.forEach((b, i) => {
                        if (i === winners.length - 1) {
                            // Last winner gets the remainder to avoid rounding drift
                            b.balance = Math.round((b.balance + (absSum - distributed)) * 100) / 100;
                        } else {
                            const share = Math.round((b.balance / totalCredit) * absSum * 100) / 100;
                            b.balance = Math.round((b.balance + share) * 100) / 100;
                            distributed += share;
                        }
                    });
                }
            } else {
                // More credit than debt → increase losers to absorb
                const losers = balances.filter(b => b.balance < -0.001);
                const totalDebt = losers.reduce((s, b) => s + Math.abs(b.balance), 0);
                if (totalDebt > 0) {
                    let distributed = 0;
                    losers.forEach((b, i) => {
                        if (i === losers.length - 1) {
                            b.balance = Math.round((b.balance - (rawSum - distributed)) * 100) / 100;
                        } else {
                            const share = Math.round((Math.abs(b.balance) / totalDebt) * rawSum * 100) / 100;
                            b.balance = Math.round((b.balance - share) * 100) / 100;
                            distributed += share;
                        }
                    });
                }
            }
        }

        // Step 3: Run minimum transactions on balanced amounts
        const transfers = minimumTransactions(balances);

        // Step 4: Build per-player transfer map
        const playerTransfers = {};
        Object.keys(playerNet).forEach(name => { playerTransfers[name] = []; });

        transfers.forEach(t => {
            if (!playerTransfers[t.from]) playerTransfers[t.from] = [];
            if (!playerTransfers[t.to]) playerTransfers[t.to] = [];
            playerTransfers[t.from].push({ type: 'pays', player: t.to, amount: t.amount });
            playerTransfers[t.to].push({ type: 'receives', player: t.from, amount: t.amount });
        });

        // Render
        renderSettlementView(playerNet, playerTransfers, transfers, mismatchAmount);

    } catch (e) {
        console.warn('Settlement load failed:', e.message || e);
        const el = $('settle-players');
        if (el) el.innerHTML = '<div class="empty-state">⚠️ Could not load settlement data</div>';
    } finally {
        hideLoading();
    }
}

function renderSettlementView(playerNet, playerTransfers, transfers, mismatchAmount) {
    const playersContainer = $('settle-players');
    const quickContainer = $('settle-quick');
    const quickCard = $('settle-quick-card');
    const mismatchNote = $('settle-mismatch-note');

    // Check if all settled
    const hasActivity = Object.values(playerNet).some(v => Math.abs(v) > 0.005);

    if (!hasActivity) {
        playersContainer.innerHTML = `
            <div class="settle-all-clear">
                <span class="settle-clear-icon">🎉</span>
                <div class="settle-clear-text">All Settled!</div>
                <div class="settle-clear-sub">No games recorded yet</div>
            </div>`;
        if (quickCard) quickCard.classList.add('hidden');
        if (mismatchNote) mismatchNote.innerHTML = '';
        return;
    }

    // Sort players: winners first (descending), then losers (ascending), then zero
    const sorted = Object.entries(playerNet).sort((a, b) => b[1] - a[1]);

    // Render player cards
    let cardsHTML = '';
    sorted.forEach(([name, net], i) => {
        const cls = net > 0.005 ? 'winner' : net < -0.005 ? 'loser' : 'neutral';
        const amtCls = net > 0.005 ? 'positive' : net < -0.005 ? 'negative' : 'zero';
        const display = net > 0.005 ? '+₹' + net.toFixed(2)
            : net < -0.005 ? '−₹' + Math.abs(net).toFixed(2)
            : '₹0';

        const details = playerTransfers[name] || [];

        let detailHTML = '';
        if (details.length > 0) {
            details.sort((a, b) => b.amount - a.amount);
            details.forEach(d => {
                const dirLabel = d.type === 'pays' ? 'PAY' : 'GET';
                const dirCls = d.type;
                detailHTML += `<div class="settle-detail-row">
                    <div class="settle-detail-label">
                        <span class="settle-detail-dir ${dirCls}">${dirLabel}</span>
                        <span>${d.player}</span>
                    </div>
                    <span class="settle-detail-amount ${dirCls}">₹${d.amount.toFixed(2)}</span>
                </div>`;
            });
        } else {
            detailHTML = '<div class="settle-detail-empty">No pending transfers</div>';
        }

        cardsHTML += `<div class="settle-player ${cls} animate-in" style="animation-delay:${i * 0.05}s" onclick="this.classList.toggle('expanded')">
            <div class="settle-player-header">
                <div class="settle-player-left">
                    <span class="settle-player-name">${name}</span>
                </div>
                <div class="settle-player-right">
                    <span class="settle-player-amount ${amtCls}">${display}</span>
                    <span class="settle-player-chevron">▾</span>
                </div>
            </div>
            <div class="settle-player-detail">
                <div class="settle-player-detail-inner">
                    ${detailHTML}
                </div>
            </div>
        </div>`;
    });

    playersContainer.innerHTML = cardsHTML;

    // Render quick summary (minimum transfers)
    if (transfers.length > 0 && quickCard) {
        quickCard.classList.remove('hidden');
        let quickHTML = '';
        transfers.forEach((t, i) => {
            quickHTML += `<div class="settle-transfer-row" style="animation-delay:${i * 0.06}s">
                <span class="settle-transfer-from">${t.from}</span>
                <span class="settle-transfer-arrow">→</span>
                <span class="settle-transfer-to">${t.to}</span>
                <span class="settle-transfer-amount">₹${t.amount.toFixed(2)}</span>
            </div>`;
        });
        quickContainer.innerHTML = quickHTML;
    } else if (quickCard) {
        quickCard.classList.add('hidden');
    }

    // Render mismatch note
    if (mismatchNote) {
        if (mismatchAmount > 0.01) {
            mismatchNote.innerHTML = `⚠️ ₹${mismatchAmount.toFixed(2)} adjusted across games for token counting discrepancies`;
        } else {
            mismatchNote.innerHTML = '';
        }
    }
}

// ══════════════════════════════════════════════════════════
//  PWA SERVICE WORKER & INSTALL PROMPT
// ══════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                console.log('SW registered:', reg.scope);
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

    const logo = document.querySelector('.logo');
    logo.style.marginBottom = '0';
    header.insertBefore(installBtn, document.querySelector('.tabs'));

    document.querySelector('.tabs').style.width = '100%';
    document.querySelector('.tabs').style.marginTop = '12px';
}
