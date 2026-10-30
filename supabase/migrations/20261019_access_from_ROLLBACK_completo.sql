-- ⚠️ NO correr este archivo si la versión nueva de process-payment (la que setea access_from) ya
--    está deployada: las altas nuevas fallarían al crear el perfil. En ese caso, correr
--    20261019_access_from_ROLLBACK_apagar.sql, que apaga la restricción sin borrar la columna.
--    Este archivo se corre únicamente después de volver process-payment a la versión anterior.
-- ============================================================================
-- ROLLBACK "completo" de 20261019_access_from.sql — deja todo como estaba antes.
-- Correr A MANO en el SQL Editor de Supabase. Idempotente. Todo o nada (begin/commit).
-- ⚠️ El paso 3 BORRA la columna access_from: se pierden las fechas guardadas.
-- ============================================================================

begin;

-- 1) Policies restrictive nuevas (las existentes no se tocan)
drop policy if exists "Ventana de acceso (access_from)" on public.planning_days;
drop policy if exists "Ventana de acceso (access_from)" on public.planning_blocks;
drop policy if exists "Ventana de acceso (access_from)" on public.exercise_links;

-- 2) Funciones helper
drop function if exists public.athlete_can_see_block(uuid);
drop function if exists public.athlete_can_see_day(uuid);
drop function if exists public.athlete_can_see_date(date);

-- 3) Columna
alter table public.profiles drop column if exists access_from;

commit;
