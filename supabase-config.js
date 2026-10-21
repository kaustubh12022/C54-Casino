// ─────────────────────────────────────────────────────────────────────────────
// C54 Casino — Supabase runtime configuration
//
// SECURITY NOTE — READ THIS
//   The Supabase *anon* key below is PUBLIC BY DESIGN. It is a JWT whose role
//   claim is "anon", it is embedded in every browser bundle of every Supabase
//   app in production, and it grants NOTHING on its own: every row it can
//   touch is filtered by Row Level Security (RLS) policies, which live in
//   init_tables.js.
//
//   Therefore:
//     • The anon key is safe to commit and safe to ship in the browser.
//     • The REAL secret is the Postgres password / service_role key. Those
//       must NEVER appear in this file, in app.js or anywhere in the repo.
//     • RLS is the actual security boundary of this application. If you widen
//       a policy, you widen the app's security.
//
//   The values can be overridden at runtime — no rebuild required — by
//   defining window.__ENV__ before this script is loaded, e.g.
//     <script>window.__ENV__ = { SUPABASE_URL: "https://<ref>.supabase.co" };</script>
// ─────────────────────────────────────────────────────────────────────────────

// `window` does not exist when this file is loaded by a Node script
// (keepalive.js, tooling), so fall back to globalThis.
const __RUNTIME_ENV__ = (typeof window !== "undefined" ? window : globalThis).__ENV__ || {};

const SUPABASE_URL = __RUNTIME_ENV__.SUPABASE_URL || "https://ixczvfnzttmiecgqoiek.supabase.co";
const SUPABASE_ANON_KEY = __RUNTIME_ENV__.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4Y3p2Zm56dHRtaWVjZ3FvaWVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODEyNzAsImV4cCI6MjA5NjE1NzI3MH0.aFvyi9hsXxN-21AS1ecaBI0OzYLkdxbsqVLIJtC3xGU";

// Initialize Supabase Client.
// `var` (not `const`) keeps the binding reachable as a global for app.js,
// which is loaded as a separate classic script. The guard keeps the file
// require()-able from Node, where the `supabase` browser SDK is not present.
var supabaseClient = (typeof supabase !== "undefined" && typeof supabase.createClient === "function")
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// Node consumers (keepalive.js and other tooling) can require() this file.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { SUPABASE_URL, SUPABASE_ANON_KEY };
}
