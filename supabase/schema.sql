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

-- Generische Admin-Einstellungen (Key/Value), aktuell für den
-- Buy-Me-a-Coffee-Projekt-Link genutzt.
create table app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Tabellen
-- ----------------------------------------------------------------------------

-- Eingeladene Mitfahrer. Der invite_token ist das "Ticket" für den Zugang -
-- wer den Link mit diesem Token hat, kann buchen.
create table people (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  phone                    text,
  email                    text,
  bmc_subscription_active  boolean not null default false,
  bmc_last_payment_date    date,
  invite_token             text not null unique default encode(gen_random_bytes(16), 'hex'),
  revoked                  boolean not null default false,
  created_at               timestamptz not null default now()
);

-- Fahrer: eigene Rolle mit eigenem Einladungslink. Sehen und verwalten nur
-- ihre eigenen Fahrten und Autos.
create table drivers (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  phone                    text,
  email                    text,
  payment_info             text,
  reference_currency       text,
  rate_eur_per_100km       numeric,
  bmc_subscription_active  boolean not null default false,
  bmc_last_payment_date    date,
  invite_token             text not null unique default encode(gen_random_bytes(16), 'hex'),
  revoked                  boolean not null default false,
  created_at               timestamptz not null default now()
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

-- Bewertungen: Mitfahrer bewerten Fahrer je Buchung (eine Bewertung pro
-- Buchung, nachträglich änderbar), je 1-5 Sterne in fünf Kategorien.
create table driver_ratings (
  id                     uuid primary key default gen_random_uuid(),
  booking_id             uuid not null unique references bookings(id) on delete cascade,
  driver_id              uuid not null references drivers(id) on delete cascade,
  person_id              uuid not null references people(id) on delete cascade,
  rating_experience      integer not null check (rating_experience between 1 and 5),
  rating_punctuality     integer not null check (rating_punctuality between 1 and 5),
  rating_driving         integer not null check (rating_driving between 1 and 5),
  rating_cleanliness     integer not null check (rating_cleanliness between 1 and 5),
  rating_communication   integer not null check (rating_communication between 1 and 5),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Bewertungen: Fahrer bewerten Mitfahrer je Buchung, je 1-5 Sterne in drei
-- Kategorien.
create table person_ratings (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null unique references bookings(id) on delete cascade,
  person_id             uuid not null references people(id) on delete cascade,
  driver_id             uuid not null references drivers(id) on delete cascade,
  rating_punctuality    integer not null check (rating_punctuality between 1 and 5),
  rating_cleanliness    integer not null check (rating_cleanliness between 1 and 5),
  rating_communication  integer not null check (rating_communication between 1 and 5),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Gespeicherte Suchaufträge: Mitfahrer möchten benachrichtigt werden, wenn
-- eine neue Fahrt innerhalb eines Umkreises um Start-/Zielort erscheint.
create table search_alerts (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  start_lat   numeric not null,
  start_lon   numeric not null,
  start_label text,
  dest_lat    numeric not null,
  dest_lon    numeric not null,
  dest_label  text,
  radius_km   integer not null default 20,
  search_date date,
  flex_days   integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Distanz zwischen zwei Koordinaten in km (Luftlinie).
create or replace function fn_haversine_km(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric)
returns numeric
language sql
immutable
as $$
  select 6371 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  ));
$$;

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
alter table driver_ratings enable row level security;
alter table person_ratings enable row level security;
alter table app_settings enable row level security;
alter table search_alerts enable row level security;

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
create policy "admin full access" on driver_ratings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin full access" on person_ratings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin full access" on app_settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin full access" on search_alerts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Kein direkter Zugriff für anon über die Tabellen selbst
revoke all on people, cars, drivers, routes, route_stops, trips, bookings, driver_ratings, person_ratings, app_settings, search_alerts from anon;

-- Öffentlicher, lesender Zugriff auf einzelne Einstellungen (z.B. den
-- Buy-Me-a-Coffee-Projekt-Link), damit auch Fahrer/Mitfahrer (anon-Key) ihn
-- sehen können.
create or replace function fn_get_app_setting(p_key text)
returns text
language sql
security definer
set search_path = public
as $$
  select value from app_settings where key = p_key;
$$;

grant execute on function fn_get_app_setting(text) to anon;

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
  v_rating json;
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
           d.name as driver_name, d.phone as driver_phone,
           (
             select string_agg(rs.name, ', ' order by rs.order_index)
             from route_stops rs
             where rs.route_id = tr.route_id
               and rs.order_index > 0
               and rs.order_index < (select max(order_index) from route_stops where route_id = tr.route_id)
           ) as via_stops,
           (
             select coalesce(json_agg(json_build_object(
               'name', rs.name, 'country', rs.country, 'order_index', rs.order_index,
               'latitude', rs.latitude, 'longitude', rs.longitude
             ) order by rs.order_index), '[]'::json)
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
    left join drivers d on d.id = tr.driver_id
    where tr.trip_date >= current_date
    order by tr.trip_date, tr.start_time
  ) t;

  select json_build_object(
    'count', count(*),
    'avg_punctuality', round(avg(rating_punctuality)::numeric, 1),
    'avg_cleanliness', round(avg(rating_cleanliness)::numeric, 1),
    'avg_communication', round(avg(rating_communication)::numeric, 1),
    'avg_overall', round(avg((rating_punctuality + rating_cleanliness + rating_communication) / 3.0)::numeric, 1)
  )
  into v_rating
  from person_ratings where person_id = v_person.id;

  return json_build_object(
    'person', json_build_object(
      'id', v_person.id, 'name', v_person.name, 'phone', v_person.phone, 'email', v_person.email,
      'bmc_subscription_active', v_person.bmc_subscription_active,
      'bmc_last_payment_date', v_person.bmc_last_payment_date,
      'project_buymeacoffee_link', (select value from app_settings where key = 'buymeacoffee_link'),
      'rating', v_rating
    ),
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
  v_driver_id       uuid;
  v_driver_name     text;
  v_driver_phone    text;
  v_driver_email    text;
  v_driver_payment  text;
  v_max_order       int;
  v_route_price     int;
  v_stops           json;
  v_usage           json;
  v_rating          json;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select tr.route_id, tr.total_seats, c.name, c.notes, tr.closed, tr.driver_id, d.name, d.phone, d.email, d.payment_info
    into v_route_id, v_total, v_car_name, v_car_notes, v_closed, v_driver_id, v_driver_name, v_driver_phone, v_driver_email, v_driver_payment
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

  select json_build_object(
    'count', count(*),
    'avg_experience', round(avg(rating_experience)::numeric, 1),
    'avg_punctuality', round(avg(rating_punctuality)::numeric, 1),
    'avg_driving', round(avg(rating_driving)::numeric, 1),
    'avg_cleanliness', round(avg(rating_cleanliness)::numeric, 1),
    'avg_communication', round(avg(rating_communication)::numeric, 1),
    'avg_overall', round(avg((rating_experience + rating_punctuality + rating_driving + rating_cleanliness + rating_communication) / 5.0)::numeric, 1)
  )
  into v_rating
  from driver_ratings where driver_id = v_driver_id;

  return json_build_object(
    'total_seats', v_total,
    'car_name', v_car_name,
    'car_notes', v_car_notes,
    'closed', v_closed,
    'driver_name', v_driver_name,
    'driver_phone', v_driver_phone,
    'driver_email', v_driver_email,
    'driver_payment_info', v_driver_payment,
    'driver_rating', v_rating,
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
           d.name as driver_name, d.phone as driver_phone, d.email as driver_email,
           fs.name as from_stop, ts.name as to_stop,
           (tr.trip_date <= current_date and tr.driver_id is not null) as can_rate,
           dr.rating_experience, dr.rating_punctuality, dr.rating_driving,
           dr.rating_cleanliness, dr.rating_communication,
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
    left join drivers d on d.id = tr.driver_id
    join route_stops fs on fs.id = bk.from_stop_id
    join route_stops ts on ts.id = bk.to_stop_id
    left join driver_ratings dr on dr.booking_id = bk.id
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
  v_rating json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select coalesce(json_agg(t order by t.trip_date, t.start_time), '[]'::json) into v_trips
  from (
    select tr.id, tr.trip_date, tr.start_time, tr.total_seats, tr.closed,
           tr.route_id, tr.car_id,
           r.name as route_name, c.name as car_name, c.notes as car_notes,
           coalesce((select sum(b.seats) from bookings b where b.trip_id = tr.id and not b.cancelled), 0) as seats_booked,
           (
             select coalesce(max(seg_sum), 0)
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
           ) as min_seats,
           (
             select string_agg(rs.name, ', ' order by rs.order_index)
             from route_stops rs
             where rs.route_id = tr.route_id
               and rs.order_index > 0
               and rs.order_index < (select max(order_index) from route_stops where route_id = tr.route_id)
           ) as via_stops
    from trips tr
    join routes r on r.id = tr.route_id
    left join cars c on c.id = tr.car_id
    where tr.driver_id = v_driver.id
  ) t;

  select json_build_object(
    'count', count(*),
    'avg_experience', round(avg(rating_experience)::numeric, 1),
    'avg_punctuality', round(avg(rating_punctuality)::numeric, 1),
    'avg_driving', round(avg(rating_driving)::numeric, 1),
    'avg_cleanliness', round(avg(rating_cleanliness)::numeric, 1),
    'avg_communication', round(avg(rating_communication)::numeric, 1),
    'avg_overall', round(avg((rating_experience + rating_punctuality + rating_driving + rating_cleanliness + rating_communication) / 5.0)::numeric, 1)
  )
  into v_rating
  from driver_ratings where driver_id = v_driver.id;

  return json_build_object(
    'driver', json_build_object(
      'id', v_driver.id, 'name', v_driver.name,
      'phone', v_driver.phone, 'email', v_driver.email,
      'payment_info', v_driver.payment_info,
      'reference_currency', v_driver.reference_currency,
      'rate_eur_per_100km', v_driver.rate_eur_per_100km,
      'bmc_subscription_active', v_driver.bmc_subscription_active,
      'bmc_last_payment_date', v_driver.bmc_last_payment_date,
      'project_buymeacoffee_link', (select value from app_settings where key = 'buymeacoffee_link'),
      'rating', v_rating
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
  v_valid_until date;
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

  if not coalesce(v_driver.bmc_subscription_active, false) then
    return json_build_object('error', 'subscription_inactive');
  end if;

  if v_driver.bmc_last_payment_date is null then
    return json_build_object('error', 'no_payment_recorded');
  end if;

  v_valid_until := v_driver.bmc_last_payment_date + 40;
  if p_date > v_valid_until then
    return json_build_object('error', 'trip_date_out_of_window', 'valid_until', v_valid_until);
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
           p.name as person_name, p.phone as person_phone,
           fs.name as from_stop, ts.name as to_stop,
           (tr.trip_date <= current_date) as can_rate,
           pr.rating_punctuality, pr.rating_cleanliness, pr.rating_communication
    from bookings bk
    join trips tr on tr.id = bk.trip_id
    join people p on p.id = bk.person_id
    join route_stops fs on fs.id = bk.from_stop_id
    join route_stops ts on ts.id = bk.to_stop_id
    left join person_ratings pr on pr.booking_id = bk.id
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
  p_rate_eur_per_100km numeric,
  p_phone              text default null,
  p_email              text default null
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
      rate_eur_per_100km = p_rate_eur_per_100km,
      phone              = nullif(trim(p_phone), ''),
      email              = nullif(trim(p_email), '')
  where id = v_driver.id;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_profile(text, text, text, numeric, text, text) to anon;

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

-- ----------------------------------------------------------------------------
-- Mitfahrer: eigenes Profil (Telefon/E-Mail) selbst aktualisieren
-- ----------------------------------------------------------------------------
create or replace function fn_person_update_profile(p_token text, p_phone text, p_email text)
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

  update people
  set phone = nullif(trim(p_phone), ''),
      email = nullif(trim(p_email), '')
  where id = v_person.id;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_person_update_profile(text, text, text) to anon;

-- ----------------------------------------------------------------------------
-- Mitfahrer: Bewertung für den Fahrer einer eigenen, bereits stattgefundenen,
-- nicht stornierten Buchung abgeben oder aktualisieren
-- ----------------------------------------------------------------------------
create or replace function fn_submit_rating(
  p_token          text,
  p_booking_id     uuid,
  p_experience     integer,
  p_punctuality    integer,
  p_driving        integer,
  p_cleanliness    integer,
  p_communication  integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person     people%rowtype;
  v_person_id  uuid;
  v_trip_date  date;
  v_driver_id  uuid;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select bk.person_id, tr.trip_date, tr.driver_id
    into v_person_id, v_trip_date, v_driver_id
  from bookings bk
  join trips tr on tr.id = bk.trip_id
  where bk.id = p_booking_id and not bk.cancelled;

  if not found then
    return json_build_object('error', 'booking_not_found');
  end if;
  if v_person_id <> v_person.id then
    return json_build_object('error', 'not_your_booking');
  end if;
  if v_trip_date > current_date then
    return json_build_object('error', 'trip_not_completed');
  end if;
  if v_driver_id is null then
    return json_build_object('error', 'no_driver');
  end if;
  if p_experience not between 1 and 5 or p_punctuality not between 1 and 5
     or p_driving not between 1 and 5 or p_cleanliness not between 1 and 5
     or p_communication not between 1 and 5 then
    return json_build_object('error', 'invalid_rating');
  end if;

  insert into driver_ratings (
    booking_id, driver_id, person_id,
    rating_experience, rating_punctuality, rating_driving, rating_cleanliness, rating_communication
  )
  values (
    p_booking_id, v_driver_id, v_person.id,
    p_experience, p_punctuality, p_driving, p_cleanliness, p_communication
  )
  on conflict (booking_id) do update set
    rating_experience = excluded.rating_experience,
    rating_punctuality = excluded.rating_punctuality,
    rating_driving = excluded.rating_driving,
    rating_cleanliness = excluded.rating_cleanliness,
    rating_communication = excluded.rating_communication,
    updated_at = now();

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_submit_rating(text, uuid, integer, integer, integer, integer, integer) to anon;

-- ----------------------------------------------------------------------------
-- Fahrer: Mitfahrer einer eigenen, bereits stattgefundenen Buchung bewerten
-- oder die Bewertung aktualisieren
-- ----------------------------------------------------------------------------
create or replace function fn_driver_submit_person_rating(
  p_token          text,
  p_booking_id     uuid,
  p_punctuality    integer,
  p_cleanliness    integer,
  p_communication  integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver     drivers%rowtype;
  v_trip_driver uuid;
  v_trip_date  date;
  v_person_id  uuid;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select tr.driver_id, tr.trip_date, bk.person_id
    into v_trip_driver, v_trip_date, v_person_id
  from bookings bk
  join trips tr on tr.id = bk.trip_id
  where bk.id = p_booking_id and not bk.cancelled;

  if not found then
    return json_build_object('error', 'booking_not_found');
  end if;
  if v_trip_driver is null or v_trip_driver <> v_driver.id then
    return json_build_object('error', 'not_your_trip');
  end if;
  if v_trip_date > current_date then
    return json_build_object('error', 'trip_not_completed');
  end if;
  if p_punctuality not between 1 and 5 or p_cleanliness not between 1 and 5
     or p_communication not between 1 and 5 then
    return json_build_object('error', 'invalid_rating');
  end if;

  insert into person_ratings (booking_id, person_id, driver_id, rating_punctuality, rating_cleanliness, rating_communication)
  values (p_booking_id, v_person_id, v_driver.id, p_punctuality, p_cleanliness, p_communication)
  on conflict (booking_id) do update set
    rating_punctuality = excluded.rating_punctuality,
    rating_cleanliness = excluded.rating_cleanliness,
    rating_communication = excluded.rating_communication,
    updated_at = now();

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_submit_person_rating(text, uuid, integer, integer, integer) to anon;

-- ----------------------------------------------------------------------------
-- Mitfahrer: eigenen Suchauftrag speichern ("Informiere mich, wenn neue
-- Fahrten eingestellt werden")
-- ----------------------------------------------------------------------------
create or replace function fn_create_search_alert(
  p_token       text,
  p_start_lat   numeric,
  p_start_lon   numeric,
  p_start_label text,
  p_dest_lat    numeric,
  p_dest_lon    numeric,
  p_dest_label  text,
  p_search_date date default null,
  p_flex_days   integer default 0
)
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

  if p_start_lat is null or p_start_lon is null or p_dest_lat is null or p_dest_lon is null then
    return json_build_object('error', 'missing_coords');
  end if;

  insert into search_alerts (person_id, start_lat, start_lon, start_label, dest_lat, dest_lon, dest_label, search_date, flex_days)
  values (v_person.id, p_start_lat, p_start_lon, p_start_label, p_dest_lat, p_dest_lon, p_dest_label, p_search_date, coalesce(p_flex_days, 0));

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_create_search_alert(text, numeric, numeric, text, numeric, numeric, text, date, integer) to anon;

-- ----------------------------------------------------------------------------
-- Fahrer: nach dem Veröffentlichen einer eigenen Fahrt herausfinden, welche
-- gespeicherten Suchaufträge dazu passen (für den E-Mail-Versand im Frontend)
-- ----------------------------------------------------------------------------
create or replace function fn_driver_find_matching_alerts(p_token text, p_trip_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver    drivers%rowtype;
  v_route_id  uuid;
  v_owner     uuid;
  v_trip_date date;
  v_result    json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select route_id, driver_id, trip_date into v_route_id, v_owner, v_trip_date from trips where id = p_trip_id;
  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_trip');
  end if;

  select coalesce(json_agg(json_build_object('email', p.email, 'name', p.name)), '[]'::json)
  into v_result
  from search_alerts sa
  join people p on p.id = sa.person_id and p.email is not null and not p.revoked
  where (
    sa.search_date is null
    or v_trip_date between (sa.search_date - sa.flex_days) and (sa.search_date + sa.flex_days)
  )
  and exists (
    select 1
    from route_stops rs_start
    where rs_start.route_id = v_route_id
      and rs_start.latitude is not null and rs_start.longitude is not null
      and fn_haversine_km(sa.start_lat, sa.start_lon, rs_start.latitude, rs_start.longitude) <= sa.radius_km
      and exists (
        select 1 from route_stops rs_dest
        where rs_dest.route_id = v_route_id
          and rs_dest.latitude is not null and rs_dest.longitude is not null
          and rs_dest.order_index > rs_start.order_index
          and fn_haversine_km(sa.dest_lat, sa.dest_lon, rs_dest.latitude, rs_dest.longitude) <= sa.radius_km
      )
  );

  return json_build_object('matches', v_result);
end;
$$;

grant execute on function fn_driver_find_matching_alerts(text, uuid) to anon;

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

-- ----------------------------------------------------------------------------
-- Mitfahrer: eigene gespeicherte Suchaufträge einsehen und löschen
-- ----------------------------------------------------------------------------
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
      'radius_km', radius_km, 'created_at', created_at,
      'search_date', search_date, 'flex_days', flex_days
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

-- Willkommenstext auf der Landing-Seite (admin-editierbar über app_settings)
insert into app_settings (key, value) values (
  'welcome_text_intro',
$welcome$Du möchtest einfach eine Mitfahrgelegenheit buchen? Oder als Fahrer deine freien Plätze anbieten, um Fahrtkosten zu teilen und neue Leute kennenzulernen? Dann bist du hier genau richtig!

Schön, dass du da bist — gute Fahrt!$welcome$
) on conflict (key) do nothing;

insert into app_settings (key, value) values (
  'welcome_text_details',
$welcome$Ich habe diese Plattform ins Leben gerufen, um eine schlanke, preiswerte und unkomplizierte Alternative zu den grossen Anbietern zu schaffen. Für Mitfahrer ist die Nutzung komplett gebührenfrei. Ganz umsonst lässt sich ein solches Projekt im Hintergrund aber leider nicht betreiben.

Damit die Webseite rund um die Uhr sicher online bleibt, fallen laufende Kosten an — zum Beispiel für die Domain, das Webhosting, verschlüsselte SSL-Zertifikate, den automatischen E-Mail-Versand (Buchungsbestätigungen) sowie für Rechtstexte und die Transaktionsgebühren der Zahlungsanbieter.

Um diese Ausgaben fair zu decken, setzen wir auf ein einfaches Unterstützer-Modell:

- Als Fahrer schliesst du für lediglich 1 € pro Monat ein kleines Abo ab. Damit kannst du flexibel Fahrten für den laufenden und den Folgemonat veröffentlichen.
- Als Mitfahrer buchst du komplett kostenlos. Wenn dir der Dienst gefällt, freuen wir uns natürlich über ein freiwilliges Trinkgeld.$welcome$
) on conflict (key) do nothing;

-- Dauerhaftes Log aller E-Mail-Versandversuche (aus der Edge Function
-- "send-email" befüllt, Service-Role-Zugriff umgeht RLS automatisch).
create table email_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  recipient     text not null,
  subject       text,
  success       boolean not null,
  error_message text
);

alter table email_log enable row level security;

create policy "admin full access" on email_log
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

revoke all on email_log from anon;

create index email_log_created_at_idx on email_log (created_at desc);

-- ----------------------------------------------------------------------------
-- Fahrer: Sitzplatzanzahl einer eigenen Fahrt ändern (mit serverseitiger
-- Prüfung der Mindestgrenze — nie vertrauen, was der Client meldet)
-- ----------------------------------------------------------------------------
create or replace function fn_driver_update_trip_seats(p_token text, p_trip_id uuid, p_seats integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver   drivers%rowtype;
  v_owner    uuid;
  v_route_id uuid;
  v_min_seats integer;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select driver_id, route_id into v_owner, v_route_id from trips where id = p_trip_id;
  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_trip');
  end if;

  if p_seats is null or p_seats < 1 then
    return json_build_object('error', 'invalid_seats');
  end if;

  select coalesce(max(seg_sum), 0)
  into v_min_seats
  from (
    select seg.i, coalesce(sum(b.seats), 0) as seg_sum
    from generate_series(
      (select min(order_index) from route_stops where route_id = v_route_id),
      (select max(order_index) from route_stops where route_id = v_route_id) - 1
    ) as seg(i)
    left join bookings b
      on b.trip_id = p_trip_id
      and not b.cancelled
      and b.from_order <= seg.i
      and b.to_order > seg.i
    group by seg.i
  ) x;

  if p_seats < v_min_seats then
    return json_build_object('error', 'below_min_seats', 'min_seats', v_min_seats);
  end if;

  update trips set total_seats = p_seats where id = p_trip_id;

  return json_build_object('success', true, 'min_seats', v_min_seats);
end;
$$;

grant execute on function fn_driver_update_trip_seats(text, uuid, integer) to anon;

-- ----------------------------------------------------------------------------
-- Fahrer: Rückfahrstrecke aus einer bestehenden eigenen Strecke anlegen
-- (umgekehrte Stopp-Reihenfolge, Entfernungen/Preise werden übernommen)
-- ----------------------------------------------------------------------------
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
    prev.price_to_next, prev.distance_to_next_km, prev.duration_to_next_min
  from route_stops old
  left join route_stops prev on prev.route_id = p_route_id and prev.order_index = old.order_index - 1
  where old.route_id = p_route_id;

  return json_build_object('success', true, 'route_id', v_new_route_id);
end;
$$;

grant execute on function fn_driver_create_reverse_route(text, uuid) to anon;
