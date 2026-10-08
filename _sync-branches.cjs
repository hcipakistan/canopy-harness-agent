// _sync-branches.cjs — sync specialties + non_surgical_hub + surgical_share + prp_share
// into the live branches table. Run only after the columns exist (see SQL in chat):
//   alter table public.branches
//     add column if not exists specialties text[] not null default '{}',
//     add column if not exists non_surgical_hub boolean not null default false,
//     add column if not exists surgical_share numeric not null default 0,
//     add column if not exists prp_share numeric not null default 0;
process.loadEnvFile('.env');
const branches = require('./config/branches.json').branches;
const url = process.env.SUPABASE_URL.replace(/\/+$/, '');
const headers = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
};
const j = { 'Content-Type': 'application/json' };

(async () => {
  // 1. Verify the columns exist before touching anything
  const probe = await fetch(url + '/rest/v1/branches?select=specialties,non_surgical_hub,surgical_share,prp_share&limit=1', { headers });
  if (!probe.ok) {
    console.log('❌ Columns not present yet. Run this SQL in Supabase Dashboard → SQL Editor first:');
    console.log('   alter table public.branches');
    console.log("     add column if not exists specialties text[] not null default '{}',");
    console.log('     add column if not exists non_surgical_hub boolean not null default false,');
    console.log('     add column if not exists surgical_share numeric not null default 0,');
    console.log('     add column if not exists prp_share numeric not null default 0;');
    process.exit(1);
  }

  // 2. PATCH each branch by its code
  let ok = 0;
  for (const b of branches) {
    const body = {
      specialties: b.specialties,
      non_surgical_hub: b.nonSurgicalHub,
      surgical_share: b.surgicalShare ?? 0,
    };
    if (b.prpShare !== undefined) body.prp_share = b.prpShare;
    const r = await fetch(url + '/rest/v1/branches?code=eq.' + b.id, {
      method: 'PATCH',
      headers: { ...headers, ...j, Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      ok++;
      console.log('✅', b.id, '| surg', body.surgical_share, '| prp', body.prp_share ?? '-', '| hub', body.non_surgical_hub);
    } else console.log('❌', b.id, '->', r.status, await r.text());
  }
  console.log(ok === branches.length ? '🎉 All ' + ok + ' branches synced.' : '⚠️ ' + ok + '/' + branches.length + ' synced.');
})();
