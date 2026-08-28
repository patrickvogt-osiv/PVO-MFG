-- ============================================================================
-- Migration 17: Umstellung auf EUR als Basis, Fahrer-Zahlungsinfo,
-- Referenzwährung, EUR/100km-Rate, Fahrten schließen/öffnen
-- ============================================================================
-- Im Supabase SQL-Editor ausführen. Alle bisherigen Beträge bleiben als
-- Zahlen unverändert (kein Daten-Update) — es ändert sich nur die Bedeutung
-- der Einheit (jetzt EUR statt CHF) sowie neue Zusatzfelder.
-- ============================================================================

alter table drivers add column if not exists payment_info        text;
alter table drivers add column if not exists reference_currency  text;
alter table drivers add column if not exists rate_eur_per_100km  numeric;

alter table trips add column if not exists closed boolean not null default false;

-- ----------------------------------------------------------------------------
-- Fahrer-Selbstverwaltung: eigenes Profil (Zahlungsinfo, Referenzwährung,
-- Rate) aktualisieren
-- ----------------------------------------------------------------------------
create or replace function fn_driver_update_profile(
  p_token              text,
  p_payment_info       text,
  p_reference_currency text,
  p_rate_eur_per_100km numeric
)
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

  update drivers
  set payment_info       = nullif(trim(p_payment_info), ''),
      reference_currency = nullif(upper(trim(p_reference_currency)), ''),
      rate_eur_per_100km = p_rate_eur_per_100km
  where id = v_driver.id;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_profile(text, text, text, numeric) to anon;

-- Fahrt schließen/öffnen (Fahrer)
create or replace function fn_driver_set_trip_closed(p_token text, p_trip_id uuid, p_closed boolean)
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

  select driver_id into v_owner from trips where id = p_trip_id;
  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_trip');
  end if;

  update trips set closed = p_closed where id = p_trip_id;
  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_set_trip_closed(text, uuid, boolean) to anon;

-- fn_driver_list_trips: Profilfelder und "closed" mit ausliefern
create or replace function fn_driver_list_trips(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_trips  json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select coalesce(json_agg(t order by t.trip_date, t.start_time), '[]'::json) into v_trips
  from (
    select tr.id, tr.trip_date, tr.start_time, tr.total_seats, tr.closed,
           r.name as route_name, c.name as car_name, c.notes as car_notes,
           coalesce((select sum(b.seats) from bookings b where b.trip_id = tr.id and not b.cancelled), 0) as seats_booked
    from trips tr
    join routes r on r.id = tr.route_id
    left join cars c on c.id = tr.car_id
    where tr.driver_id = v_driver.id
  ) t;

  return json_build_object(
    'driver', json_build_object(
      'id', v_driver.id, 'name', v_driver.name,
      'payment_info', v_driver.payment_info,
      'reference_currency', v_driver.reference_currency,
      'rate_eur_per_100km', v_driver.rate_eur_per_100km
    ),
    'trips', v_trips
  );
end;
$$;

grant execute on function fn_driver_list_trips(text) to anon;

-- fn_get_trip_details: Zahlungsinfo des Fahrers + closed-Status mit ausliefern
create or replace function fn_get_trip_details(p_token text, p_trip_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person          people%rowtype;
  v_route_id        uuid;
  v_total           int;
  v_car_name        text;
  v_car_notes       text;
  v_closed          boolean;
  v_driver_payment  text;
  v_max_order       int;
  v_route_price     int;
  v_stops           json;
  v_usage           json;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select tr.route_id, tr.total_seats, c.name, c.notes, tr.closed, d.payment_info
    into v_route_id, v_total, v_car_name, v_car_notes, v_closed, v_driver_payment
  from trips tr
  left join cars c on c.id = tr.car_id
  left join drivers d on d.id = tr.driver_id
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
             'house_number', house_number, 'country', country, 'maps_link', maps_link
           )
           order by order_index
         ), '[]'::json)
  into v_stops
  from route_stops where route_id = v_route_id;

  select coalesce(json_agg(
           json_build_object(
             'order_index', seg.order_index, 'used', seg.seg_used, 'price', seg.price_to_next,
             'distance', seg.distance_to_next_km, 'duration', seg.duration_to_next_min
           )
           order by seg.order_index
         ), '[]'::json)
  into v_usage
  from (
    select rs.order_index, rs.price_to_next, rs.distance_to_next_km, rs.duration_to_next_min,
           coalesce(sum(b.seats), 0) as seg_used
    from route_stops rs
    left join bookings b
      on b.trip_id = p_trip_id
      and not b.cancelled
      and b.from_order <= rs.order_index
      and b.to_order > rs.order_index
    where rs.route_id = v_route_id and rs.order_index < v_max_order
    group by rs.order_index, rs.price_to_next, rs.distance_to_next_km, rs.duration_to_next_min
  ) seg;

  return json_build_object(
    'total_seats', v_total,
    'car_name', v_car_name,
    'car_notes', v_car_notes,
    'closed', v_closed,
    'driver_payment_info', v_driver_payment,
    'stops', v_stops,
    'segment_usage', v_usage,
    'route_total_price', v_route_price,
    'max_order', v_max_order
  );
end;
$$;

grant execute on function fn_get_trip_details(text, uuid) to anon;

-- fn_list_open_trips: "closed"-Status mit ausliefern
create or replace function fn_list_open_trips(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person people%rowtype;
  v_trips  json;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select coalesce(json_agg(t), '[]'::json) into v_trips
  from (
    select tr.id, tr.trip_date, tr.start_time, tr.total_seats, tr.closed,
           r.id as route_id, r.name as route_name,
           c.name as car_name, c.notes as car_notes,
           (
             select string_agg(rs.name, ', ' order by rs.order_index)
             from route_stops rs
             where rs.route_id = tr.route_id
               and rs.order_index > 0
               and rs.order_index < (select max(order_index) from route_stops where route_id = tr.route_id)
           ) as via_stops,
           (
             select coalesce(json_agg(json_build_object('name', rs.name, 'country', rs.country, 'order_index', rs.order_index) order by rs.order_index), '[]'::json)
             from route_stops rs
             where rs.route_id = tr.route_id
           ) as stops,
           (
             select tr.total_seats - coalesce(max(seg_sum), 0)
             from (
               select seg.i, coalesce(sum(b.seats), 0) as seg_sum
               from generate_series(
                 (select min(order_index) from route_stops where route_id = tr.route_id),
                 (select max(order_index) from route_stops where route_id = tr.route_id) - 1
               ) as seg(i)
               left join bookings b
                 on b.trip_id = tr.id
                 and not b.cancelled
                 and b.from_order <= seg.i
                 and b.to_order > seg.i
               group by seg.i
             ) x
           ) as available_seats,
           (
             select coalesce(json_agg(json_build_object('order_index', seg.i, 'used', seg.seg_used) order by seg.i), '[]'::json)
             from (
               select seg.i, coalesce(sum(b.seats), 0) as seg_used
               from generate_series(
                 (select min(order_index) from route_stops where route_id = tr.route_id),
                 (select max(order_index) from route_stops where route_id = tr.route_id) - 1
               ) as seg(i)
               left join bookings b
                 on b.trip_id = tr.id
                 and not b.cancelled
                 and b.from_order <= seg.i
                 and b.to_order > seg.i
               group by seg.i
             ) seg
           ) as segment_usage
    from trips tr
    join routes r on r.id = tr.route_id
    left join cars c on c.id = tr.car_id
    where tr.trip_date >= current_date
    order by tr.trip_date, tr.start_time
  ) t;

  return json_build_object(
    'person', json_build_object('id', v_person.id, 'name', v_person.name),
    'trips', v_trips
  );
end;
$$;

grant execute on function fn_list_open_trips(text) to anon;

-- fn_create_booking: geschlossene Fahrten können nicht mehr gebucht werden
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
  v_person      people%rowtype;
  v_route_id    uuid;
  v_total       int;
  v_closed      boolean;
  v_from_order  int;
  v_to_order    int;
  v_min_order   int;
  v_max_order   int;
  v_max_used    int;
  v_price       int;
  v_route_price int;
  v_booking_id  uuid;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if p_seats is null or p_seats < 1 then
    return json_build_object('error', 'invalid_seats');
  end if;

  select route_id, total_seats, closed into v_route_id, v_total, v_closed from trips where id = p_trip_id;
  if not found then
    return json_build_object('error', 'trip_not_found');
  end if;

  if v_closed then
    return json_build_object('error', 'trip_closed');
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

grant execute on function fn_create_booking(text, uuid, uuid, uuid, int) to anon;
