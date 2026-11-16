-- ============================================================================
-- Última entrada al portal — 2026-11-16
-- Correr A MANO en el SQL Editor de Supabase, en una sola ejecución. Idempotente.
-- Rollback: 20261116_ultima_entrada_ROLLBACK.sql
-- ----------------------------------------------------------------------------
-- · Columna NUEVA profiles.last_seen_at: la última vez que el alumno abrió el portal (app/dashboard.html).
-- · Función NUEVA registrar_entrada(): el portal la llama al abrir. Anota la hora SOLO en el perfil de quien llama,
--   solo si es alumno y como mucho una vez por día (día de Argentina), para no escribir de más.
-- · El alumno NO puede escribir la columna directamente: el trigger de la lista blanca (20261102) la protege.
--   La función es SECURITY DEFINER y solo toca last_seen_at de auth.uid().
-- · No dispara el historial de altas y bajas (ese trigger mira solo columnas de suscripción).
-- · No cambia ningún dato existente: la columna empieza vacía para todos.
-- ============================================================================

begin;

alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.registrar_entrada()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid()
     and role = 'athlete'
     and (last_seen_at is null
          or (last_seen_at at time zone 'America/Argentina/Buenos_Aires')::date
             < (now() at time zone 'America/Argentina/Buenos_Aires')::date);
$$;

revoke all on function public.registrar_entrada() from public, anon;
grant execute on function public.registrar_entrada() to authenticated;

commit;

-- Verificación: tiene que dar columna = 1, funcion = 1, con_entrada = 0 la primera vez.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'last_seen_at') as columna,
  (select count(*) from pg_proc where proname = 'registrar_entrada') as funcion,
  (select count(*) from public.profiles where last_seen_at is not null) as con_entrada;
