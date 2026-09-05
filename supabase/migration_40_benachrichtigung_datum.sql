-- ============================================================================
-- Migration 40: Die "Informiere mich..."-Benachrichtigung berücksichtigt
-- jetzt zusätzlich Datum + Flexibilität des Suchauftrags. Ist beim
-- Suchauftrag ein Datum gesetzt, wird nur benachrichtigt, wenn das neue
-- Fahrtdatum innerhalb von [Datum - Flexibilität, Datum + Flexibilität]
-- liegt. Ohne gesetztes Datum bleibt es wie bisher rein ortsbasiert.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

create or replace function fn_driver_find_matching_alerts(p_token text, p_trip_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver    drivers%rowtype;
  v_route_id  uuid;
  v_owner     uuid;
  v_trip_date date;
  v_result    json;
begin
  select * into v_driver from drivers where invite_token = p_token and not revoked;
  if not found then
    return json_build_object('error', 'invalid_token');
  end if;

  select route_id, driver_id, trip_date into v_route_id, v_owner, v_trip_date from trips where id = p_trip_id;
  if v_owner is null or v_owner <> v_driver.id then
    return json_build_object('error', 'not_your_trip');
  end if;

  select coalesce(json_agg(json_build_object('email', p.email, 'name', p.name)), '[]'::json)
  into v_result
  from search_alerts sa
  join people p on p.id = sa.person_id and p.email is not null and not p.revoked
  where (
    sa.search_date is null
    or v_trip_date between (sa.search_date - sa.flex_days) and (sa.search_date + sa.flex_days)
  )
  and exists (
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
