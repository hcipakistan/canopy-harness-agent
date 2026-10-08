-- ============================================================
-- A) Booking → wa_messages confirmation trigger (for MANUAL bookings)
-- ADDITIVE ONLY: 1 new enum value + 1 new function + 1 new trigger.
-- No changes to existing tables/rows.
-- Effect: EVERY new appointment (manual OR agent) logs an outbound
-- confirmation row (template consult_confirmed, status 'queued') so a
-- sender/app can pick it up and deliver it once the template is approved.
-- Rollback:  drop trigger trg_appointment_confirmation on public.appointments;
--            drop function public.notify_booking_confirmation();
--            (optionally) alter type public.wa_status drop value 'queued';  -- only if unused
-- ============================================================

-- Step 1: add a 'queued' status to the wa_status enum.
-- NOTE: if the SQL editor runs everything in ONE transaction and complains
-- "unsafe use of new value 'queued'", run THIS statement alone first, then
-- run steps 2–3.
alter type public.wa_status add value if not exists 'queued';

-- Step 2: the trigger function
create or replace function public.notify_booking_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tpl_id  uuid;
  v_mobile  text;
  v_name    text;
  v_body    text;
begin
  -- Only care about booked (scheduled) appointments
  if new.status is distinct from 'scheduled' then
    return new;
  end if;

  -- Find the active consult_confirmed template
  select id into v_tpl_id
    from public.wa_templates
   where key = 'consult_confirmed' and is_active
   limit 1;
  if v_tpl_id is null then
    return new; -- template not set up yet — skip quietly
  end if;

  -- Patient details from the lead
  select mobile, full_name into v_mobile, v_name
    from public.leads where id = new.lead_id;
  if v_mobile is null then
    return new; -- no mobile — nothing to message
  end if;

  v_body := format(
    'consult_confirmed(%s, %s)',
    coalesce(v_name, 'patient'),
    to_char(new.scheduled_at at time zone 'Asia/Karachi', 'Dy DD Mon YYYY HH24:MI')
  );

  insert into public.wa_messages
    (lead_id, direction, from_number, to_number, template_id, body, status)
  values
    (new.lead_id, 'outbound', null, v_mobile, v_tpl_id, v_body, 'queued');

  return new;
end;
$$;

-- Step 3: fire on every new appointment
create trigger trg_appointment_confirmation
after insert on public.appointments
for each row execute function public.notify_booking_confirmation();
