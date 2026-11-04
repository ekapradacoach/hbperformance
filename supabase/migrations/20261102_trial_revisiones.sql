-- ============================================================================
-- Semana de prueba, etapa 4: casos para revisar y reserva del pending — 2026-11-02
-- Correr A MANO en el SQL Editor de Supabase, en una sola ejecución. Idempotente.
-- ANTES: tener corridas 20261101_trial_datos.sql y 20261102_trial_intentos.sql.
-- DESPUÉS: deployar confirm-trial y recién entonces process-payment.
-- Rollback: 20261102_trial_revisiones_ROLLBACK.sql
-- ----------------------------------------------------------------------------
--  · trial_reviews: suscripciones de prueba que no se pudieron dar de alta solas. Una fila por suscripción.
--    Pendiente = resolved_at vacío y creada hace más de 30 minutos.
--    RLS sin policies y sin permisos: solo la usan las Edge Functions. La policy de admin llega en la etapa 7.
--  · trial_claimed_at / trial_claimed_by: reserva del pending mientras se da el alta. Solo una llamada la obtiene,
--    y vence a los 5 minutos por si la función se corta en el medio.
--  · No cambia ningún dato existente: columnas nuevas en NULL.
-- ============================================================================

begin;

create table if not exists public.trial_reviews (
  preapproval_id text primary key,
  program text,
  reason text not null,
  email text,
  payer_id text,
  charge_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.trial_reviews enable row level security;
revoke all on public.trial_reviews from anon, authenticated;

alter table public.pending_subscriptions
  add column if not exists trial_claimed_at timestamptz,
  add column if not exists trial_claimed_by text;

create or replace function public.reservar_pending_prueba(p_pending_id uuid, p_preapproval_id text)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update public.pending_subscriptions
     set trial_claimed_at = now(), trial_claimed_by = p_preapproval_id
   where id = p_pending_id
     and is_trial
     and (trial_claimed_at is null or trial_claimed_at < now() - interval '5 minutes');
  return found;
end;
$$;

revoke all on function public.reservar_pending_prueba(uuid, text) from public, anon, authenticated;
grant execute on function public.reservar_pending_prueba(uuid, text) to service_role;

commit;
