-- ============================================================================
-- Migration 42: Fahrer können die Sitzplatzanzahl einer eigenen, bereits
-- veröffentlichten Fahrt nachträglich anpassen (+/-). Die Untergrenze ist
-- die maximale GLEICHZEITIGE Belegung über die Strecke hinweg (nicht einfach
-- die Summe aller Buchungen, da Mitfahrer unterschiedliche, nicht
-- überlappende Teilstrecken gebucht haben könnten).
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

-- fn_driver_list_trips: min_seats (Mindestgrenze für Reduzierung) je Fahrt
-- mit ausliefern, damit der "-"-Button clientseitig deaktiviert werden kann.
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

grant execute on function fn_driver_list_trips(text) to anon;

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
