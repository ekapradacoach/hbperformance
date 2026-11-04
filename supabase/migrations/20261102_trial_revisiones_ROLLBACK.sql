-- ============================================================================
-- Rollback de 20261102_trial_revisiones.sql
-- Correr A MANO en el SQL Editor, en una sola ejecución. Idempotente.
-- Antes, volver atrás process-payment y sacar confirm-trial: sin esto, no pueden dar altas de prueba.
-- Borra los casos de revisión: si hay alguno sin resolver, resolvelo antes, porque esa suscripción va a cobrar.
-- No toca perfiles. En los pendings solo saca la reserva.
-- ============================================================================

begin;

drop function if exists public.reservar_pending_prueba(uuid, text);
alter table public.pending_subscriptions
  drop column if exists trial_claimed_at,
  drop column if exists trial_claimed_by;
drop table if exists public.trial_reviews;

commit;
