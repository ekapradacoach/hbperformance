-- Rollback de 20261115_gastos.sql: borra la tabla expenses con TODOS los gastos cargados.
-- Antes de correrlo, si querés conservarlos: select * from expenses order by month, id; (y exportá el resultado).
begin;
drop table if exists public.expenses;
commit;
