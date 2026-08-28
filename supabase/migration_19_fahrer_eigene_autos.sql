-- ============================================================================
-- Migration 19: Fahrer können eigene Autos selbst anlegen, bearbeiten und
-- löschen (analog zu den eigenen Strecken aus Migration 18).
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

create or replace function fn_driver_list_own_cars(p_token text)
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

  select coalesce(json_agg(json_build_object('id', id, 'name', name, 'notes', notes) order by created_at desc), '[]'::json)
  into v_cars
  from cars where driver_id = v_driver.id;

  return json_build_object('cars', v_cars);
end;
$$;

grant execute on function fn_driver_list_own_cars(text) to anon;

create or replace function fn_driver_create_car(p_token text, p_name text, p_notes text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_car_id uuid;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if coalesce(trim(p_name), '') = '' then
    return json_build_object('error', 'missing_name');
  end if;

  insert into cars (name, notes, driver_id)
  values (trim(p_name), nullif(trim(p_notes), ''), v_driver.id)
  returning id into v_car_id;

  return json_build_object('success', true, 'car_id', v_car_id);
end;
$$;

grant execute on function fn_driver_create_car(text, text, text) to anon;

create or replace function fn_driver_update_car(p_token text, p_car_id uuid, p_name text, p_notes text)
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

  update cars set name = trim(p_name), notes = nullif(trim(p_notes), '')
  where id = p_car_id and driver_id = v_driver.id;

  if not found then
    return json_build_object('error', 'not_your_car');
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_car(text, uuid, text, text) to anon;

create or replace function fn_driver_delete_car(p_token text, p_car_id uuid)
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

  delete from cars where id = p_car_id and driver_id = v_driver.id;
  if not found then
    return json_build_object('error', 'not_your_car');
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_delete_car(text, uuid) to anon;
