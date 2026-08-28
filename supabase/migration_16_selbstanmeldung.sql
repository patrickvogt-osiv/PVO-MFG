-- ============================================================================
-- Migration 16: Selbstanmeldung (ohne Einladungslink) für Mitfahrer und
-- Fahrer. Neue Anmeldungen werden gesperrt angelegt (revoked = true) und
-- müssen vom Admin wie gewohnt über "Zugang wiederherstellen" freigeschaltet
-- werden.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

alter table people  add column if not exists phone text;
alter table people  add column if not exists email text;
alter table drivers add column if not exists phone text;
alter table drivers add column if not exists email text;

create or replace function fn_signup_request(
  p_role       text,   -- 'mitfahrer' oder 'fahrer'
  p_first_name text,
  p_last_name  text,
  p_phone      text,
  p_email      text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_token text;
  v_id    uuid;
begin
  v_name := trim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, ''));
  if v_name = '' then
    return json_build_object('error', 'missing_name');
  end if;
  if p_role not in ('mitfahrer', 'fahrer') then
    return json_build_object('error', 'invalid_role');
  end if;

  if p_role = 'mitfahrer' then
    insert into people (name, phone, email, revoked)
    values (v_name, nullif(trim(p_phone), ''), nullif(trim(p_email), ''), true)
    returning id, invite_token into v_id, v_token;
  else
    insert into drivers (name, phone, email, revoked)
    values (v_name, nullif(trim(p_phone), ''), nullif(trim(p_email), ''), true)
    returning id, invite_token into v_id, v_token;
  end if;

  return json_build_object('success', true, 'id', v_id, 'token', v_token, 'role', p_role);
end;
$$;

grant execute on function fn_signup_request(text, text, text, text, text) to anon;
