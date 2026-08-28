-- ============================================================================
-- Migration 5: Fahrer als eigene Rolle mit Einladungslink
-- ============================================================================
-- Im Supabase SQL-Editor ausführen (nach schema.sql, migration_2, 3, 4).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabelle: Fahrer
-- ----------------------------------------------------------------------------
create table if not exists drivers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  invite_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  revoked      boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table drivers enable row level security;

drop policy if exists "admin full access" on drivers;
create policy "admin full access" on drivers
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

revoke all on drivers from anon;

-- ----------------------------------------------------------------------------
-- Fahrten: Fahrer zuweisen
-- ----------------------------------------------------------------------------
alter table trips add column if not exists driver_id uuid references drivers(id);

-- ----------------------------------------------------------------------------
-- RPC-Funktionen für Fahrer (aufgerufen mit dem anon-Key, über den eigenen
-- Einladungslink /driver/TOKEN)
-- ----------------------------------------------------------------------------

create or replace function fn_driver_info(p_token text)
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
  return json_build_object('driver', json_build_object('id', v_driver.id, 'name', v_driver.name));
end;
$$;

create or replace function fn_driver_list_routes(p_token text)
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

  select coalesce(json_agg(json_build_object('id', id, 'name', name) order by name), '[]'::json)
  into v_routes from routes;

  return json_build_object('routes', v_routes);
end;
$$;

create or replace function fn_driver_list_cars(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_cars json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select coalesce(json_agg(json_build_object('id', id, 'name', name) order by name), '[]'::json)
  into v_cars from cars;

  return json_build_object('cars', v_cars);
end;
$$;

-- Eigene Fahrten auflisten (inkl. Anzahl gebuchter Plätze)
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
    select tr.id, tr.trip_date, tr.start_time, tr.total_seats,
           r.name as route_name, c.name as car_name, c.notes as car_notes,
           coalesce((select sum(b.seats) from bookings b where b.trip_id = tr.id and not b.cancelled), 0) as seats_booked
    from trips tr
    join routes r on r.id = tr.route_id
    left join cars c on c.id = tr.car_id
    where tr.driver_id = v_driver.id
  ) t;

  return json_build_object(
    'driver', json_build_object('id', v_driver.id, 'name', v_driver.name),
    'trips', v_trips
  );
end;
$$;

-- Neue Fahrt als Fahrer veröffentlichen (Fahrer wird automatisch gesetzt)
create or replace function fn_driver_create_trip(
  p_token   text,
  p_route_id uuid,
  p_car_id  uuid,
  p_date    date,
  p_time    time,
  p_seats   int
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver  drivers%rowtype;
  v_trip_id uuid;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if p_seats is null or p_seats < 1 then
    return json_build_object('error', 'invalid_seats');
  end if;
  if p_route_id is null or p_car_id is null or p_date is null or p_time is null then
    return json_build_object('error', 'missing_fields');
  end if;

  insert into trips (route_id, car_id, driver_id, trip_date, start_time, total_seats)
  values (p_route_id, p_car_id, v_driver.id, p_date, p_time, p_seats)
  returning id into v_trip_id;

  return json_build_object('success', true, 'trip_id', v_trip_id);
end;
$$;

-- Eigene Fahrt löschen
create or replace function fn_driver_delete_trip(p_token text, p_trip_id uuid)
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

  delete from trips where id = p_trip_id;
  return json_build_object('success', true);
end;
$$;

-- Buchungen einer eigenen Fahrt ansehen (wer fährt mit)
create or replace function fn_driver_list_trip_bookings(p_token text, p_trip_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_owner  uuid;
  v_result json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select driver_id into v_owner from trips where id = p_trip_id;
  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_trip');
  end if;

  select coalesce(json_agg(b), '[]'::json) into v_result
  from (
    select bk.id, bk.seats, bk.price,
           p.name as person_name,
           fs.name as from_stop, ts.name as to_stop
    from bookings bk
    join people p on p.id = bk.person_id
    join route_stops fs on fs.id = bk.from_stop_id
    join route_stops ts on ts.id = bk.to_stop_id
    where bk.trip_id = p_trip_id and not bk.cancelled
  ) b;

  return json_build_object('bookings', v_result);
end;
$$;

grant execute on function fn_driver_info(text)                                  to anon;
grant execute on function fn_driver_list_routes(text)                           to anon;
grant execute on function fn_driver_list_cars(text)                             to anon;
grant execute on function fn_driver_list_trips(text)                            to anon;
grant execute on function fn_driver_create_trip(text, uuid, uuid, date, time, int) to anon;
grant execute on function fn_driver_delete_trip(text, uuid)                     to anon;
grant execute on function fn_driver_list_trip_bookings(text, uuid)              to anon;
