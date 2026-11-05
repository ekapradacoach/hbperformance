-- ============================================================================
-- Semana de prueba, etapa 6: aviso del día 6 por mail — 2026-11-05
-- Correr A MANO en el SQL Editor de Supabase, en una sola ejecución. Idempotente.
-- ANTES:
--  · Deployar la Edge Function trial-reminders (Verify JWT OFF) y cargar el secreto CRON_SECRET en Edge Functions → Secrets.
--  · Guardar el MISMO valor en Vault, desde el editor y sin pegarlo en ningún archivo:
--      select vault.create_secret('EL_VALOR', 'trial_reminders_cron');
-- Rollback: 20261105_trial_aviso_ROLLBACK.sql (saca el job; la columna puede quedar).
-- ----------------------------------------------------------------------------
-- · profiles.trial_reminder_sent_at: cuándo se mandó el aviso. NULL = todavía no. Ningún perfil cambia de valor.
--   Los alumnos no la pueden escribir: no está en la lista blanca de proteger_perfil_lista_blanca().
-- · Job diario 'hb-trial-reminders' a las 13:00 UTC (10:00 hora AR) que llama a trial-reminders con el secreto.
-- No toca suscripciones, cobros ni accesos.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists trial_reminder_sent_at timestamptz;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Si ya existía un job con este nombre, se reemplaza.
select cron.unschedule(jobid) from cron.job where jobname = 'hb-trial-reminders';

select cron.schedule(
  'hb-trial-reminders',
  '0 13 * * *',
  $job$
  select net.http_post(
    url := 'https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/trial-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'trial_reminders_cron')
    ),
    body := '{}'::jsonb
  );
  $job$
);

commit;
