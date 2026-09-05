-- ============================================================================
-- Migration 41: Mitfahrer-Telefonnummer bei fn_driver_list_trip_bookings mit
-- ausliefern, damit der Fahrer in der Buchungsübersicht einer Fahrt direkt
-- per WhatsApp mit dem Mitfahrer Kontakt aufnehmen kann.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

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

grant execute on function fn_driver_list_trip_bookings(text, uuid) to anon;
