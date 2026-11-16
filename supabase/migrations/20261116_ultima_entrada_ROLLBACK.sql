-- Rollback de 20261116_ultima_entrada.sql: saca la función y la columna (se pierden las fechas de última entrada).
-- Antes, revertir el commit del portal y del admin: si no, el portal llama a una función que no existe
-- (no se rompe: el error se ignora) y Métricas muestra "—" en "Última entrada".
begin;
drop function if exists public.registrar_entrada();
alter table public.profiles drop column if exists last_seen_at;
commit;
