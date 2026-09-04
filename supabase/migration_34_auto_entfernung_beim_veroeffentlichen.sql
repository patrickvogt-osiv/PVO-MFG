-- ============================================================================
-- Migration 34: Wenn ein Fahrer eine Fahrt veröffentlicht und für die
-- gewählte Strecke noch keine Entfernungen berechnet wurden, geschieht das
-- jetzt automatisch beim Veröffentlichen — unabhängig davon, ob die Strecke
-- dem Fahrer selbst gehört oder von jemand anderem (Admin/anderer Fahrer)
-- angelegt wurde. Dafür zwei neue, bewusst eng begrenzte Funktionen:
-- Lesen der Stopp-Adressen jeder Strecke (nicht nur eigener), und Speichern
-- der berechneten Koordinaten/Entfernungen/Standardpreise für jede Strecke
-- (aber KEINE anderen Änderungen wie Name, Adresse oder Reihenfolge).
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fahrer: Stopp-Details einer BELIEBIGEN Strecke lesen (für die
-- Entfernungsberechnung beim Veröffentlichen nötig — Geocoding läuft im
-- Frontend, dafür werden die Adressfelder gebraucht)
-- ----------------------------------------------------------------------------
create or replace function fn_driver_get_route_stops_for_publish(p_token text, p_route_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_stops  json;
  v_total_price int;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select total_price into v_total_price from routes where id = p_route_id;
  if not found then
    return json_build_object('error', 'route_not_found');
  end if;

  select coalesce(json_agg(
    json_build_object(
      'id', id, 'name', name, 'order_index', order_index,
      'postal_code', postal_code, 'street', street, 'house_number', house_number, 'country', country,
      'latitude', latitude, 'longitude', longitude,
      'distance_to_next_km', distance_to_next_km, 'price_to_next', price_to_next
    ) order by order_index
  ), '[]'::json)
  into v_stops
  from route_stops where route_id = p_route_id;

  return json_build_object('stops', v_stops, 'total_price', v_total_price);
end;
$$;

grant execute on function fn_driver_get_route_stops_for_publish(text, uuid) to anon;

-- ----------------------------------------------------------------------------
-- Fahrer: berechnete Koordinaten/Entfernungen/Standardpreise für eine
-- BELIEBIGE Strecke speichern (kein Ownership-Check — bewusst nur für diesen
-- engen Zweck, keine sonstigen Änderungen an der Strecke möglich)
-- ----------------------------------------------------------------------------
create or replace function fn_driver_save_computed_distances(
  p_token           text,
  p_route_id        uuid,
  p_stops           jsonb,
  p_new_total_price integer default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_stop   jsonb;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if not exists (select 1 from routes where id = p_route_id) then
    return json_build_object('error', 'route_not_found');
  end if;

  for v_stop in select * from jsonb_array_elements(p_stops)
  loop
    update route_stops
    set latitude             = coalesce((v_stop->>'latitude')::numeric, latitude),
        longitude            = coalesce((v_stop->>'longitude')::numeric, longitude),
        distance_to_next_km  = case when v_stop ? 'distance_to_next_km' then (v_stop->>'distance_to_next_km')::numeric else distance_to_next_km end,
        duration_to_next_min = case when v_stop ? 'duration_to_next_min' then (v_stop->>'duration_to_next_min')::integer else duration_to_next_min end,
        price_to_next        = case when v_stop ? 'price_to_next' then (v_stop->>'price_to_next')::integer else price_to_next end
    where id = (v_stop->>'id')::uuid and route_id = p_route_id;
  end loop;

  if p_new_total_price is not null then
    update routes set total_price = p_new_total_price where id = p_route_id and coalesce(total_price, 0) = 0;
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_save_computed_distances(text, uuid, jsonb, integer) to anon;
