// _availability.cjs — compute free 45-min slots for a consultant on a date (READ-ONLY)
// Usage: node _availability.cjs <consultantKey> [YYYY-MM-DD]
//        (no date = next Tuesday demo)
process.loadEnvFile('.env');
const cfg = require('./config/consultants.json');
const url = process.env.SUPABASE_URL.replace(/\/+$/, '');
const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY };
const TZ_OFFSET_MIN = 300; // Pakistan = UTC+5

function pad(n) { return String(n).padStart(2, '0'); }
function localDateStr(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function localISO(d) { return localDateStr(d) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':00+05:00'; }
function parseLocal(ymd, hm) { const [h, m] = hm.split(':').map(Number); const [y, mo, dd] = ymd.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, dd, h - 5, m)); } // local -> UTC
function fmtUTC(d) { return d.toISOString(); }

(async () => {
  const key = process.argv[2] || 'salman';
  const cons = cfg.consultants.find((c) => c.key === key);
  if (!cons) { console.log('❌ unknown consultant:', key, '— pick one of', cfg.consultants.map((c) => c.key).join(', ')); process.exit(1); }

  let date = process.argv[3];
  if (!date) { // next Tuesday
    const t = new Date();
    const daysUntilTue = (2 - t.getUTCDay() + 7) % 7 || 7;
    t.setUTCDate(t.getUTCDate() + daysUntilTue);
    date = localDateStr(t);
  }

  const dow = new Date(date + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const dowKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dow];
  const range = cons.hours[dowKey];
  if (!range) { console.log('ℹ️', cons.name, '— no hours on', date, '(' + dowKey + '). Free slots: none.'); process.exit(0); }
  if (dowKey === 'sat' && cons.alternateSaturdayOff) {
    console.log('⚠️', date, 'is a Saturday — alternate Saturdays are off unless staff_time_off is NOT set. Checked below against staff_time_off.');
  }

  // 1) staff_time_off covering this date
  const off = await (await fetch(url + '/rest/v1/staff_time_off?profile_id=eq.' + cons.profileId + '&starts_on=lte.' + date + '&ends_on=gte.' + date + '&select=starts_on,ends_on,reason', { headers })).json();
  if (off.length > 0) {
    console.log('🚫', cons.name, 'is OFF on', date, '—', off.map((o) => o.reason || o.starts_on + '..' + o.ends_on).join(', '));
    process.exit(0);
  }

  // 2) booked appointments that day
  const dayStart = localISO(new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))));
  const dayEnd = localISO(new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + 1)));
  const booked = await (await fetch(url + '/rest/v1/appointments?consultant_id=eq.' + cons.profileId + '&scheduled_at=gte.' + encodeURIComponent(dayStart) + '&scheduled_at=lt.' + encodeURIComponent(dayEnd) + '&select=scheduled_at,duration_min,status,type,lead_id', { headers })).json();
  const taken = booked.filter((b) => ['scheduled', 'confirmed'].includes(b.status)).map((b) => ({ s: new Date(b.scheduled_at), e: new Date(new Date(b.scheduled_at).getTime() + (b.duration_min || 45) * 60000), b }));

  // 3) build slots — 45-min grid from start, PLUS the exact lastSlotStart if off-grid
  const slot = cfg.slotDurationMin;
  const start = parseLocal(date, range[0]);
  const lastStart = parseLocal(date, cons.lastSlotStart || range[1]);
  const now = new Date();
  const candidates = [];
  for (let t = new Date(start); t <= lastStart; t = new Date(t.getTime() + slot * 60000)) candidates.push(new Date(t));
  if (candidates.length === 0 || candidates[candidates.length - 1].getTime() !== lastStart.getTime()) candidates.push(new Date(lastStart));
  const free = [];
  for (const t of candidates) {
    const end = new Date(t.getTime() + slot * 60000);
    if (t < now) continue; // past
    const clash = taken.some((x) => t < x.e && end > x.s);
    if (!clash) free.push({ start: t, end });
  }

  console.log('\n👨‍⚕️', cons.name, '|', cons.branchCode, '|', date, '(' + dowKey + ')');
  console.log('   hours:', range[0] + '–' + range[1], '| last slot start:', cons.lastSlotStart, '| slot:', slot, 'min');
  console.log('   booked:', booked.length, taken.length > 0 ? '→ blocking: ' + taken.map((x) => x.b.scheduled_at.slice(11, 16) + '-' + x.b.type).join(', ') : '(none)');
  console.log('   FREE SLOTS (' + free.length + '):');
  for (const f of free) {
    const t = new Date(f.start.getTime() + TZ_OFFSET_MIN * 60000);
    console.log('     - ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + ' → ' + pad(new Date(f.end.getTime() + TZ_OFFSET_MIN * 60000).getUTCHours()) + ':' + pad(new Date(f.end.getTime() + TZ_OFFSET_MIN * 60000).getUTCMinutes()) + ' (local PKT)');
  }
})();
