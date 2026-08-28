-- ============================================================================
-- Migration 8: Land als Adressfeld für Streckenpunkte
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

alter table route_stops add column if not exists country text;

create or replace function fn_get_trip_details(p_token text, p_trip_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person       people%rowtype;
  v_route_id     uuid;
  v_total        int;
  v_car_name     text;
  v_car_notes    text;
  v_max_order    int;
  v_route_price  int;
  v_stops        json;
  v_usage        json;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select tr.route_id, tr.total_seats, c.name, c.notes
    into v_route_id, v_total, v_car_name, v_car_notes
  from trips tr
  left join cars c on c.id = tr.car_id
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
             'house_number', house_number, 'country', country, 'maps_link', maps_link
           )
           order by order_index
         ), '[]'::json)
  into v_stops
  from route_stops where route_id = v_route_id;

  select coalesce(json_agg(
           json_build_object('order_index', seg.order_index, 'used', seg.seg_used, 'price', seg.price_to_next)
           order by seg.order_index
         ), '[]'::json)
  into v_usage
  from (
    select rs.order_index, rs.price_to_next,
           coalesce(sum(b.seats), 0) as seg_used
    from route_stops rs
    left join bookings b
      on b.trip_id = p_trip_id
      and not b.cancelled
      and b.from_order <= rs.order_index
      and b.to_order > rs.order_index
    where rs.route_id = v_route_id and rs.order_index < v_max_order
    group by rs.order_index, rs.price_to_next
  ) seg;

  return json_build_object(
    'total_seats', v_total,
    'car_name', v_car_name,
    'car_notes', v_car_notes,
    'stops', v_stops,
    'segment_usage', v_usage,
    'route_total_price', v_route_price,
    'max_order', v_max_order
  );
end;
$$;

grant execute on function fn_get_trip_details(text, uuid) to anon;
