-- ============================================================================
-- Migration 38: Dauerhaftes Log aller E-Mail-Versandversuche
-- (Zeitpunkt, Adressat, Betreff, Ergebnis Erfolg/Fehler, Fehlermeldung).
-- Wird direkt aus der Edge Function "send-email" befüllt (Service-Role-
-- Zugriff, umgeht RLS automatisch — deshalb hier keine anon-Berechtigung
-- nötig, nur Admin-Lesezugriff).
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

create table if not exists email_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  recipient     text not null,
  subject       text,
  success       boolean not null,
  error_message text
);

alter table email_log enable row level security;

drop policy if exists "admin full access" on email_log;
create policy "admin full access" on email_log
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

revoke all on email_log from anon;

create index if not exists email_log_created_at_idx on email_log (created_at desc);
