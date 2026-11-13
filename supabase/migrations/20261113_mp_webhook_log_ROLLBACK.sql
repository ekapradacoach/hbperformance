-- ============================================================================
-- Rollback de 20261113_mp_webhook_log.sql — Correr A MANO en el SQL Editor. Idempotente.
-- Borra la tabla mp_webhook_log y su historial. process-payment sigue funcionando sin ella
-- (el registro falla en silencio), así que no hace falta volver la función atrás.
-- ============================================================================

begin;

drop table if exists public.mp_webhook_log;

commit;

select count(*) as tabla from information_schema.tables
where table_schema = 'public' and table_name = 'mp_webhook_log';
