-- ROLLBACK de 20261115_ranking_actividad.sql. Antes, volver admin/index.html a la versión anterior
-- (si no, el ranking muestra "No se pudo cargar la actividad"). Se puede correr dos veces.
drop function if exists public.admin_ranking_actividad(date, date);
