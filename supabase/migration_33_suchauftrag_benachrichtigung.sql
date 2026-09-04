-- ============================================================================
-- Migration 33: "Informiere mich, wenn neue Fahrten eingestellt werden"
-- Mitfahrer können nach einer Suche (mit ausgewähltem Start- und Zielort aus
-- den Vorschlägen) einen Suchauftrag speichern. Wird danach eine neue Fahrt
-- veröffentlicht, deren Strecke einen Punkt innerhalb von 20 km um den
-- gespeicherten Start- UND einen (später gelegenen) Punkt innerhalb von
-- 20 km um den gespeicherten Zielort hat, bekommt der Mitfahrer eine E-Mail.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

create table if not exists search_alerts (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  start_lat   numeric not null,
  start_lon   numeric not null,
  start_label text,
  dest_lat    numeric not null,
  dest_lon    numeric not null,
  dest_label  text,
  radius_km   integer not null default 20,
  created_at  timestamptz not null default now()
);

alter table search_alerts enable row level security;

drop policy if exists "admin full access" on search_alerts;
create policy "admin full access" on search_alerts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

revoke all on search_alerts from anon;

-- Distanz zwischen zwei Koordinaten in km (Luftlinie).
create or replace function fn_haversine_km(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric)
returns numeric
language sql
immutable
as $$
  select 6371 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  ));
$$;

-- ----------------------------------------------------------------------------
-- Mitfahrer: eigenen Suchauftrag speichern
-- ----------------------------------------------------------------------------
create or replace function fn_create_search_alert(
  p_token       text,
  p_start_lat   numeric,
  p_start_lon   numeric,
  p_start_label text,
  p_dest_lat    numeric,
  p_dest_lon    numeric,
  p_dest_label  text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person people%rowtype;
begin
  select * into v_person from people where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  if p_start_lat is null or p_start_lon is null or p_dest_lat is null or p_dest_lon is null then
    return json_build_object('error', 'missing_coords');
  end if;

  insert into search_alerts (person_id, start_lat, start_lon, start_label, dest_lat, dest_lon, dest_label)
  values (v_person.id, p_start_lat, p_start_lon, p_start_label, p_dest_lat, p_dest_lon, p_dest_label);

  return json_build_object('success', true);
end;
$$;

grant execute on function fn_create_search_alert(text, numeric, numeric, text, numeric, numeric, text) to anon;

-- ----------------------------------------------------------------------------
-- Fahrer: nach dem Veröffentlichen einer eigenen Fahrt herausfinden, welche
-- gespeicherten Suchaufträge dazu passen (für den E-Mail-Versand im Frontend)
-- ----------------------------------------------------------------------------
create or replace function fn_driver_find_matching_alerts(p_token text, p_trip_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver   drivers%rowtype;
  v_route_id uuid;
  v_owner    uuid;
  v_result   json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select route_id, driver_id into v_route_id, v_owner from trips where id = p_trip_id;
  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_trip');
  end if;

  select coalesce(json_agg(json_build_object('email', p.email, 'name', p.name)), '[]'::json)
  into v_result
  from search_alerts sa
  join people p on p.id = sa.person_id and p.email is not null and not p.revoked
  where exists (
    select 1
    from route_stops rs_start
    where rs_start.route_id = v_route_id
      and rs_start.latitude is not null and rs_start.longitude is not null
      and fn_haversine_km(sa.start_lat, sa.start_lon, rs_start.latitude, rs_start.longitude) <= sa.radius_km
      and exists (
        select 1 from route_stops rs_dest
        where rs_dest.route_id = v_route_id
          and rs_dest.latitude is not null and rs_dest.longitude is not null
          and rs_dest.order_index > rs_start.order_index
          and fn_haversine_km(sa.dest_lat, sa.dest_lon, rs_dest.latitude, rs_dest.longitude) <= sa.radius_km
      )
  );

  return json_build_object('matches', v_result);
end;
$$;

grant execute on function fn_driver_find_matching_alerts(text, uuid) to anon;
