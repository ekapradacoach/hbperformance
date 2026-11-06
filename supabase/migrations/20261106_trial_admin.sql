-- ============================================================================
-- Semana de prueba, etapa 7: admin → Pruebas y aviso diario — 2026-11-06
-- Correr A MANO en el SQL Editor de Supabase, en una sola ejecución. Idempotente.
-- ANTES: deployar trial-alerts (Verify JWT OFF) y cargar el secreto ALERT_EMAIL en Edge Functions → Secrets.
--        Usa el mismo secreto de Vault 'trial_reminders_cron' que el mail del día 6 (etapa 6).
-- Rollback: 20261106_trial_admin_ROLLBACK.sql (saca policy, permiso y job; las columnas pueden quedar).
-- ----------------------------------------------------------------------------
-- · trial_reviews: columnas review_note (nota del admin al resolver) y resolved_by (qué admin lo resolvió).
-- · Lectura de trial_reviews SOLO para admin (get_my_role() = 'admin'). Los alumnos y anon no ven nada.
--   Las escrituras siguen siendo solo de las Edge Functions (service_role): no hay policy de escritura.
-- · Job diario 'hb-trial-alerts' a las 12:00 UTC (9:00 hora AR) que llama a trial-alerts con el secreto.
-- No cambia ningún dato existente ni toca otras tablas.
-- ============================================================================

begin;

alter table public.trial_reviews
  add column if not exists review_note text,
  add column if not exists resolved_by uuid;

grant select on public.trial_reviews to authenticated;

drop policy if exists "Admin lee casos de prueba" on public.trial_reviews;
create policy "Admin lee casos de prueba" on public.trial_reviews
  for select to authenticated
  using (public.get_my_role() = 'admin');

select cron.unschedule(jobid) from cron.job where jobname = 'hb-trial-alerts';

select cron.schedule(
  'hb-trial-alerts',
  '0 12 * * *',
  $job$
  select net.http_post(
    url := 'https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/trial-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'trial_reminders_cron')
    ),
    body := '{}'::jsonb
  );
  $job$
);

commit;
