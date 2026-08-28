-- ============================================================================
-- Migration 2: Autos, Mitfahrbeitrag pro Streckenabschnitt
-- ============================================================================
-- Im Supabase SQL-Editor ausführen (nachdem schema.sql bereits einmal
-- ausgeführt wurde). Bestehende Daten (Strecken, Fahrten, Buchungen) bleiben
-- erhalten.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Neue Tabelle: Autos
-- ----------------------------------------------------------------------------
create table if not exists cars (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  notes      text,
  created_at timestamptz not null default now()
);

alter table cars enable row level security;

drop policy if exists "admin full access" on cars;
create policy "admin full access" on cars
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

revoke all on cars from anon;

-- ----------------------------------------------------------------------------
-- Fahrten: Auto zuweisen
-- ----------------------------------------------------------------------------
alter table trips add column if not exists car_id uuid references cars(id);

-- ----------------------------------------------------------------------------
-- Zwischenstopps: Mitfahrbeitrag (Preis bis zum jeweils nächsten Stopp)
-- ----------------------------------------------------------------------------
alter table route_stops add column if not exists price_to_next integer not null default 0;

-- ----------------------------------------------------------------------------
-- Buchungen: Beitrag zum Buchungszeitpunkt festhalten
-- ----------------------------------------------------------------------------
alter table bookings add column if not exists price integer not null default 0;

-- ----------------------------------------------------------------------------
-- Funktionen aktualisieren
-- ----------------------------------------------------------------------------

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
    select tr.id, tr.trip_date, tr.start_time, tr.total_seats,
           r.id as route_id, r.name as route_name,
           c.name as car_name
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

create or replace function fn_get_trip_details(p_token text, p_trip_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person     people%rowtype;
  v_route_id   uuid;
  v_total      int;
  v_car_name   text;
  v_max_order  int;
  v_stops      json;
  v_usage      json;
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

  select max(order_index) into v_max_order from route_stops where route_id = v_route_id;

  select coalesce(json_agg(
           json_build_object('id', id, 'name', name, 'order_index', order_index)
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
    'segment_usage', v_usage
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
  v_max_used   int;
  v_price      int;
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

  select coalesce(sum(price_to_next), 0) into v_price
  from route_stops
  where route_id = v_route_id and order_index >= v_from_order and order_index < v_to_order;

  insert into bookings (trip_id, person_id, from_stop_id, to_stop_id, from_order, to_order, seats, price)
  values (p_trip_id, v_person.id, p_from_stop_id, p_to_stop_id, v_from_order, v_to_order, p_seats, v_price * p_seats)
  returning id into v_booking_id;

  return json_build_object('success', true, 'booking_id', v_booking_id, 'price', v_price * p_seats);
end;
$$;

create or replace function fn_list_my_bookings(p_token text)
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

  select coalesce(json_agg(b order by trip_date, start_time), '[]'::json) into v_result
  from (
    select bk.id, bk.seats, bk.price, bk.created_at,
           tr.id as trip_id, tr.trip_date, tr.start_time,
           r.name as route_name,
           fs.name as from_stop, ts.name as to_stop
    from bookings bk
    join trips tr on tr.id = bk.trip_id
    join routes r on r.id = tr.route_id
    join route_stops fs on fs.id = bk.from_stop_id
    join route_stops ts on ts.id = bk.to_stop_id
    where bk.person_id = v_person.id and not bk.cancelled
  ) b;

  return json_build_object('bookings', v_result);
end;
$$;

grant execute on function fn_list_open_trips(text)                       to anon;
grant execute on function fn_get_trip_details(text, uuid)                to anon;
grant execute on function fn_create_booking(text, uuid, uuid, uuid, int) to anon;
grant execute on function fn_list_my_bookings(text)                      to anon;
