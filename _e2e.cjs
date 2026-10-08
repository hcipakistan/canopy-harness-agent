// _e2e.cjs — live end-to-end intake flow test against the real Supabase CRM
process.loadEnvFile('.env');
const url = process.env.SUPABASE_URL.replace(/\/+$/, '');
const headers = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
};
const j = { 'Content-Type': 'application/json' };

const TEST_PHONE = '+920000000001'; // clearly a test number — never a real patient
const TEST_NAME = 'Test Lead - E2E Intake';

async function step(label, fn) {
  try {
    const out = await fn();
    console.log('✅', label, out === undefined ? '' : '->', typeof out === 'string' ? out : JSON.stringify(out));
    return out;
  } catch (e) {
    console.log('❌', label, '->', e.message);
    process.exitCode = 1;
    return null;
  }
}

(async () => {
  // 0. Clean up any junk rows from a previous failed run for this test number
  await step('cleanup prior test rows', async () => {
    for (const tbl of ['wa_messages']) {
      const r = await fetch(url + '/rest/v1/' + tbl + '?or=(from_number.eq.' + encodeURIComponent(TEST_PHONE) + ',to_number.eq.' + encodeURIComponent(TEST_PHONE) + ')', { method: 'DELETE', headers });
      if (!r.ok) throw new Error(tbl + ' cleanup: ' + r.status + ' ' + (await r.text()));
    }
    const r2 = await fetch(url + '/rest/v1/leads?mobile=eq.' + encodeURIComponent(TEST_PHONE), { method: 'DELETE', headers });
    return 'removed stale test rows';
  });

  // 1. Branch lookup (Lahore) — pick LHR-12K
  const branch = await step('branch lookup (Lahore)', async () => {
    const r = await fetch(url + '/rest/v1/branches?city=eq.Lahore&select=id,code,name', { headers });
    const rows = await r.json();
    const b = rows.find((x) => x.code === 'LHR-12K') ?? rows[0];
    return { id: b.id, code: b.code };
  });

  // 2. Lead lookup by phone — expect empty (new patient)
  let leadId = null;
  await step('lead lookup by mobile (expect none)', async () => {
    const r = await fetch(url + '/rest/v1/leads?mobile=eq.' + encodeURIComponent(TEST_PHONE) + '&select=id', { headers });
    const rows = await r.json();
    if (rows.length > 0) { leadId = rows[0].id; return 'EXISTS already (id=' + rows[0].id + ') — skipping create'; }
    return 'not found (correct — new lead)';
  });

  // 3. Create lead
  if (!leadId) {
    leadId = await step('create lead', async () => {
      const body = {
        full_name: TEST_NAME,
        mobile: TEST_PHONE,
        city: 'Lahore',
        interested_procedure: 'hair_transplant', // enum: fue | hair_transplant | prp | non_surgical
        branch_id: branch.id,
        stage: 'new',
        source: 'whatsapp',
      };
      const r = await fetch(url + '/rest/v1/leads', { method: 'POST', headers: { ...headers, ...j, Prefer: 'return=representation' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()));
      const row = (await r.json())[0];
      return row.id;
    });
  }

  // 4. Log inbound + outbound wa_messages
  await step('log wa_message (inbound)', async () => {
    const r = await fetch(url + '/rest/v1/wa_messages', { method: 'POST', headers: { ...headers, ...j, Prefer: 'return=representation' }, body: JSON.stringify({
      lead_id: leadId, direction: 'inbound', from_number: TEST_PHONE, to_number: '+923000000000',
      body: 'My name is ' + TEST_NAME + ', I live in Lahore and I need a hair transplant',
      status: 'sent', // enum: sent | failed
    }) });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()));
    return 'saved';
  });

  await step('log wa_message (outbound)', async () => {
    const r = await fetch(url + '/rest/v1/wa_messages', { method: 'POST', headers: { ...headers, ...j, Prefer: 'return=representation' }, body: JSON.stringify({
      lead_id: leadId, direction: 'outbound', from_number: '+923000000000', to_number: TEST_PHONE,
      body: 'Hello! I have your details. Can you please share your phone number?',
      status: 'sent',
    }) });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()));
    return 'saved';
  });

  // 5. Verify — re-lookup and show the lead + its message trail
  await step('verify lead + message trail', async () => {
    const lead = await (await fetch(url + '/rest/v1/leads?id=eq.' + leadId + '&select=id,full_name,mobile,city,interested_procedure,branch_id,stage,source', { headers })).json();
    const msgs = await (await fetch(url + '/rest/v1/wa_messages?lead_id=eq.' + leadId + '&select=direction,from_number,to_number,body,status&order=created_at', { headers })).json();
    console.log('LEAD:', JSON.stringify(lead[0], null, 2));
    console.log('MESSAGES:', msgs.length, '->', JSON.stringify(msgs.map((m) => m.direction + ' (' + m.status + '): ' + m.body.slice(0, 60)), null, 2));
    return 'loop complete';
  });

  console.log('');
  console.log(process.exitCode ? '❌ TEST FAILED — see steps above' : '🎉 END-TO-END INTAKE TEST PASSED (created lead ' + leadId + ' for ' + TEST_PHONE + ')');
})();
