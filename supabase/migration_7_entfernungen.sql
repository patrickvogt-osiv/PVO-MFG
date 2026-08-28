-- ============================================================================
-- Migration 7: Entfernung/Fahrzeit zwischen Streckenpunkten speichern
-- ============================================================================
-- Im Supabase SQL-Editor ausführen. Keine neuen Funktionen nötig — die Werte
-- werden direkt vom Admin-Bereich aus der route_stops-Tabelle gelesen/
-- geschrieben (dafür gilt bereits die bestehende "admin full access"-Policy).
-- ============================================================================

alter table route_stops add column if not exists distance_to_next_km  numeric;
alter table route_stops add column if not exists duration_to_next_min integer;
