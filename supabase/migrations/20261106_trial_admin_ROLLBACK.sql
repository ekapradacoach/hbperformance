-- ============================================================================
-- Rollback de 20261106_trial_admin.sql — Correr A MANO en el SQL Editor. Idempotente.
-- Saca la lectura de trial_reviews para admin y el job del aviso diario. No borra columnas ni datos.
-- ============================================================================

begin;

drop policy if exists "Admin lee casos de prueba" on public.trial_reviews;
revoke select on public.trial_reviews from authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'hb-trial-alerts';

commit;

select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'trial_reviews') as policies,
  has_table_privilege('authenticated', 'public.trial_reviews', 'select') as alumno_lee,
  (select count(*) from cron.job where jobname = 'hb-trial-alerts') as job;
