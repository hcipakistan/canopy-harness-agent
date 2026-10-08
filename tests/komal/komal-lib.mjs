// tests/komal/komal-lib.mjs — small shared harness for the Komal L4 suite.
//
// Reads TEST_* variables from .env.test (this workspace root) and falls back
// to the agent's own .env. Prefer .env.test pointing at STAGING — the live
// project keys in .env must not be used for writes.
//
//   copy .env.test.example .env.test    # then fill in staging values

import crypto from 'node:crypto';

try {
  process.loadEnvFile('.env.test');
} catch {
  try {
    process.loadEnvFile('.env'); // fallback: the agent's own env (live project)
  } catch {
    /* env vars set externally */
  }
}

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} — copy .env.test.example to .env.test at the agent workspace root and fill it in.`);
  return v;
}

export const env = {
  url: (process.env.TEST_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
  serviceKey: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  anonKey: process.env.TEST_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '',
};
for (const k of ['url', 'serviceKey', 'anonKey']) if (!env[k]) need(`TEST_SUPABASE_${k === 'url' ? 'URL' : k.toUpperCase()}`);

// Safety guard: the suite WRITES test data. Never let it run against the live
// Canopy project (vofdiurgvgtfokvbdown) just because .env.test is missing and
// the agent's .env fell back to production. Require an explicit TEST_ override.
if (!process.env.TEST_SUPABASE_URL && env.url.includes('vofdiurgvgtfokvbdown')) {
  console.error('');
  console.error('🚫 Refusing to run the L4 suite against the LIVE Canopy project.');
  console.error('   .env.test is missing, so the runner fell back to the agent .env');
  console.error('   which points at production. Copy .env.test.example to .env.test');
  console.error('   with the STAGING project credentials and run again.');
  process.exit(2);
}

const base = {
  apikey: env.serviceKey,
  Authorization: `Bearer ${env.serviceKey}`,
  'Content-Type': 'application/json',
};

export async function rest(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(env.url + path, {
    method,
    headers: { ...base, ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, ok: res.ok, body: parsed, text };
}

export const rpc = (name, args) => rest(`/rest/v1/rpc/${name}`, { method: 'POST', body: args });
export const selectRows = (table, query = '') => rest(`/rest/v1/${table}${query ? '?' + query : ''}`);
export const insertRow = (table, row) =>
  rest(`/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: row });
export const deleteRows = (table, filter) => rest(`/rest/v1/${table}?${filter}`, { method: 'DELETE' });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let seq = 0;

/**
 * E.164 test phone — never a real patient.
 * The LAST TWO DIGITS are the caller-provided suffix (the routing rules key
 * off them, e.g. 47 → 47 % 4 = 3); the four middle digits increment so the
 * full number is unique across scenarios within a run (leads are unique on
 * mobile, and scenarios share suffixes — without this they collide with 409).
 */
export function testPhone(suffix = '00') {
  const s = String(suffix).padStart(2, '0');
  const mid = String(1000 + (seq++ % 9000)).padStart(4, '0'); // 1000..9999
  return `+920000${mid}${s}`;
}

/** Create a real auth user + profile (Admin API), for booking/assignment tests. */
export async function createTestUser({ role = 'cso', branchId = null, isCentral = true, fullName = 'E2E Komal User' } = {}) {
  const email = `komal-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.hairclub.local`;
  const password = 'E2eTest!2026';
  const r = await rest('/auth/v1/admin/users', {
    method: 'POST',
    body: { email, password, email_confirm: true },
  });
  if (!r.ok) throw new Error(`create auth user failed: ${r.status} ${r.text}`);
  const uid = r.body.id;
  const p = await insertRow('profiles', { id: uid, full_name: fullName, role, branch_id: branchId, is_central: isCentral });
  if (!p.ok) throw new Error(`create profile failed: ${p.status} ${p.text}`);
  return { userId: uid, profileId: uid, email, password };
}

export async function deleteTestUser(userId) {
  const r = await rest(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`delete auth user failed: ${r.status} ${r.text}`);
}

// --- reporting --------------------------------------------------------------

const results = [];

export function section(title) {
  console.log('\n' + '='.repeat(74));
  console.log('  ' + title);
  console.log('='.repeat(74));
}

export function check(name, cond, detail = '') {
  const pass = Boolean(cond);
  results.push({ name, pass });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

export function warn(name, detail) {
  results.push({ name, pass: null });
  console.log(`⚠️   ${name} — ${detail}`);
}

export function finish(suite) {
  const failed = results.filter((r) => r.pass === false).length;
  const passed = results.filter((r) => r.pass === true).length;
  const skipped = results.filter((r) => r.pass === null).length;
  console.log('\n' + '-'.repeat(74));
  console.log(`  ${suite}: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  if (failed > 0) process.exitCode = 1;
}

// --- cleanup ----------------------------------------------------------------

const cleanups = [];

export function register(fn_) {
  cleanups.push(fn_);
}

export async function runCleanup() {
  for (const fn_ of cleanups.reverse()) {
    try {
      await fn_();
    } catch (e) {
      console.warn(`   cleanup step failed: ${e.message}`);
    }
  }
  cleanups.length = 0;
}
