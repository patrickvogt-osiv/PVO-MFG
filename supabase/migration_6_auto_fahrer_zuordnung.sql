-- ============================================================================
-- Migration 6: Autos bekommen einen zugeordneten Fahrer (Besitzer). Beim
-- Veröffentlichen einer Fahrt stehen nur die Autos des jeweils gewählten
-- Fahrers zur Auswahl.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen (nach schema.sql und den vorherigen
-- Migrationen, insbesondere migration_5_fahrer.sql).
-- ============================================================================

alter table cars add column if not exists driver_id uuid references drivers(id);

-- ----------------------------------------------------------------------------
-- Fahrer sehen und dürfen nur ihre eigenen Autos verwenden
-- ----------------------------------------------------------------------------

create or replace function fn_driver_list_cars(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_cars   json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select coalesce(json_agg(json_build_object('id', id, 'name', name, 'notes', notes) order by name), '[]'::json)
  into v_cars
  from cars where driver_id = v_driver.id;

  return json_build_object('cars', v_cars);
end;
$$;

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

  insert into trips (route_id, car_id, driver_id, trip_date, start_time, total_seats)
  values (p_route_id, p_car_id, v_driver.id, p_date, p_time, p_seats)
  returning id into v_trip_id;

  return json_build_object('success', true, 'trip_id', v_trip_id);
end;
$$;

grant execute on function fn_driver_list_cars(text)                                to anon;
grant execute on function fn_driver_create_trip(text, uuid, uuid, date, time, int) to anon;
