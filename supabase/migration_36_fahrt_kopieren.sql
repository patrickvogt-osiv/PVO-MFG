-- ============================================================================
-- Migration 36: route_id und car_id bei fn_driver_list_trips mit ausliefern,
-- damit ein Fahrer eine bestehende Fahrt (egal ob bevorstehend oder
-- vergangen) als Vorlage zum Kopieren nutzen kann.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

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
