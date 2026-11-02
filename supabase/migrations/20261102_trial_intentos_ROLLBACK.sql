-- ============================================================================
-- Rollback de 20261102_trial_intentos.sql
-- Correr A MANO en el SQL Editor, en una sola ejecución. Idempotente.
-- Antes, sacar o volver atrás start-trial: sin esta tabla, la función no puede iniciar pruebas.
-- Borra el registro de intentos, que no sirve para otra cosa. No toca perfiles ni pendings.
-- ============================================================================

begin;

drop index if exists public.pending_subscriptions_trial_email_unico;
drop table if exists public.trial_attempts;

commit;
