-- ============================================================
-- book_appointment — UNIFIED version (supersedes the Stage-3 draft).
--
-- Canonical source: C:\Canopy\supabase\migrations\0016_unify_book_appointment.sql
-- This file exists so the harness repo mirrors the live function.
--
-- ONE app-compatible function for both the front-desk app and the
-- WhatsApp agent:
--   book_appointment(p_lead_id, p_branch_id, p_scheduled_at,
--                    p_type appointment_type default 'consultation',
--                    p_duration_min int default 30,
--                    p_consultant_id uuid default null,
--                    p_room_id uuid default null) → jsonb
--   returns { ok, id } or { ok:false, clash:true, error }
-- Sets period via existing trigger, enforces no-double-booking via
-- exclusion constraints (0013), updates the lead stage, and notifies
-- the consultant (best-effort).
-- ============================================================

-- 1) Drop the ad-hoc WhatsApp-agent variant (different signature).
drop function if exists public.book_appointment(uuid, uuid, uuid, timestamptz, int, text, uuid, text, uuid);

-- 2) Unified function
create or replace function public.book_appointment(
  p_lead_id        uuid,
  p_branch_id      uuid,
  p_scheduled_at   timestamptz,
  p_type           appointment_type default 'consultation',
  p_duration_min   int default 30,
  p_consultant_id  uuid default null,
  p_room_id        uuid default null
) returns jsonb
language plpgsql security invoker set search_path = public, app as $$
declare
  new_id uuid;
begin
  begin
    insert into appointments (lead_id, branch_id, consultant_id, room_id, type, scheduled_at, duration_min, created_by)
    values (p_lead_id, p_branch_id, p_consultant_id, p_room_id, p_type, p_scheduled_at, p_duration_min, auth.uid())
    returning id into new_id;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'clash', true,
        'error', 'That slot is already taken for this consultant or room.');
  end;

  update leads
     set stage = case when p_type = 'procedure' then 'procedure_booked' else 'consult_booked' end::lead_stage
   where id = p_lead_id and stage in ('new','contacted','qualified');

  if p_consultant_id is not null then
    begin
      insert into public.notifications (user_id, kind, title, body, link, severity)
      values (
        p_consultant_id,
        'appointment_booked',
        'New online booking',
        format('Consultation booked for %s (%s) on %s, %s min.',
               coalesce((select full_name from public.leads where id = p_lead_id), 'a patient'),
               coalesce((select mobile  from public.leads where id = p_lead_id), 'no number'),
               to_char(p_scheduled_at at time zone 'Asia/Karachi', 'Dy DD Mon YYYY HH24:MI'),
               p_duration_min),
        '/leads/' || p_lead_id,
        'info'
      );
    exception when others then null; -- notification is best-effort
    end;
  end if;

  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

grant execute on function public.book_appointment(uuid, uuid, timestamptz, appointment_type, int, uuid, uuid) to authenticated;
