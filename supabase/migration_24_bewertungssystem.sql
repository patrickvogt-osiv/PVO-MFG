-- ============================================================================
-- Migration 24: Bewertungssystem für Fahrer
-- Kategorien: Fahrerlebnis, Pünktlichkeit am Startpunkt, Fahrweise,
-- Sauberkeit, Kommunikation — jeweils 1 bis 5 Sterne.
-- Mitfahrer können jede eigene, bereits stattgefundene Fahrt bewerten
-- (eine Bewertung pro Buchung, nachträglich änderbar).
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

create table if not exists driver_ratings (
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

alter table driver_ratings enable row level security;

drop policy if exists "admin full access" on driver_ratings;
create policy "admin full access" on driver_ratings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

revoke all on driver_ratings from anon;

-- ----------------------------------------------------------------------------
-- Mitfahrer: Bewertung abgeben oder aktualisieren (nur für eigene,
-- bereits stattgefundene, nicht stornierte Buchungen)
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
-- fn_list_my_bookings: vorhandene Bewertung + "kann bewertet werden"-Flag
-- mit ausliefern
-- ----------------------------------------------------------------------------
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
    join route_stops fs on fs.id = bk.from_stop_id
    join route_stops ts on ts.id = bk.to_stop_id
    left join driver_ratings dr on dr.booking_id = bk.id
    where bk.person_id = v_person.id and not bk.cancelled
  ) b;

  return json_build_object('bookings', v_result);
end;
$$;

grant execute on function fn_list_my_bookings(text) to anon;

-- ----------------------------------------------------------------------------
-- fn_get_trip_details: Bewertungs-Durchschnitt des Fahrers mit ausliefern
-- ----------------------------------------------------------------------------
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

  select tr.route_id, tr.total_seats, c.name, c.notes, tr.closed, tr.driver_id, d.payment_info
    into v_route_id, v_total, v_car_name, v_car_notes, v_closed, v_driver_id, v_driver_payment
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
    'driver_payment_info', v_driver_payment,
    'driver_rating', v_rating,
    'stops', v_stops,
    'segment_usage', v_usage,
    'route_total_price', v_route_price,
    'max_order', v_max_order
  );
end;
$$;

grant execute on function fn_get_trip_details(text, uuid) to anon;

-- ----------------------------------------------------------------------------
-- fn_driver_list_trips: eigenen Bewertungs-Durchschnitt mit ausliefern
-- ----------------------------------------------------------------------------
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
           r.name as route_name, c.name as car_name, c.notes as car_notes,
           coalesce((select sum(b.seats) from bookings b where b.trip_id = tr.id and not b.cancelled), 0) as seats_booked,
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
      'rating', v_rating
    ),
    'trips', v_trips
  );
end;
$$;

grant execute on function fn_driver_list_trips(text) to anon;
