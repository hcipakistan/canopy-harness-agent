// _msg-intel.cjs — how are WhatsApp messages actually sent/managed? (read-only)
process.loadEnvFile('.env');
const url = process.env.SUPABASE_URL.replace(/\/+$/, '');
const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY };

(async () => {
  // 1. WhatsApp templates available
  const tpl = await (await fetch(url + '/rest/v1/wa_templates?select=key,meta_template_name,language,category,is_approved,is_active&limit=50', { headers })).json();
  console.log('=== WA TEMPLATES (' + tpl.length + ') ===');
  for (const t of tpl) console.log('-', t.key, '|', t.meta_template_name || '-', '|', t.language, '| approved:', t.is_approved, '| active:', t.is_active);

  // 2. wa_messages: how are they created? any template_id usage? delivery tracking?
  const msgs = await (await fetch(url + '/rest/v1/wa_messages?select=template_id,status,wa_message_id,direction,created_at&order=created_at.desc&limit=20', { headers })).json();
  console.log('\n=== RECENT WA_MESSAGES (' + msgs.length + ') — template usage ===');
  let withTpl = 0;
  for (const m of msgs) {
    if (m.template_id) withTpl++;
    console.log('-', m.created_at.slice(0, 19), '|', m.direction, '| status:', m.status, '| template:', m.template_id || '-', '| wa_id:', m.wa_message_id || '-');
  }
  console.log('rows with template_id:', withTpl, '| rows with wa_message_id:', msgs.filter((m) => m.wa_message_id).length);

  // 3. Settings — any WhatsApp/notification config?
  const set = await (await fetch(url + '/rest/v1/settings?select=key,value,description&limit=50', { headers })).json();
  console.log('\n=== SETTINGS (' + set.length + ') ===');
  for (const s of set) console.log('-', s.key, '=', String(s.value).slice(0, 80));

  // 4. Any trigger/notifier hints: check wa_unmatched (messages that arrived with no lead)
  const um = await (await fetch(url + '/rest/v1/wa_unmatched?select=from_number,handled_by,handled_at,created_at&order=created_at.desc&limit=5', { headers })).json();
  console.log('\n=== WA UNMATCHED (last ' + um.length + ') ===');
  for (const u of um) console.log('-', u.created_at.slice(0, 19), '|', u.from_number, '| handled:', u.handled_by || '-');
})();
