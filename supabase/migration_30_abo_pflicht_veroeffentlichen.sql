-- ============================================================================
-- Migration 30: Ein Fahrer darf eine Fahrt nur veröffentlichen, wenn sein
-- Buy-Me-a-Coffee-Abo aktiv ist UND das Fahrtdatum innerhalb von 40 Tagen
-- nach dem hinterlegten "letzten Zahldatum" liegt.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

create or replace function fn_driver_create_trip(
  p_token   text,
  p_route_id uuid,
  p_car_id  uuid,
  p_date    date,
  p_time    time,
  p_seats   int
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver  drivers%rowtype;
  v_trip_id uuid;
  v_valid_until date;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if p_seats is null or p_seats < 1 then
    return json_build_object('error', 'invalid_seats');
  end if;
  if p_route_id is null or p_car_id is null or p_date is null or p_time is null then
    return json_build_object('error', 'missing_fields');
  end if;

  if not exists (select 1 from cars where id = p_car_id and driver_id = v_driver.id) then
    return json_build_object('error', 'car_not_owned');
  end if;

  if not coalesce(v_driver.bmc_subscription_active, false) then
    return json_build_object('error', 'subscription_inactive');
  end if;

  if v_driver.bmc_last_payment_date is null then
    return json_build_object('error', 'no_payment_recorded');
  end if;

  v_valid_until := v_driver.bmc_last_payment_date + 40;
  if p_date > v_valid_until then
    return json_build_object('error', 'trip_date_out_of_window', 'valid_until', v_valid_until);
  end if;

  insert into trips (route_id, car_id, driver_id, trip_date, start_time, total_seats)
  values (p_route_id, p_car_id, v_driver.id, p_date, p_time, p_seats)
  returning id into v_trip_id;

  return json_build_object('success', true, 'trip_id', v_trip_id);
end;
$$;

grant execute on function fn_driver_create_trip(text, uuid, uuid, date, time, int) to anon;
