-- ============================================================================
-- Semana de prueba, etapa 3: límite de intentos y un solo pending de prueba por mail — 2026-11-02
-- Correr A MANO en el SQL Editor de Supabase, en una sola ejecución. Idempotente.
-- ANTES: tener corrida 20261101_trial_datos.sql y deployado el process-payment que ignora los pendings de prueba.
-- Rollback: 20261102_trial_intentos_ROLLBACK.sql
-- ----------------------------------------------------------------------------
--  · trial_attempts: la usa solo start-trial, con service_role. La IP se guarda como hash, sin mail ni nombre.
--    RLS sin policies y sin permisos: anon y authenticated no pueden leerla ni escribirla.
--  · Índice único: un mail tiene un solo pending de prueba, sin importar mayúsculas ni el programa.
--    Evita dos pendings por doble clic. No afecta a los pendings normales: el formulario pago se puede repetir.
--  · No cambia ningún dato existente. Hoy hay 0 pendings de prueba.
-- ============================================================================

begin;

create table if not exists public.trial_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.trial_attempts enable row level security;
revoke all on public.trial_attempts from anon, authenticated;

create index if not exists trial_attempts_ip_fecha_idx
  on public.trial_attempts (ip_hash, created_at);

create unique index if not exists pending_subscriptions_trial_email_unico
  on public.pending_subscriptions (lower(trim(email)))
  where is_trial;

commit;
