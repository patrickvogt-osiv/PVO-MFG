-- ============================================================================
-- Migration 20: Zusätzliche Auto-Angaben — Größe, Antrieb, Ausstattung
-- ============================================================================
-- Im Supabase SQL-Editor ausführen. Keine neuen Funktionen nötig — die Felder
-- werden direkt über die bestehende Tabelle cars gelesen/geschrieben
-- (Admin: direkter Zugriff; Fahrer: bereits vorhandene fn_driver_*_car
-- Funktionen werden unten erweitert).
-- ============================================================================

alter table cars add column if not exists size          text; -- 'Klein' | 'Kompakt' | 'Mittelklasse' | 'Oberklasse'
alter table cars add column if not exists drive_type     text; -- 'Elektro' | 'Verbrenner'
alter table cars add column if not exists has_ac         boolean not null default false;
alter table cars add column if not exists has_seat_heating boolean not null default false;
alter table cars add column if not exists has_usb        boolean not null default false;

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

  select coalesce(json_agg(
           json_build_object(
             'id', id, 'name', name, 'notes', notes, 'size', size, 'drive_type', drive_type,
             'has_ac', has_ac, 'has_seat_heating', has_seat_heating, 'has_usb', has_usb
           )
           order by created_at desc
         ), '[]'::json)
  into v_cars
  from cars where driver_id = v_driver.id;

  return json_build_object('cars', v_cars);
end;
$$;

grant execute on function fn_driver_list_own_cars(text) to anon;

-- Fahrer-Funktionen zum Anlegen/Bearbeiten eigener Autos um die neuen Felder erweitern
create or replace function fn_driver_create_car(
  p_token text, p_name text, p_notes text,
  p_size text default null, p_drive_type text default null,
  p_has_ac boolean default false, p_has_seat_heating boolean default false, p_has_usb boolean default false
)
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

  insert into cars (name, notes, driver_id, size, drive_type, has_ac, has_seat_heating, has_usb)
  values (trim(p_name), nullif(trim(p_notes), ''), v_driver.id, nullif(p_size,''), nullif(p_drive_type,''), coalesce(p_has_ac,false), coalesce(p_has_seat_heating,false), coalesce(p_has_usb,false))
  returning id into v_car_id;

  return json_build_object('success', true, 'car_id', v_car_id);
end;
$$;

grant execute on function fn_driver_create_car(text, text, text, text, text, boolean, boolean, boolean) to anon;

create or replace function fn_driver_update_car(
  p_token text, p_car_id uuid, p_name text, p_notes text,
  p_size text default null, p_drive_type text default null,
  p_has_ac boolean default false, p_has_seat_heating boolean default false, p_has_usb boolean default false
)
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

  update cars
  set name = trim(p_name),
      notes = nullif(trim(p_notes), ''),
      size = nullif(p_size, ''),
      drive_type = nullif(p_drive_type, ''),
      has_ac = coalesce(p_has_ac, false),
      has_seat_heating = coalesce(p_has_seat_heating, false),
      has_usb = coalesce(p_has_usb, false)
  where id = p_car_id and driver_id = v_driver.id;

  if not found then
    return json_build_object('error', 'not_your_car');
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_driver_update_car(text, uuid, text, text, text, text, boolean, boolean, boolean) to anon;
