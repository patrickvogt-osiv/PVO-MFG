-- ============================================================================
-- Migration 26: fn_driver_remove_stop gibt jetzt eine verständliche
-- Fehlermeldung zurück, wenn der Zwischenstopp nicht gelöscht werden kann,
-- weil bereits Buchungen darauf verweisen (Fremdschlüssel-Sperre) — statt
-- die Anfrage einfach fehlschlagen zu lassen.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

create or replace function fn_driver_remove_stop(p_token text, p_stop_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver    drivers%rowtype;
  v_route_id  uuid;
  v_owner     uuid;
  v_order     int;
  v_max_order int;
  r           record;
  v_new_index int := 0;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select rs.route_id, r.driver_id, rs.order_index
    into v_route_id, v_owner, v_order
  from route_stops rs join routes r on r.id = rs.route_id
  where rs.id = p_stop_id;

  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_route');
  end if;

  select max(order_index) into v_max_order from route_stops where route_id = v_route_id;
  if v_order = 0 or v_order = v_max_order then
    return json_build_object('error', 'cannot_remove_endpoint');
  end if;

  begin
    delete from route_stops where id = p_stop_id;
  exception
    when foreign_key_violation then
      return json_build_object('error', 'stop_in_use');
  end;

  for r in select id from route_stops where route_id = v_route_id order by order_index loop
    update route_stops set order_index = v_new_index where id = r.id;
    v_new_index := v_new_index + 1;
  end loop;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_remove_stop(text, uuid) to anon;
