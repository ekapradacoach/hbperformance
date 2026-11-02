-- ============================================================================
-- Rollback liviano de 20261101_trial_datos.sql
-- Correr A MANO en el SQL Editor, en una sola ejecución. Idempotente.
-- Saca solo el trigger, su función y la policy. NO borra columnas, índices ni datos.
-- Mientras esté apagado, nada impide que un alumno edite sus datos de prueba ni que el formulario público cree un
-- pending de prueba. Para volver a prender: correr de nuevo 20261101_trial_datos.sql.
-- ============================================================================

begin;

drop trigger if exists proteger_datos_prueba on public.profiles;
drop function if exists public.proteger_datos_prueba();

drop policy if exists "Pending de prueba solo desde el servidor" on public.pending_subscriptions;

commit;
