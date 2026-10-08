// _trigger-test.cjs — verify the booking→wa_messages trigger (writes labeled test rows, cleans up)
process.loadEnvFile('.env');
const url = process.env.SUPABASE_URL.replace(/\/+$/, '');
const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY };
const j = { 'Content-Type': 'application/json' };

const TEST_LEAD = 'f2514545-3a83-4d8e-8a9c-879833032170'; // E2E test lead (+920000000001)
const SALMAN = '91cd724d-3776-4221-81f4-c49d07777dc0';
const LHR_12K = 'b9bb3c83-12a7-4653-ae13-9109730a2fc3';
const SLOT = '2026-08-26T05:30:00Z'; // Wed 26 Aug 10:30 AM Lahore (avoid the 25th which may have real bookings)

(async () => {
  // 1. Book
  const r1 = await fetch(url + '/rest/v1/rpc/book_appointment', {
    method: 'POST', headers: { ...headers, ...j },
    body: JSON.stringify({ p_lead_id: TEST_LEAD, p_consultant_id: SALMAN, p_branch_id: LHR_12K, p_scheduled_at: SLOT, p_duration_min: 45, p_notes: 'TRIGGER TEST — safe to delete' }),
  });
  const b1 = await r1.json();
  console.log('1) booking ->', r1.status, r1.ok ? '✅' : '❌ ' + JSON.stringify(b1));
  if (!r1.ok) process.exit(1);
  const apptId = b1.id;

  // 2. Did the trigger create a 'queued' wa_messages row?
  const q = await (await fetch(url + '/rest/v1/wa_messages?lead_id=eq.' + TEST_LEAD + '&status=eq.queued&select=id,direction,to_number,template_id,body,status,created_at&order=created_at.desc&limit=3', { headers })).json();
  const queued = q.find((m) => m.body && m.body.startsWith('consult_confirmed('));
  console.log('2) trigger queued row ->', queued ? '✅ FOUND' : '❌ MISSING');
  if (queued) {
    console.log('   status:', queued.status, '| direction:', queued.direction, '| to:', queued.to_number);
    console.log('   body:', queued.body);
  }

  // 3. Cleanup: delete appointment, notification, queued message; revert lead
  await fetch(url + '/rest/v1/appointments?id=eq.' + apptId, { method: 'DELETE', headers });
  const notif = await (await fetch(url + '/rest/v1/notifications?user_id=eq.' + SALMAN + '&kind=eq.appointment_booked&select=id&order=created_at.desc&limit=1', { headers })).json();
  if (notif[0]) await fetch(url + '/rest/v1/notifications?id=eq.' + notif[0].id, { method: 'DELETE', headers });
  if (queued) await fetch(url + '/rest/v1/wa_messages?id=eq.' + queued.id, { method: 'DELETE', headers });
  await fetch(url + '/rest/v1/leads?id=eq.' + TEST_LEAD, { method: 'PATCH', headers: { ...headers, ...j }, body: JSON.stringify({ stage: 'new' }) });
  console.log('3) cleanup -> appointment, notification, queued row deleted; lead back to new');

  console.log('\n' + (queued ? '🎉 TRIGGER TEST PASSED — every booking now logs a queued confirmation (ready for the sender once the template is approved)' : '⚠️ trigger did not fire — check function/trigger created'));
})();
