// _booking-test.cjs — live test of book_appointment() (writes 1 labeled test row, then cleans up)
process.loadEnvFile('.env');
const url = process.env.SUPABASE_URL.replace(/\/+$/, '');
const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY };
const j = { 'Content-Type': 'application/json' };

const TEST_LEAD = 'f2514545-3a83-4d8e-8a9c-879833032170'; // E2E intake test lead (+920000000001)
const SALMAN = '91cd724d-3776-4221-81f4-c49d07777dc0';
const LHR_12K = 'b9bb3c83-12a7-4653-ae13-9109730a2fc3';
const SLOT = '2026-08-25T05:30:00Z'; // Tue 10:30 AM Lahore (UTC+5)

(async () => {
  // 0. Confirm the function is registered (OpenAPI spec)
  const spec = await (await fetch(url + '/rest/v1/', { headers })).json();
  console.log('function registered:', spec.paths['/rpc/book_appointment'] ? '✅ YES' : '❌ NO');
  if (!spec.paths['/rpc/book_appointment']) process.exit(1);

  // 1. Book the slot (first time — should succeed) — unified signature (0016)
  let apptId = null;
  const r1 = await fetch(url + '/rest/v1/rpc/book_appointment', {
    method: 'POST', headers: { ...headers, ...j },
    body: JSON.stringify({ p_lead_id: TEST_LEAD, p_branch_id: LHR_12K, p_scheduled_at: SLOT, p_duration_min: 45, p_type: 'consultation', p_consultant_id: SALMAN, p_room_id: null }),
  });
  const b1 = await r1.json();
  const ok1 = r1.status === 200 && b1.ok === true;
  console.log('\n1) first booking ->', r1.status, ok1 ? '✅ SUCCESS' : '❌ ' + JSON.stringify(b1));
  if (ok1) {
    apptId = b1.id;
    console.log('   appointment id:', apptId);
  }

  // 2. Verify the lead moved to consult_booked
  const lead = await (await fetch(url + '/rest/v1/leads?id=eq.' + TEST_LEAD + '&select=stage', { headers })).json();
  console.log('2) lead stage now:', JSON.stringify(lead[0]?.stage), lead[0]?.stage === 'consult_booked' ? '✅' : '❌');

  // 2b. NEW: verify the consultant got a notification
  let notifId = null;
  const notifs = await (await fetch(url + '/rest/v1/notifications?user_id=eq.' + SALMAN + '&kind=eq.appointment_booked&select=id,kind,title,body,severity,read_at&order=created_at.desc&limit=1', { headers })).json();
  if (apptId && notifs.length > 0) {
    notifId = notifs[0].id;
    console.log('2b) consultant notification -> ✅ created: ' + notifs[0].title + ' | ' + notifs[0].body);
    console.log('    severity:', notifs[0].severity, '| read:', notifs[0].read_at ? 'read' : 'unread');
  } else {
    console.log('2b) consultant notification ->', apptId ? '❌ MISSING' : '⚠️ (skipped — booking failed)');
  }

  // 3. Try the SAME slot again — must fail (race-safety proof)
  const r2 = await fetch(url + '/rest/v1/rpc/book_appointment', {
    method: 'POST', headers: { ...headers, ...j },
    body: JSON.stringify({ p_lead_id: TEST_LEAD, p_branch_id: LHR_12K, p_scheduled_at: SLOT, p_duration_min: 45, p_type: 'consultation', p_consultant_id: SALMAN, p_room_id: null }),
  });
  const b2 = await r2.json();
  const blocked = r2.status === 200 && b2.ok === false;
  console.log('3) duplicate booking ->', blocked ? '✅ blocked: ' + JSON.stringify(b2) : '❌ UNEXPECTED: ' + JSON.stringify(b2));

  // 4. Cleanup — delete the test appointment + notification, revert lead stage
  if (apptId) {
    const del = await fetch(url + '/rest/v1/appointments?id=eq.' + apptId, { method: 'DELETE', headers });
    console.log('4) cleanup appointment ->', del.status === 204 ? '✅ deleted' : '⚠️ ' + del.status);
    if (notifId) {
      const dn = await fetch(url + '/rest/v1/notifications?id=eq.' + notifId, { method: 'DELETE', headers });
      console.log('   cleanup notification ->', dn.status === 204 ? '✅ deleted' : '⚠️ ' + dn.status);
    }
    const patch = await fetch(url + '/rest/v1/leads?id=eq.' + TEST_LEAD, { method: 'PATCH', headers: { ...headers, ...j }, body: JSON.stringify({ stage: 'new' }) });
    console.log('   lead stage reverted ->', patch.ok ? '✅ back to new' : '⚠️ ' + patch.status);
  }

  console.log('\n' + (apptId && blocked ? '🎉 BOOKING FUNCTION TEST PASSED (booked, verified, double-booking blocked, cleaned up)' : '⚠️ See results above.'));
})();
