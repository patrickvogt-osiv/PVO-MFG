-- ============================================================================
-- Migration 9: Zwischenstopp-Namen in der Fahrtenübersicht für Mitfahrer
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
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select coalesce(json_agg(t), '[]'::json) into v_trips
  from (
    select tr.id, tr.trip_date, tr.start_time, tr.total_seats,
           r.id as route_id, r.name as route_name,
           c.name as car_name, c.notes as car_notes,
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
    where tr.trip_date >= current_date
    order by tr.trip_date, tr.start_time
  ) t;

  return json_build_object(
    'person', json_build_object('id', v_person.id, 'name', v_person.name),
    'trips', v_trips
  );
end;
$$;

grant execute on function fn_list_open_trips(text) to anon;
