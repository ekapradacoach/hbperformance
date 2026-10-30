-- ============================================================================
-- ROLLBACK "apagar" de 20261019_access_from.sql — ES EL QUE SE USA POR DEFECTO.
-- Correr A MANO en el SQL Editor de Supabase. Idempotente. Todo o nada (begin/commit).
-- ----------------------------------------------------------------------------
-- Apaga la ventana de acceso: borra las 3 policies restrictive nuevas y sus funciones.
-- DEJA la columna profiles.access_from (sin las policies no tiene ningún efecto), así que
-- se puede correr aunque la versión nueva de process-payment (la que setea access_from)
-- esté deployada: las altas siguen funcionando y no se pierde ninguna fecha guardada.
-- Para borrar también la columna: 20261019_access_from_ROLLBACK_completo.sql (leer su advertencia).
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

commit;
