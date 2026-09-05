-- ============================================================================
-- Migration 39: Suchaufträge speichern zusätzlich das bei der Suche gewählte
-- Datum und die Flexibilität (± Tage), damit sie in der neuen Übersicht
-- angezeigt werden können. Die Treffer-Logik (Benachrichtigung bei neuen
-- Fahrten) bleibt unverändert rein ortsbasiert — Datum/Flexibilität sind
-- hier nur zur Anzeige gedacht.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

alter table search_alerts add column if not exists search_date date;
alter table search_alerts add column if not exists flex_days integer not null default 0;

create or replace function fn_create_search_alert(
  p_token       text,
  p_start_lat   numeric,
  p_start_lon   numeric,
  p_start_label text,
  p_dest_lat    numeric,
  p_dest_lon    numeric,
  p_dest_label  text,
  p_search_date date default null,
  p_flex_days   integer default 0
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person people%rowtype;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if p_start_lat is null or p_start_lon is null or p_dest_lat is null or p_dest_lon is null then
    return json_build_object('error', 'missing_coords');
  end if;

  insert into search_alerts (person_id, start_lat, start_lon, start_label, dest_lat, dest_lon, dest_label, search_date, flex_days)
  values (v_person.id, p_start_lat, p_start_lon, p_start_label, p_dest_lat, p_dest_lon, p_dest_label, p_search_date, coalesce(p_flex_days, 0));

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_create_search_alert(text, numeric, numeric, text, numeric, numeric, text, date, integer) to anon;

create or replace function fn_list_my_search_alerts(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person people%rowtype;
  v_result json;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select coalesce(json_agg(
    json_build_object(
      'id', id, 'start_label', start_label, 'dest_label', dest_label,
      'radius_km', radius_km, 'created_at', created_at,
      'search_date', search_date, 'flex_days', flex_days
    ) order by created_at desc
  ), '[]'::json)
  into v_result
  from search_alerts where person_id = v_person.id;

  return json_build_object('alerts', v_result);
end;
$$;

grant execute on function fn_list_my_search_alerts(text) to anon;
