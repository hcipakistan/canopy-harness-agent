// komal-run.mjs — L4 suite for the Komal AI assistant.
//
// Three phases:
//   1. Config ↔ DB consistency   — config/branches.json codes/cities exist in Supabase
//   2. Rules contract            — route() from rules.mjs matches the hand-computed
//                                  expectations in each scenario (pure, no writes)
//   3. CRM simulation            — performs the intake / follow-up / booking writes
//                                  exactly as the patient-intake skill instructs and
//                                  asserts the side effects against staging
//   4. Transcripts               — prints the live-agent dialogues for manual runs
//
// Run from the agent workspace root:
//   node tests/komal/komal-run.mjs     (or: npm run test:komal)

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route, storeProcedure } from './rules.mjs';
import {
  env, section, check, warn, finish, runCleanup, register,
  selectRows, insertRow, deleteRows, rpc, testPhone,
  createTestUser, deleteTestUser,
} from './komal-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scenariosDir = join(here, 'scenarios');
const root = join(here, '..', '..');

const branchByCode = async (code) => {
  const r = await selectRows('branches', `select=id,code,city&code=eq.${code}`);
  return r.body?.[0] ?? null;
};

async function simulateIntake(scn, c) {
  const phone = testPhone(c.phone_suffix);
  const got = route(c.city, c.procedure, c.phone_suffix);

  if (!c.city) {
    // Missing-data case: lead created without city — no routing yet.
    const lead = await insertRow('leads', {
      full_name: c.full_name ?? scn.followup?.full_name ?? 'E2E Lead',
      mobile: phone,
      city: null,
      interested_procedure: storeProcedure(c.procedure),
      stage: 'new',
      source: 'whatsapp',
    });
    check(`${scn.id}: lead created without city (missing-data)`, lead.ok, `${lead.status}`);
    if (lead.body?.[0]?.id) register(() => deleteRows('leads', `id=eq.${lead.body[0].id}`));
    return null;
  }

  const branch = await branchByCode(got.branchCode);
  if (!branch) {
    warn(`${scn.id}: ${c.city}`, `branch ${got.branchCode} not in DB — check migrations/seed`);
    return null;
  }

  // 1. Lookup by phone first (dedup — never create a second record).
  const existing = await selectRows('leads', `select=id&mobile=eq.${encodeURIComponent(phone)}`);
  check(`${scn.id}: lead lookup by mobile before create`, existing.ok);

  // 2. Create the lead with the routed branch, as the intake skill instructs.
  const body = {
    full_name: c.full_name ?? `E2E ${c.city} ${c.procedure}`,
    mobile: phone,
    city: c.city,
    interested_procedure: storeProcedure(c.procedure),
    branch_id: branch.id,
    stage: 'new',
    source: 'whatsapp',
  };
  let created = await insertRow('leads', body);
  if (!created.ok && /invalid input value for enum/.test(created.text ?? '')) {
    // Staging is migration-only; 'hair_transplant'/'non_surgical' exist only via
    // live-DB drift. Fall back to a migration-safe value and say so.
    warn(`${scn.id}: enum drift — ${created.text?.slice(0, 100)}`, `storing 'other' instead of '${storeProcedure(c.procedure)}'`);
    created = await insertRow('leads', { ...body, interested_procedure: 'other' });
  }
  check(`${scn.id}: lead created (${c.city}, ${c.procedure})`, created.ok, `${created.status}`);
  const lead = created.body?.[0];
  if (!lead) return null;
  register(() => deleteRows('leads', `id=eq.${lead.id}`));

  // 3. Routed to the branch the documented rule says.
  check(`${scn.id}: lead routed to ${got.branchCode}`, lead.branch_id === branch.id,
    `branch=${got.branchCode} (${got.reason})`);
  check(`${scn.id}: source=whatsapp, stage=new`, lead.source === 'whatsapp' && lead.stage === 'new');

  // 4. Message log: the patient's first line in, Komal's greeting out.
  const firstLine = scn.live_conversation?.[0]?.replace(/^Patient:\s*/, '') ?? 'Hello, I would like a consultation';
  const inbound = await insertRow('wa_messages', {
    lead_id: lead.id, direction: 'inbound', from_number: phone, to_number: '+923000000000',
    body: firstLine, status: 'sent',
  });
  const outbound = await insertRow('wa_messages', {
    lead_id: lead.id, direction: 'outbound', from_number: '+923000000000', to_number: phone,
    body: `greeting(${c.city})`, status: 'sent',
  });
  check(`${scn.id}: inbound + outbound wa_messages logged`, inbound.ok && outbound.ok);
  if (inbound.body?.[0]?.id) register(() => deleteRows('wa_messages', `id=eq.${inbound.body[0].id}`));
  if (outbound.body?.[0]?.id) register(() => deleteRows('wa_messages', `id=eq.${outbound.body[0].id}`));

  return lead;
}

async function simulateFollowup(scn) {
  const f = scn.followup;
  const phone = testPhone(f.phone_suffix);
  const lead = await insertRow('leads', {
    full_name: f.full_name, mobile: phone, city: null,
    interested_procedure: 'fue', stage: 'new', source: 'whatsapp',
  });
  check(`${scn.id}: follow-up lead created`, lead.ok, `${lead.status}`);
  const leadId = lead.body?.[0]?.id;
  if (leadId) register(() => deleteRows('leads', `id=eq.${leadId}`));
  if (!leadId) return;

  // The missing-data-handler sends ONE gentle follow-up after 24h.
  const msg = await insertRow('wa_messages', {
    lead_id: leadId, direction: 'outbound', from_number: '+923000000000', to_number: phone,
    body: 'follow-up(24h): which city should I arrange your consultation in?', status: 'sent',
  });
  check(`${scn.id}: 24h follow-up logged as outbound`, msg.ok, `${msg.status}`);
  if (msg.body?.[0]?.id) register(() => deleteRows('wa_messages', `id=eq.${msg.body[0].id}`));

  const stage = (await selectRows('leads', `select=stage,city&id=eq.${leadId}`)).body?.[0];
  check(`${scn.id}: lead still new, city still missing`, stage?.stage === 'new' && !stage?.city);
}

async function simulateBooking(scn, lead) {
  const c = scn.routing_cases[0];
  const got = route(c.city, c.procedure, c.phone_suffix);
  const branch = await branchByCode(got.branchCode);
  if (!branch || !lead) {
    warn(`${scn.id}: booking skipped`, `branch=${got.branchCode}, lead=${Boolean(lead)}`);
    return;
  }

  // A consultant at the routed branch (staging seeds none).
  let consultant = null;
  try {
    consultant = await createTestUser({ role: 'consultant', branchId: branch.id, isCentral: false, fullName: 'E2E Komal Consultant' });
    register(() => deleteTestUser(consultant.userId));
  } catch (e) {
    warn(`${scn.id}: booking skipped`, `no consultant: ${e.message}`);
    return;
  }

  const slot = new Date(Date.now() + 7 * 86400000);
  slot.setUTCHours(5, 30, 0, 0); // 10:30 PKT
  const args = {
    p_lead_id: lead.id, p_branch_id: branch.id, p_scheduled_at: slot.toISOString(),
    p_type: 'consultation', p_duration_min: 45, p_consultant_id: consultant.profileId, p_room_id: null,
  };

  const b1 = await rpc('book_appointment', args);
  check(`${scn.id}: booking succeeds`, b1.ok && b1.body?.ok === true, JSON.stringify(b1.body));
  const apptId = b1.body?.id;
  if (apptId) register(() => deleteRows('appointments', `id=eq.${apptId}`));

  const stage = (await selectRows('leads', `select=stage&id=eq.${lead.id}`)).body?.[0]?.stage;
  check(`${scn.id}: lead advanced to consult_booked`, stage === 'consult_booked', `stage=${stage}`);

  const notif = await selectRows('notifications', `select=id&user_id=eq.${consultant.profileId}&kind=eq.appointment_booked&limit=1`);
  check(`${scn.id}: consultant notified`, (notif.body?.length ?? 0) >= 1);
  if (notif.body?.[0]) register(() => deleteRows('notifications', `id=eq.${notif.body[0].id}`));

  const b2 = await rpc('book_appointment', args);
  check(`${scn.id}: duplicate booking blocked (clash)`, b2.ok && b2.body?.ok === false && b2.body?.clash === true,
    JSON.stringify(b2.body));
}

(async () => {
  section(`L4 · Komal — ${env.url} (staging recommended)`);

  // --- 1. Config ↔ DB consistency -------------------------------------------
  const cfg = JSON.parse(readFileSync(join(root, 'config', 'branches.json'), 'utf8')).branches;
  section('1 · config/branches.json ↔ branches table');
  for (const b of cfg) {
    const row = await branchByCode(b.id);
    check(`branch ${b.id} exists in DB`, Boolean(row), row ? row.city : 'missing');
    if (row) check(`branch ${b.id} city matches config`, row.city === b.city, `${row.city} vs ${b.city}`);
  }

  // --- 2. Rules contract -----------------------------------------------------
  const files = readdirSync(scenariosDir).filter((f) => f.endsWith('.json')).sort();
  section('2 · Routing rules (contract)');
  for (const f of files) {
    const scn = JSON.parse(readFileSync(join(scenariosDir, f), 'utf8'));
    for (const c of scn.routing_cases ?? []) {
      const got = route(c.city, c.procedure, c.phone_suffix);
      check(`[${scn.id}] ${c.city || '(no city)'} ${c.procedure} (${c.phone_suffix}) → ${c.expected_branch_code ?? 'none'}`,
        got.branchCode === c.expected_branch_code, `${got.branchCode} — ${got.reason}`);
    }
  }

  // --- 3. CRM simulation -----------------------------------------------------
  section('3 · CRM side effects (intake → routing → messages → booking)');
  for (const f of files) {
    const scn = JSON.parse(readFileSync(join(scenariosDir, f), 'utf8'));
    if (!scn.simulate_crm) continue;
    const leads = [];
    for (const c of scn.routing_cases ?? []) leads.push(await simulateIntake(scn, c));
    if (scn.followup) await simulateFollowup(scn);
    if (scn.booking) await simulateBooking(scn, leads[0]);
  }

  // --- 4. Live-agent transcripts ---------------------------------------------
  section('4 · Live-agent transcripts (paste into the Komal chat to verify manually)');
  for (const f of files) {
    const scn = JSON.parse(readFileSync(join(scenariosDir, f), 'utf8'));
    console.log(`\n— ${scn.id}: ${scn.title} (${scn.channel}, ${scn.language})`);
    for (const line of scn.live_conversation ?? []) console.log('   ' + line);
  }

  finish('L4 · Komal');
  await runCleanup();
})();
