-- ============================================================================
-- Rollback de 20261105_trial_aviso.sql — Correr A MANO en el SQL Editor. Idempotente.
-- Saca el job diario: deja de mandarse el aviso del día 6. No borra la columna ni datos (no molestan).
-- Para borrar también el secreto de Vault, hacerlo a mano desde el panel (Vault).
-- ============================================================================

select cron.unschedule(jobid) from cron.job where jobname = 'hb-trial-reminders';

select count(*) as jobs_restantes from cron.job where jobname = 'hb-trial-reminders';
