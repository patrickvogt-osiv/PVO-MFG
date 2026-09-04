-- ============================================================================
-- Migration 32: Koordinaten (Breiten-/Längengrad) je Stopp bei
-- fn_list_open_trips mitliefern, damit im Frontend eine Umkreissuche
-- (km-Radius statt nur exakter Ortsname) möglich ist.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

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

grant execute on function fn_list_open_trips(text) to anon;
