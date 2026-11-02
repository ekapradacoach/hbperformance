-- ============================================================================
-- Rollback de 20261101_trial_datos.sql
-- Correr A MANO en el SQL Editor, en una sola ejecución. Antes, volver atrás el código que use estas columnas.
-- Se detiene sin cambiar nada si ya hay datos de prueba, para no borrarlos.
-- ============================================================================

begin;

do $$
begin
  -- Si las columnas ya no están, este rollback ya se corrió: no hay nada que revisar.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'trial_status') then
    if exists (select 1 from public.profiles where trial_status is not null or payer_id is not null)
       or exists (select 1 from public.pending_subscriptions where is_trial) then
      raise exception 'Ya hay datos de prueba o payer_id cargados. No se hizo nada: revisarlos antes de borrar.';
    end if;
  end if;
end;
$$;

drop policy if exists "Pending de prueba solo desde el servidor" on public.pending_subscriptions;
alter table public.pending_subscriptions drop column if exists is_trial;

drop trigger if exists proteger_datos_prueba on public.profiles;
drop function if exists public.proteger_datos_prueba();

drop index if exists public.profiles_payer_id_idx;
drop index if exists public.profiles_mp_subscription_id_unico;

alter table public.profiles drop constraint if exists profiles_trial_coherente;
alter table public.profiles
  drop column if exists trial_status,
  drop column if exists trial_started_at,
  drop column if exists trial_ends_at,
  drop column if exists trial_resolved_at,
  drop column if exists payer_id;

commit;
