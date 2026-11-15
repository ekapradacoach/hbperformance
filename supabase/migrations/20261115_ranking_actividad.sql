-- ============================================================================
-- Finanzas, etapa 0c (2026-11-15): ranking "Alumnos más activos" calculado en la base.
-- Correr en el SQL Editor de Supabase. Rollback: 20261115_ranking_actividad_ROLLBACK.sql
-- ----------------------------------------------------------------------------
-- Problema: Métricas pedía TODO block_completions al navegador y la API de Supabase devuelve como máximo 1000 filas
-- (el 2026-11-15 había 3064): faltaban completados y el mes quedaba en 0.
-- Ahora la base devuelve una fila por alumno: completados en el rango [desde, hasta), total histórico y última vez.
-- El día se toma en hora Argentina (antes el navegador usaba el día UTC).
-- SECURITY INVOKER: corre con los permisos de quien llama, así que respeta las policies de block_completions
-- (el admin ve a todos; un alumno solo vería lo suyo). anon no la puede ejecutar.
-- ============================================================================
create or replace function public.admin_ranking_actividad(desde date, hasta date)
returns table (athlete_id uuid, mes bigint, total bigint, ultima timestamptz)
language sql stable security invoker set search_path = public as $$
  select bc.athlete_id,
         count(*) filter (where (bc.completed_at at time zone 'America/Argentina/Buenos_Aires')::date >= desde
                            and (bc.completed_at at time zone 'America/Argentina/Buenos_Aires')::date <  hasta) as mes,
         count(*) as total,
         max(bc.completed_at) as ultima
    from public.block_completions bc
   where bc.athlete_id is not null
   group by bc.athlete_id
$$;

revoke all on function public.admin_ranking_actividad(date, date) from public, anon;
grant execute on function public.admin_ranking_actividad(date, date) to authenticated;

-- Verificación (sin datos de alumnos): tiene que dar la misma suma que count(*) de la tabla.
--   select sum(total) from admin_ranking_actividad('2026-11-01', '2026-12-01');   -- desde el SQL Editor (sin RLS)
--   select count(*) from block_completions;
