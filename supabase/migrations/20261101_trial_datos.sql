-- ============================================================================
-- Semana de prueba, etapa 2: datos nuevos — 2026-11-01
-- Correr A MANO en el SQL Editor de Supabase, en una sola ejecución. Idempotente.
-- ANTES: correr supabase/checks/detectar_cruces.sql. Si devuelve filas, NO correr esto.
-- ANTES: tener deployado el process-payment que responde error si falla el guardado del perfil.
-- Rollback, según el caso:
--  · 20261101_trial_datos_ROLLBACK_apagar.sql: si el formulario o la edición del perfil empiezan a fallar. Saca el
--    trigger y la policy; no borra columnas, índices ni datos. Es la primera opción.
--  · 20261101_trial_datos_ROLLBACK_completo.sql: para deshacer toda la migración. También borra columnas e índices,
--    y se detiene si ya hay datos de prueba o payer_id. Antes hay que volver atrás el código que use estas columnas.
--    Es la única que saca el índice único: usarla si el índice rechaza guardados.
-- ----------------------------------------------------------------------------
-- Ningún perfil ni pending existente cambia de valor: columnas nuevas en NULL, is_trial en false.
--  · trial_status: NULL (nunca hizo prueba) | in_trial (En prueba) | cancelled (Canceló)
--    | converted (Siguió) | charge_rejected (Cobro rechazado).
--  · trial_started_at / trial_ends_at / trial_resolved_at: inicio, fin y resolución.
--  · payer_id: cuenta de MP del pagador. NO es único a propósito: un repetido queda para revisión.
--  · is_trial: solo lo crea el servidor. El formulario público no puede marcarlo.
--  · Los alumnos editan su propio perfil (nombre, foto, variante): un trigger les impide tocar estas columnas.
--  · El service_role (Edge Functions) no se limita.
-- ============================================================================

begin;

-- 1) Perfil
alter table public.profiles
  add column if not exists trial_status text,
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists trial_resolved_at timestamptz,
  add column if not exists payer_id text;

alter table public.profiles drop constraint if exists profiles_trial_coherente;
alter table public.profiles add constraint profiles_trial_coherente check (
  (trial_status is null
    and trial_started_at is null and trial_ends_at is null and trial_resolved_at is null)
  or (trial_status = 'in_trial'
    and trial_started_at is not null and trial_ends_at > trial_started_at and trial_resolved_at is null)
  or (trial_status in ('cancelled', 'converted', 'charge_rejected')
    and trial_started_at is not null and trial_ends_at > trial_started_at and trial_resolved_at is not null)
);

-- 2) Una suscripción no puede estar en dos perfiles. Si hoy hay duplicados, falla y no se aplica nada.
create unique index if not exists profiles_mp_subscription_id_unico
  on public.profiles (mp_subscription_id)
  where mp_subscription_id is not null;

-- 3) Buscar repetidos por cuenta de MP
create index if not exists profiles_payer_id_idx
  on public.profiles (payer_id)
  where payer_id is not null;

-- 4) Los alumnos no pueden cambiar sus datos de prueba
create or replace function public.proteger_datos_prueba()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated')
     and public.get_my_role() is distinct from 'admin'
     and (
       (tg_op = 'INSERT' and (new.trial_status is not null or new.trial_started_at is not null
          or new.trial_ends_at is not null or new.trial_resolved_at is not null or new.payer_id is not null))
       or (tg_op = 'UPDATE' and (new.trial_status, new.trial_started_at, new.trial_ends_at, new.trial_resolved_at, new.payer_id)
          is distinct from (old.trial_status, old.trial_started_at, old.trial_ends_at, old.trial_resolved_at, old.payer_id))
     )
  then
    raise exception 'Los datos de la prueba no se pueden modificar desde acá';
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_datos_prueba on public.profiles;
create trigger proteger_datos_prueba
  before insert or update on public.profiles
  for each row execute function public.proteger_datos_prueba();

-- 5) Pending
alter table public.pending_subscriptions
  add column if not exists is_trial boolean not null default false;

-- RESTRICTIVE: se suma a "Público crea pending", que no se toca.
drop policy if exists "Pending de prueba solo desde el servidor" on public.pending_subscriptions;
create policy "Pending de prueba solo desde el servidor" on public.pending_subscriptions
  as restrictive for insert to anon, authenticated
  with check (is_trial = false);

commit;
