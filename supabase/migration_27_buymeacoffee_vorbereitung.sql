-- ============================================================================
-- Migration 27: Buy Me a Coffee Link vorbereiten
-- Jeder Fahrer und Mitfahrer kann ab jetzt einen Buy-Me-a-Coffee-Link in
-- seinen eigenen Einstellungen hinterlegen. Aktuell nur Vorbereitung — es
-- gibt noch keine Pflicht und keine Anzeige gegenüber anderen Teilnehmern.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

alter table drivers add column if not exists buymeacoffee_link text;
alter table people  add column if not exists buymeacoffee_link text;

-- ----------------------------------------------------------------------------
-- Fahrer: eigenes Profil inkl. Buy-Me-a-Coffee-Link aktualisieren
-- ----------------------------------------------------------------------------
create or replace function fn_driver_update_profile(
  p_token              text,
  p_payment_info       text,
  p_reference_currency text,
  p_rate_eur_per_100km numeric,
  p_phone              text default null,
  p_email              text default null,
  p_buymeacoffee_link  text default null
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
      email              = nullif(trim(p_email), ''),
      buymeacoffee_link  = nullif(trim(p_buymeacoffee_link), '')
  where id = v_driver.id;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_profile(text, text, text, numeric, text, text, text) to anon;

-- fn_driver_list_trips: Buy-Me-a-Coffee-Link mit ausliefern (zum Vorbelegen
-- der eigenen Einstellungsseite)
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
      'buymeacoffee_link', v_driver.buymeacoffee_link,
      'rating', v_rating
    ),
    'trips', v_trips
  );
end;
$$;

grant execute on function fn_driver_list_trips(text) to anon;

-- ----------------------------------------------------------------------------
-- Mitfahrer: eigenes Profil inkl. Buy-Me-a-Coffee-Link aktualisieren
-- ----------------------------------------------------------------------------
create or replace function fn_person_update_profile(
  p_token             text,
  p_phone             text,
  p_email             text,
  p_buymeacoffee_link text default null
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

  update people
  set phone             = nullif(trim(p_phone), ''),
      email             = nullif(trim(p_email), ''),
      buymeacoffee_link = nullif(trim(p_buymeacoffee_link), '')
  where id = v_person.id;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_person_update_profile(text, text, text, text) to anon;

-- fn_list_open_trips: Buy-Me-a-Coffee-Link mit ausliefern (zum Vorbelegen der
-- eigenen Einstellungsseite)
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
    'person', json_build_object(
      'id', v_person.id, 'name', v_person.name, 'phone', v_person.phone, 'email', v_person.email,
      'buymeacoffee_link', v_person.buymeacoffee_link, 'rating', v_rating
    ),
    'trips', v_trips
  );
end;
$$;

grant execute on function fn_list_open_trips(text) to anon;
