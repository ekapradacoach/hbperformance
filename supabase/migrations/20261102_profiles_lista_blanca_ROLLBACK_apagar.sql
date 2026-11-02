-- ============================================================================
-- Rollback de 20261102_profiles_lista_blanca.sql
-- Correr A MANO en el SQL Editor, en una sola ejecución. Idempotente.
-- Saca solo el trigger y su función: no cambia datos.
-- ⚠️ Vuelve a dejar abierto el hueco: un alumno puede cambiarse role, subscription_end, etc.
-- Usarlo solo si el portal o el admin dejan de poder guardar. Para volver a prender: correr de nuevo la migración.
-- ============================================================================

begin;

drop trigger if exists proteger_perfil_lista_blanca on public.profiles;
drop function if exists public.proteger_perfil_lista_blanca();

commit;
