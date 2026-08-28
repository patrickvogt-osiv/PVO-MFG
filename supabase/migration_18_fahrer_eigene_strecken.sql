-- ============================================================================
-- Migration 18: Fahrer können eigene Strecken (Start/Ziel/Zwischenstopp,
-- Adressen, Mitfahrbeiträge, Distanzen) selbst anlegen und verwalten.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

alter table routes add column if not exists driver_id uuid references drivers(id);

-- ----------------------------------------------------------------------------
-- Eigene Strecken auflisten
-- ----------------------------------------------------------------------------
create or replace function fn_driver_list_own_routes(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_routes json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select coalesce(json_agg(json_build_object('id', id, 'name', name, 'total_price', total_price) order by created_at desc), '[]'::json)
  into v_routes
  from routes where driver_id = v_driver.id;

  return json_build_object('routes', v_routes);
end;
$$;

grant execute on function fn_driver_list_own_routes(text) to anon;

-- ----------------------------------------------------------------------------
-- Details einer eigenen Strecke (alle Stopps)
-- ----------------------------------------------------------------------------
create or replace function fn_driver_get_route_detail(p_token text, p_route_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_route  routes%rowtype;
  v_stops  json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select * into v_route from routes where id = p_route_id and driver_id = v_driver.id;
  if not found then
    return json_build_object('error', 'not_your_route');
  end if;

  select coalesce(json_agg(
           json_build_object(
             'id', id, 'name', name, 'order_index', order_index,
             'postal_code', postal_code, 'street', street, 'house_number', house_number,
             'country', country, 'maps_link', maps_link, 'price_to_next', price_to_next,
             'distance_to_next_km', distance_to_next_km, 'duration_to_next_min', duration_to_next_min
           )
           order by order_index
         ), '[]'::json)
  into v_stops
  from route_stops where route_id = p_route_id;

  return json_build_object(
    'route', json_build_object('id', v_route.id, 'name', v_route.name, 'total_price', v_route.total_price),
    'stops', v_stops
  );
end;
$$;

grant execute on function fn_driver_get_route_detail(text, uuid) to anon;

-- ----------------------------------------------------------------------------
-- Neue eigene Strecke anlegen (inkl. Start- und Zielpunkt)
-- ----------------------------------------------------------------------------
create or replace function fn_driver_create_route(
  p_token       text,
  p_name        text,
  p_total_price integer,
  p_start       json, -- {name, postal_code, street, house_number, country, maps_link}
  p_end         json
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver  drivers%rowtype;
  v_route_id uuid;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_start->>'name'), '') = '' or coalesce(trim(p_end->>'name'), '') = '' then
    return json_build_object('error', 'missing_fields');
  end if;

  insert into routes (name, total_price, driver_id)
  values (trim(p_name), coalesce(p_total_price, 0), v_driver.id)
  returning id into v_route_id;

  insert into route_stops (route_id, order_index, name, postal_code, street, house_number, country, maps_link)
  values
    (v_route_id, 0, trim(p_start->>'name'), nullif(p_start->>'postal_code',''), nullif(p_start->>'street',''), nullif(p_start->>'house_number',''), nullif(p_start->>'country',''), nullif(p_start->>'maps_link','')),
    (v_route_id, 1, trim(p_end->>'name'), nullif(p_end->>'postal_code',''), nullif(p_end->>'street',''), nullif(p_end->>'house_number',''), nullif(p_end->>'country',''), nullif(p_end->>'maps_link',''));

  return json_build_object('success', true, 'route_id', v_route_id);
end;
$$;

grant execute on function fn_driver_create_route(text, text, integer, json, json) to anon;

-- ----------------------------------------------------------------------------
-- Streckenname/Gesamtbetrag aktualisieren
-- ----------------------------------------------------------------------------
create or replace function fn_driver_update_route_meta(p_token text, p_route_id uuid, p_name text, p_total_price integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  update routes set name = trim(p_name), total_price = coalesce(p_total_price, 0)
  where id = p_route_id and driver_id = v_driver.id;

  if not found then
    return json_build_object('error', 'not_your_route');
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_route_meta(text, uuid, text, integer) to anon;

-- ----------------------------------------------------------------------------
-- Eigene Strecke löschen
-- ----------------------------------------------------------------------------
create or replace function fn_driver_delete_route(p_token text, p_route_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  delete from routes where id = p_route_id and driver_id = v_driver.id;
  if not found then
    return json_build_object('error', 'not_your_route');
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_delete_route(text, uuid) to anon;

-- ----------------------------------------------------------------------------
-- Adressfelder eines Stopps aktualisieren
-- ----------------------------------------------------------------------------
create or replace function fn_driver_update_stop(
  p_token        text,
  p_stop_id      uuid,
  p_name         text,
  p_postal_code  text,
  p_street       text,
  p_house_number text,
  p_country      text,
  p_maps_link    text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_owner  uuid;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select r.driver_id into v_owner
  from route_stops rs join routes r on r.id = rs.route_id
  where rs.id = p_stop_id;

  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_route');
  end if;

  update route_stops
  set name = trim(p_name),
      postal_code = nullif(p_postal_code, ''),
      street = nullif(p_street, ''),
      house_number = nullif(p_house_number, ''),
      country = nullif(p_country, ''),
      maps_link = nullif(p_maps_link, '')
  where id = p_stop_id;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_stop(text, uuid, text, text, text, text, text, text) to anon;

-- ----------------------------------------------------------------------------
-- Mitfahrbeitrag eines Stopps (bis zum nächsten) aktualisieren
-- ----------------------------------------------------------------------------
create or replace function fn_driver_update_stop_price(p_token text, p_stop_id uuid, p_price_to_next integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_owner  uuid;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select r.driver_id into v_owner
  from route_stops rs join routes r on r.id = rs.route_id
  where rs.id = p_stop_id;

  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_route');
  end if;

  update route_stops set price_to_next = coalesce(p_price_to_next, 0) where id = p_stop_id;
  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_stop_price(text, uuid, integer) to anon;

-- ----------------------------------------------------------------------------
-- Distanz/Fahrzeit eines Stopps (bis zum nächsten) speichern
-- ----------------------------------------------------------------------------
create or replace function fn_driver_update_stop_distance(p_token text, p_stop_id uuid, p_distance_km numeric, p_duration_min integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_owner  uuid;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select r.driver_id into v_owner
  from route_stops rs join routes r on r.id = rs.route_id
  where rs.id = p_stop_id;

  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_route');
  end if;

  update route_stops set distance_to_next_km = p_distance_km, duration_to_next_min = p_duration_min where id = p_stop_id;
  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_stop_distance(text, uuid, numeric, integer) to anon;

-- ----------------------------------------------------------------------------
-- Neuen Zwischenstopp anlegen (wird direkt vor dem Zielort eingefügt)
-- ----------------------------------------------------------------------------
create or replace function fn_driver_add_stop(
  p_token          text,
  p_route_id       uuid,
  p_name           text,
  p_postal_code    text,
  p_street         text,
  p_house_number   text,
  p_country        text,
  p_maps_link      text,
  p_price_to_prev  integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver     drivers%rowtype;
  v_owner      uuid;
  v_max_order  int;
  v_prev_id    uuid;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select driver_id into v_owner from routes where id = p_route_id;
  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_route');
  end if;

  select max(order_index) into v_max_order from route_stops where route_id = p_route_id;
  if v_max_order is null or v_max_order < 1 then
    return json_build_object('error', 'route_incomplete');
  end if;

  select id into v_prev_id from route_stops where route_id = p_route_id and order_index = v_max_order - 1;

  -- Zielort (bisher letzter Stopp) einen Platz nach hinten schieben
  update route_stops set order_index = v_max_order + 1 where route_id = p_route_id and order_index = v_max_order;

  -- Beitrag für den Abschnitt VOM vorherigen Stopp BIS zum neuen Stopp setzen
  update route_stops set price_to_next = coalesce(p_price_to_prev, 0) where id = v_prev_id;

  insert into route_stops (route_id, order_index, name, postal_code, street, house_number, country, maps_link)
  values (p_route_id, v_max_order, trim(p_name), nullif(p_postal_code,''), nullif(p_street,''), nullif(p_house_number,''), nullif(p_country,''), nullif(p_maps_link,''));

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_add_stop(text, uuid, text, text, text, text, text, text, integer) to anon;

-- ----------------------------------------------------------------------------
-- Zwischenstopp entfernen (Start/Ziel können nicht entfernt werden)
-- ----------------------------------------------------------------------------
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

  delete from route_stops where id = p_stop_id;

  for r in select id from route_stops where route_id = v_route_id order by order_index loop
    update route_stops set order_index = v_new_index where id = r.id;
    v_new_index := v_new_index + 1;
  end loop;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_remove_stop(text, uuid) to anon;

-- ----------------------------------------------------------------------------
-- Zwischenstopp verschieben (Start/Ziel bleiben fix)
-- ----------------------------------------------------------------------------
create or replace function fn_driver_move_stop(p_token text, p_route_id uuid, p_stop_id uuid, p_direction integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver    drivers%rowtype;
  v_owner     uuid;
  v_order     int;
  v_max_order int;
  v_target    int;
  v_target_id uuid;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select driver_id into v_owner from routes where id = p_route_id;
  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_route');
  end if;

  select order_index into v_order from route_stops where id = p_stop_id and route_id = p_route_id;
  select max(order_index) into v_max_order from route_stops where route_id = p_route_id;

  if v_order is null or v_order < 1 or v_order > v_max_order - 1 then
    return json_build_object('error', 'cannot_move_endpoint');
  end if;

  v_target := v_order + p_direction;
  if v_target < 1 or v_target > v_max_order - 1 then
    return json_build_object('success', true); -- am Rand, nichts zu tun
  end if;

  select id into v_target_id from route_stops where route_id = p_route_id and order_index = v_target;

  update route_stops set order_index = v_target where id = p_stop_id;
  update route_stops set order_index = v_order where id = v_target_id;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_move_stop(text, uuid, uuid, integer) to anon;
