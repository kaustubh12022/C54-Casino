#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// C54 Casino — Supabase keepalive
//
// WHY THIS EXISTS
//   Supabase's Free Plan pauses a project after 7 days without activity. A
//   paused project rejects every request until it is restored, which is
//   exactly what happened to this app: the project
//   (ixczvfnzttmiecgqoiek) was paused on 2026-09-27 after a week of no
//   traffic and the live site at https://c54-casino.vercel.app went dead
//   until the project was restored manually.
//
//   This script performs one cheap authenticated read against the project so
//   the platform sees recent activity and the project is never paused.
//
//   HOW TO RUN IT
//     node keepalive.js
//     # e.g. from a cron job, once a day:
//     0 9 * * * /usr/bin/node /path/to/c54-casino/keepalive.js >> /var/log/c54-keepalive.log 2>&1
//
//   It uses the public anon key only (never a database password, never the
//   service_role key) and it never prints that key.
//
//   EXIT CODES
//     0 — the project answered, it will not be paused
//     1 — the project did not answer (paused, unreachable, wrong URL/key)
//
//   NOTE
//     A paid Supabase plan removes the need for this script entirely: paid
//     projects are not paused for inactivity. Until then, run it daily.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const config = require('./supabase-config.js');

// Environment variables win over the values baked into supabase-config.js, so
// the same script can be pointed at another project without a rebuild.
const SUPABASE_URL = (process.env.SUPABASE_URL || config.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || config.SUPABASE_ANON_KEY || '';

const PAID_PLAN_NOTE = 'note: a paid Supabase plan is never paused for inactivity and removes the need for this script.';

async function keepalive() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('✗ keepalive failed: SUPABASE_URL / SUPABASE_ANON_KEY are not configured.');
        console.error(PAID_PLAN_NOTE);
        return 1;
    }

    const endpoint = `${SUPABASE_URL}/rest/v1/players?select=name&limit=1`;

    try {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`✗ keepalive failed: HTTP ${response.status} from the Supabase REST API.`);
            if (response.status === 401 || response.status === 403) {
                console.error('  The anon key was rejected — check SUPABASE_ANON_KEY.');
            }
            console.error(PAID_PLAN_NOTE);
            return 1;
        }

        console.log(`✓ keepalive ok: Supabase answered (HTTP ${response.status}), project stays awake.`);
        console.log(PAID_PLAN_NOTE);
        return 0;
    } catch (error) {
        console.error(`✗ keepalive failed: ${error && error.message ? error.message : error}`);
        console.error(PAID_PLAN_NOTE);
        return 1;
    }
}

keepalive()
    .then(code => process.exit(code))
    .catch(error => {
        console.error(`✗ keepalive failed: ${error && error.message ? error.message : error}`);
        console.error(PAID_PLAN_NOTE);
        process.exit(1);
    });
