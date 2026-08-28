-- ============================================================================
-- Migration 11: Distanz & geschätzte Abfahrts-/Ankunftszeit auch bei
-- "Meine Buchungen" für Mitfahrer
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

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

grant execute on function fn_list_my_bookings(text) to anon;
