-- ============================================================================
-- Migration 44: Fix für fn_driver_create_reverse_route — price_to_next ist
-- NOT NULL DEFAULT 0, beim letzten Stopp der neuen Reihenfolge gibt es aber
-- keinen "vorherigen" Wert zum Übernehmen. coalesce(..., 0) behebt den
-- NOT-NULL-Constraint-Fehler beim Anlegen der Rückfahrstrecke.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

create or replace function fn_driver_create_reverse_route(p_token text, p_route_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver       drivers%rowtype;
  v_owner        uuid;
  v_name         text;
  v_total_price  int;
  v_new_route_id uuid;
  v_max_order    int;
  v_new_name     text;
  v_sep_pos      int;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select driver_id, name, total_price into v_owner, v_name, v_total_price from routes where id = p_route_id;
  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_route');
  end if;

  select max(order_index) into v_max_order from route_stops where route_id = p_route_id;
  if v_max_order is null or v_max_order < 1 then
    return json_build_object('error', 'route_too_short');
  end if;

  v_sep_pos := position(' - ' in v_name);
  if v_sep_pos > 0 then
    v_new_name := substring(v_name from v_sep_pos + 3) || ' - ' || substring(v_name from 1 for v_sep_pos - 1);
  else
    v_new_name := v_name || ' (Rückfahrt)';
  end if;

  insert into routes (name, total_price, driver_id)
  values (v_new_name, v_total_price, v_driver.id)
  returning id into v_new_route_id;

  insert into route_stops (
    route_id, name, postal_code, street, house_number, country, maps_link,
    order_index, latitude, longitude, price_to_next, distance_to_next_km, duration_to_next_min
  )
  select
    v_new_route_id,
    old.name, old.postal_code, old.street, old.house_number, old.country, old.maps_link,
    (v_max_order - old.order_index),
    old.latitude, old.longitude,
    coalesce(prev.price_to_next, 0), prev.distance_to_next_km, prev.duration_to_next_min
  from route_stops old
  left join route_stops prev on prev.route_id = p_route_id and prev.order_index = old.order_index - 1
  where old.route_id = p_route_id;

  return json_build_object('success', true, 'route_id', v_new_route_id);
end;
$$;

grant execute on function fn_driver_create_reverse_route(text, uuid) to anon;
