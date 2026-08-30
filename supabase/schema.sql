-- ============================================================================
-- Fahrt-Buchung: Datenbankschema für Supabase (Postgres)
-- ============================================================================
-- Diese Datei komplett im Supabase SQL-Editor ausführen (Dashboard -> SQL Editor
-- -> New query -> Inhalt einfügen -> Run).
--
-- Hinweis: Falls du schema.sql schon einmal ausgeführt hattest und nur die
-- neuen Funktionen (Autos, Mitfahrbeitrag) nachrüsten willst, nutze stattdessen
-- migration_2_autos_und_beitrag.sql.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Tabellen
-- ----------------------------------------------------------------------------

-- Eingeladene Mitfahrer. Der invite_token ist das "Ticket" für den Zugang -
-- wer den Link mit diesem Token hat, kann buchen.
create table people (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text,
  email        text,
  invite_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  revoked      boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Fahrer: eigene Rolle mit eigenem Einladungslink. Sehen und verwalten nur
-- ihre eigenen Fahrten und Autos.
create table drivers (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  phone                text,
  email                text,
  payment_info         text,
  reference_currency   text,
  rate_eur_per_100km   numeric,
  invite_token         text not null unique default encode(gen_random_bytes(16), 'hex'),
  revoked              boolean not null default false,
  created_at           timestamptz not null default now()
);

-- Autos, die für Fahrten genutzt werden. Jedes Auto gehört einem Fahrer.
create table cars (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  notes             text,
  driver_id         uuid references drivers(id),
  size              text, -- 'Klein' | 'Kompakt' | 'Mittelklasse' | 'Oberklasse'
  drive_type        text, -- 'Elektro' | 'Verbrenner'
  has_ac            boolean not null default false,
  has_seat_heating  boolean not null default false,
  has_usb           boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Vordefinierte Strecken, z.B. "Basel - München".
-- total_price = individueller Gesamtbetrag für die komplette Strecke
-- (bewusst NICHT die Summe der Teilstrecken-Beiträge, sondern frei einstellbar).
-- driver_id = falls von einem Fahrer selbst angelegt (NULL = vom Admin
-- verwaltete, gemeinsam nutzbare Strecke).
create table routes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  total_price integer not null default 0,
  driver_id   uuid references drivers(id),
  created_at  timestamptz not null default now()
);

-- Zwischenstopps einer Strecke, in Reihenfolge (order_index: 0, 1, 2, ...).
-- order_index 0 = Startpunkt, letzter order_index = Zielpunkt.
-- name = Stadt (Kurzbezeichnung), plus optionale Adressdetails.
-- price_to_next = Mitfahrbeitrag (ganzzahlig) für den Abschnitt von diesem
-- Stopp bis zum jeweils nächsten Stopp der Strecke.
-- distance_to_next_km/duration_to_next_min = per Klick berechnete Fahrstrecke/
-- -zeit zum jeweils nächsten Stopp (via OpenStreetMap, siehe Admin-Bereich).
create table route_stops (
  id                   uuid primary key default gen_random_uuid(),
  route_id             uuid not null references routes(id) on delete cascade,
  name                 text not null,
  postal_code          text,
  street               text,
  house_number         text,
  country              text,
  maps_link            text,
  order_index          int not null,
  price_to_next        integer not null default 0,
  distance_to_next_km  numeric,
  duration_to_next_min integer,
  latitude             numeric,
  longitude            numeric,
  unique (route_id, order_index)
);

-- Eine veröffentlichte Fahrt: konkretes Datum/Uhrzeit einer Strecke, mit Auto
-- und Fahrer. closed = vom Fahrer "zugemacht" (keine neuen Buchungen mehr).
create table trips (
  id          uuid primary key default gen_random_uuid(),
  route_id    uuid not null references routes(id) on delete cascade,
  car_id      uuid references cars(id),
  driver_id   uuid references drivers(id),
  trip_date   date not null,
  start_time  time not null,
  total_seats int not null check (total_seats > 0),
  closed      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Eine Buchung: Mitfahrer bucht einen Abschnitt (from_stop -> to_stop) einer
-- Fahrt. from_order/to_order sind aus route_stops.order_index kopiert, damit
-- sich Überschneidungen von Teilstrecken einfach berechnen lassen. price ist
-- der Mitfahrbeitrag zum Zeitpunkt der Buchung (bleibt bei späteren
-- Preisänderungen an der Strecke unverändert).
create table bookings (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips(id) on delete cascade,
  person_id     uuid not null references people(id) on delete cascade,
  from_stop_id  uuid not null references route_stops(id),
  to_stop_id    uuid not null references route_stops(id),
  from_order    int not null,
  to_order      int not null,
  seats         int not null default 1 check (seats > 0),
  price         integer not null default 0,
  cancelled     boolean not null default false,
  created_at    timestamptz not null default now()
);

create index on bookings (trip_id) where not cancelled;
create index on bookings (person_id) where not cancelled;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
-- Grundprinzip:
--  - Direkter Tabellenzugriff ist für "anon" komplett gesperrt.
--  - Eingeladene Mitfahrer greifen ausschließlich über die untenstehenden
--    RPC-Funktionen zu (SECURITY DEFINER), die den invite_token prüfen.
--  - Der Admin (du) meldet sich per Supabase-Auth (E-Mail/Passwort) an und
--    bekommt über die Policy unten vollen Zugriff auf alle Tabellen.

alter table people       enable row level security;
alter table cars         enable row level security;
alter table drivers      enable row level security;
alter table routes       enable row level security;
alter table route_stops  enable row level security;
alter table trips        enable row level security;
alter table bookings     enable row level security;

create policy "admin full access" on people
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin full access" on cars
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin full access" on drivers
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin full access" on routes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin full access" on route_stops
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin full access" on trips
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin full access" on bookings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Kein direkter Zugriff für anon über die Tabellen selbst
revoke all on people, cars, drivers, routes, route_stops, trips, bookings from anon;

-- ----------------------------------------------------------------------------
-- RPC-Funktionen für eingeladene Mitfahrer (aufgerufen mit dem anon-Key)
-- ----------------------------------------------------------------------------

-- Fahrten der Zukunft auflisten (für die Buchungsseite)
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

-- Details einer Fahrt: Zwischenstopps (inkl. Adresse) + belegte Plätze und
-- Mitfahrbeitrag pro Teilabschnitt, sowie der individuelle Gesamtbetrag
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
             'house_number', house_number, 'country', country, 'maps_link', maps_link,
             'latitude', latitude, 'longitude', longitude
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

-- Buchung anlegen (mit Kapazitätsprüfung und Mitfahrbeitrag-Berechnung für
-- den gewählten Teilabschnitt; bei Buchung der kompletten Strecke wird der
-- individuelle Gesamtbetrag der Strecke verwendet statt der Teilstrecken-Summe)
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

-- Eigene Buchungen auflisten
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
           c.name as car_name, c.notes as car_notes,
           fs.name as from_stop, ts.name as to_stop,
           (
             select case when count(*) = count(distance_to_next_km)
                     then round(coalesce(sum(distance_to_next_km), 0)::numeric, 1)
                     else null end
             from route_stops
             where route_id = tr.route_id and order_index >= bk.from_order and order_index < bk.to_order
           ) as distance_km,
           (
             select case when count(*) = count(duration_to_next_min)
                     then coalesce(sum(duration_to_next_min), 0)
                     else null end
             from route_stops
             where route_id = tr.route_id
               and order_index >= (select min(order_index) from route_stops where route_id = tr.route_id)
               and order_index < bk.from_order
           ) as duration_to_from_min,
           (
             select case when count(*) = count(duration_to_next_min)
                     then coalesce(sum(duration_to_next_min), 0)
                     else null end
             from route_stops
             where route_id = tr.route_id
               and order_index >= (select min(order_index) from route_stops where route_id = tr.route_id)
               and order_index < bk.to_order
           ) as duration_to_to_min
    from bookings bk
    join trips tr on tr.id = bk.trip_id
    join routes r on r.id = tr.route_id
    left join cars c on c.id = tr.car_id
    join route_stops fs on fs.id = bk.from_stop_id
    join route_stops ts on ts.id = bk.to_stop_id
    where bk.person_id = v_person.id and not bk.cancelled
  ) b;

  return json_build_object('bookings', v_result);
end;
$$;

-- Eigene Buchung stornieren
create or replace function fn_cancel_booking(p_token text, p_booking_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person people%rowtype;
  v_owner  uuid;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select person_id into v_owner from bookings where id = p_booking_id and not cancelled;
  if v_owner is null then
    return json_build_object('error', 'booking_not_found');
  end if;
  if v_owner <> v_person.id then
    return json_build_object('error', 'not_your_booking');
  end if;

  update bookings set cancelled = true where id = p_booking_id;
  return json_build_object('success', true);
end;
$$;

-- Nur diese Funktionen dürfen von eingeladenen Mitfahrern (anon-Key) genutzt werden
grant execute on function fn_list_open_trips(text)                       to anon;
grant execute on function fn_get_trip_details(text, uuid)                to anon;
grant execute on function fn_create_booking(text, uuid, uuid, uuid, int) to anon;
grant execute on function fn_list_my_bookings(text)                      to anon;
grant execute on function fn_cancel_booking(text, uuid)                  to anon;

-- ----------------------------------------------------------------------------
-- RPC-Funktionen für Fahrer (aufgerufen mit dem anon-Key, über den eigenen
-- Einladungslink /driver/TOKEN). Fahrer sehen und verwalten nur ihre eigenen
-- Fahrten.
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

  select coalesce(json_agg(json_build_object('id', id, 'name', name, 'notes', notes) order by name), '[]'::json)
  into v_cars from cars where driver_id = v_driver.id;

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

  if not exists (select 1 from cars where id = p_car_id and driver_id = v_driver.id) then
    return json_build_object('error', 'car_not_owned');
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

grant execute on function fn_driver_info(text)                                     to anon;
grant execute on function fn_driver_list_routes(text)                              to anon;
grant execute on function fn_driver_list_cars(text)                                to anon;
grant execute on function fn_driver_list_trips(text)                               to anon;
grant execute on function fn_driver_create_trip(text, uuid, uuid, date, time, int) to anon;
grant execute on function fn_driver_delete_trip(text, uuid)                        to anon;
grant execute on function fn_driver_list_trip_bookings(text, uuid)                 to anon;

-- ----------------------------------------------------------------------------
-- Selbstanmeldung ohne Einladungslink (für die Startseite). Neue Anmeldungen
-- werden gesperrt angelegt (revoked = true) und müssen vom Admin über
-- "Zugang wiederherstellen" freigeschaltet werden.
-- ----------------------------------------------------------------------------

create or replace function fn_signup_request(
  p_role       text,   -- 'mitfahrer' oder 'fahrer'
  p_first_name text,
  p_last_name  text,
  p_phone      text,
  p_email      text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_token text;
  v_id    uuid;
begin
  v_name := trim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, ''));
  if v_name = '' then
    return json_build_object('error', 'missing_name');
  end if;
  if p_role not in ('mitfahrer', 'fahrer') then
    return json_build_object('error', 'invalid_role');
  end if;

  if p_role = 'mitfahrer' then
    insert into people (name, phone, email, revoked)
    values (v_name, nullif(trim(p_phone), ''), nullif(trim(p_email), ''), true)
    returning id, invite_token into v_id, v_token;
  else
    insert into drivers (name, phone, email, revoked)
    values (v_name, nullif(trim(p_phone), ''), nullif(trim(p_email), ''), true)
    returning id, invite_token into v_id, v_token;
  end if;

  return json_build_object('success', true, 'id', v_id, 'token', v_token, 'role', p_role);
end;
$$;

grant execute on function fn_signup_request(text, text, text, text, text) to anon;

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

-- ----------------------------------------------------------------------------
-- Fahrer können eigene Strecken (Start/Ziel/Zwischenstopp) selbst anlegen
-- und verwalten, unabhängig von den vom Admin verwalteten Strecken.
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
create or replace function fn_driver_update_stop_distance(
  p_token text, p_stop_id uuid, p_distance_km numeric, p_duration_min integer,
  p_latitude numeric default null, p_longitude numeric default null
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
  set distance_to_next_km = p_distance_km,
      duration_to_next_min = p_duration_min,
      latitude = coalesce(p_latitude, latitude),
      longitude = coalesce(p_longitude, longitude)
  where id = p_stop_id;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_stop_distance(text, uuid, numeric, integer, numeric, numeric) to anon;

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

-- ----------------------------------------------------------------------------
-- Fahrer können eigene Autos selbst anlegen, bearbeiten und löschen
-- ----------------------------------------------------------------------------
create or replace function fn_driver_list_own_cars(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_cars   json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select coalesce(json_agg(
           json_build_object(
             'id', id, 'name', name, 'notes', notes, 'size', size, 'drive_type', drive_type,
             'has_ac', has_ac, 'has_seat_heating', has_seat_heating, 'has_usb', has_usb
           )
           order by created_at desc
         ), '[]'::json)
  into v_cars
  from cars where driver_id = v_driver.id;

  return json_build_object('cars', v_cars);
end;
$$;

grant execute on function fn_driver_list_own_cars(text) to anon;

create or replace function fn_driver_create_car(
  p_token text, p_name text, p_notes text,
  p_size text default null, p_drive_type text default null,
  p_has_ac boolean default false, p_has_seat_heating boolean default false, p_has_usb boolean default false
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_car_id uuid;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if coalesce(trim(p_name), '') = '' then
    return json_build_object('error', 'missing_name');
  end if;

  insert into cars (name, notes, driver_id, size, drive_type, has_ac, has_seat_heating, has_usb)
  values (trim(p_name), nullif(trim(p_notes), ''), v_driver.id, nullif(p_size,''), nullif(p_drive_type,''), coalesce(p_has_ac,false), coalesce(p_has_seat_heating,false), coalesce(p_has_usb,false))
  returning id into v_car_id;

  return json_build_object('success', true, 'car_id', v_car_id);
end;
$$;

grant execute on function fn_driver_create_car(text, text, text, text, text, boolean, boolean, boolean) to anon;

create or replace function fn_driver_update_car(
  p_token text, p_car_id uuid, p_name text, p_notes text,
  p_size text default null, p_drive_type text default null,
  p_has_ac boolean default false, p_has_seat_heating boolean default false, p_has_usb boolean default false
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

  update cars
  set name = trim(p_name),
      notes = nullif(trim(p_notes), ''),
      size = nullif(p_size, ''),
      drive_type = nullif(p_drive_type, ''),
      has_ac = coalesce(p_has_ac, false),
      has_seat_heating = coalesce(p_has_seat_heating, false),
      has_usb = coalesce(p_has_usb, false)
  where id = p_car_id and driver_id = v_driver.id;

  if not found then
    return json_build_object('error', 'not_your_car');
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_car(text, uuid, text, text, text, text, boolean, boolean, boolean) to anon;

create or replace function fn_driver_delete_car(p_token text, p_car_id uuid)
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

  delete from cars where id = p_car_id and driver_id = v_driver.id;
  if not found then
    return json_build_object('error', 'not_your_car');
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_delete_car(text, uuid) to anon;
