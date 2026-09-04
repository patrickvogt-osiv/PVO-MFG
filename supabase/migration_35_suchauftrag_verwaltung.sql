-- ============================================================================
-- Migration 35: Mitfahrer können ihre gespeicherten Suchaufträge
-- ("Informiere mich, wenn neue Fahrten eingestellt werden") einsehen und
-- löschen.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

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
      'radius_km', radius_km, 'created_at', created_at
    ) order by created_at desc
  ), '[]'::json)
  into v_result
  from search_alerts where person_id = v_person.id;

  return json_build_object('alerts', v_result);
end;
$$;

grant execute on function fn_list_my_search_alerts(text) to anon;

create or replace function fn_delete_search_alert(p_token text, p_alert_id uuid)
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

  delete from search_alerts where id = p_alert_id and person_id = v_person.id;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_delete_search_alert(text, uuid) to anon;
