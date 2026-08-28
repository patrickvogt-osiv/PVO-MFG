-- ============================================================================
-- Migration 3: Adressdetails (PLZ, Stadt, Straße, Hausnummer, Maps-Link) für
-- Streckenpunkte, individueller Gesamtbetrag pro Strecke
-- ============================================================================
-- Im Supabase SQL-Editor ausführen (nach schema.sql und migration_2).
-- Bestehende Daten bleiben erhalten.
-- ============================================================================

alter table routes add column if not exists total_price integer not null default 0;

alter table route_stops add column if not exists postal_code   text;
alter table route_stops add column if not exists street        text;
alter table route_stops add column if not exists house_number  text;
alter table route_stops add column if not exists maps_link     text;

-- ----------------------------------------------------------------------------
-- Funktionen aktualisieren
-- ----------------------------------------------------------------------------

create or replace function fn_get_trip_details(p_token text, p_trip_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person       people%rowtype;
  v_route_id     uuid;
  v_total        int;
  v_car_name     text;
  v_max_order    int;
  v_route_price  int;
  v_stops        json;
  v_usage        json;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select tr.route_id, tr.total_seats, c.name
    into v_route_id, v_total, v_car_name
  from trips tr
  left join cars c on c.id = tr.car_id
  where tr.id = p_trip_id;

  if not found then
    return json_build_object('error', 'trip_not_found');
  end if;

  select total_price into v_route_price from routes where id = v_route_id;
  select max(order_index) into v_max_order from route_stops where route_id = v_route_id;

  select coalesce(json_agg(
           json_build_object(
             'id', id, 'name', name, 'order_index', order_index,
             'postal_code', postal_code, 'street', street,
             'house_number', house_number, 'maps_link', maps_link
           )
           order by order_index
         ), '[]'::json)
  into v_stops
  from route_stops where route_id = v_route_id;

  select coalesce(json_agg(
           json_build_object('order_index', seg.order_index, 'used', seg.seg_used, 'price', seg.price_to_next)
           order by seg.order_index
         ), '[]'::json)
  into v_usage
  from (
    select rs.order_index, rs.price_to_next,
           coalesce(sum(b.seats), 0) as seg_used
    from route_stops rs
    left join bookings b
      on b.trip_id = p_trip_id
      and not b.cancelled
      and b.from_order <= rs.order_index
      and b.to_order > rs.order_index
    where rs.route_id = v_route_id and rs.order_index < v_max_order
    group by rs.order_index, rs.price_to_next
  ) seg;

  return json_build_object(
    'total_seats', v_total,
    'car_name', v_car_name,
    'stops', v_stops,
    'segment_usage', v_usage,
    'route_total_price', v_route_price,
    'max_order', v_max_order
  );
end;
$$;

create or replace function fn_create_booking(
  p_token       text,
  p_trip_id     uuid,
  p_from_stop_id uuid,
  p_to_stop_id  uuid,
  p_seats       int default 1
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person     people%rowtype;
  v_route_id   uuid;
  v_total      int;
  v_from_order int;
  v_to_order   int;
  v_min_order  int;
  v_max_order  int;
  v_max_used   int;
  v_price      int;
  v_route_price int;
  v_booking_id uuid;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if p_seats is null or p_seats < 1 then
    return json_build_object('error', 'invalid_seats');
  end if;

  select route_id, total_seats into v_route_id, v_total from trips where id = p_trip_id;
  if not found then
    return json_build_object('error', 'trip_not_found');
  end if;

  select order_index into v_from_order from route_stops
    where id = p_from_stop_id and route_id = v_route_id;
  select order_index into v_to_order from route_stops
    where id = p_to_stop_id and route_id = v_route_id;

  if v_from_order is null or v_to_order is null or v_from_order >= v_to_order then
    return json_build_object('error', 'invalid_segment');
  end if;

  select coalesce(max(seg_sum), 0) into v_max_used
  from (
    select seg.i, coalesce(sum(b.seats), 0) as seg_sum
    from generate_series(v_from_order, v_to_order - 1) as seg(i)
    left join bookings b
      on b.trip_id = p_trip_id
      and not b.cancelled
      and b.from_order <= seg.i
      and b.to_order > seg.i
    group by seg.i
  ) x;

  if v_max_used + p_seats > v_total then
    return json_build_object('error', 'not_enough_seats', 'available', v_total - v_max_used);
  end if;

  select min(order_index), max(order_index) into v_min_order, v_max_order
  from route_stops where route_id = v_route_id;

  if v_from_order = v_min_order and v_to_order = v_max_order then
    -- Ganze Strecke gebucht: individueller Gesamtbetrag statt Teilstrecken-Summe
    select total_price into v_route_price from routes where id = v_route_id;
    v_price := coalesce(v_route_price, 0);
  else
    select coalesce(sum(price_to_next), 0) into v_price
    from route_stops
    where route_id = v_route_id and order_index >= v_from_order and order_index < v_to_order;
  end if;

  insert into bookings (trip_id, person_id, from_stop_id, to_stop_id, from_order, to_order, seats, price)
  values (p_trip_id, v_person.id, p_from_stop_id, p_to_stop_id, v_from_order, v_to_order, p_seats, v_price * p_seats)
  returning id into v_booking_id;

  return json_build_object('success', true, 'booking_id', v_booking_id, 'price', v_price * p_seats);
end;
$$;

grant execute on function fn_get_trip_details(text, uuid)                to anon;
grant execute on function fn_create_booking(text, uuid, uuid, uuid, int) to anon;
