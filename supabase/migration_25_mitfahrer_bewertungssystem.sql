-- ============================================================================
-- Migration 25: Bewertungssystem für Mitfahrer
-- Kategorien: Pünktlichkeit am Startpunkt, Sauberkeit, Kommunikation —
-- jeweils 1 bis 5 Sterne. Der Fahrer bewertet nach einer bereits
-- stattgefundenen, nicht stornierten Buchung (eine Bewertung pro Buchung,
-- nachträglich änderbar).
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

create table if not exists person_ratings (
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

alter table person_ratings enable row level security;

drop policy if exists "admin full access" on person_ratings;
create policy "admin full access" on person_ratings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

revoke all on person_ratings from anon;

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
-- fn_driver_list_trip_bookings: "kann bewertet werden"-Flag + vorhandene
-- Bewertung mit ausliefern
-- ----------------------------------------------------------------------------
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

grant execute on function fn_driver_list_trip_bookings(text, uuid) to anon;

-- ----------------------------------------------------------------------------
-- fn_list_open_trips: eigenen Bewertungs-Durchschnitt des Mitfahrers mit
-- ausliefern (für die Einstellungsseite)
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
    'person', json_build_object('id', v_person.id, 'name', v_person.name, 'phone', v_person.phone, 'email', v_person.email, 'rating', v_rating),
    'trips', v_trips
  );
end;
$$;

grant execute on function fn_list_open_trips(text) to anon;
