-- ============================================================================
-- ROLLBACK de 20261115_finanzas_eventos.sql. Saca el trigger, la función y la tabla (con sus eventos).
-- Los perfiles no cambian: el trigger nunca los modificó. Se puede correr dos veces.
-- ⚠️ Los eventos que anotó el trigger desde que se corrió se pierden (la reconstrucción no los recupera todos).
-- ============================================================================
drop trigger if exists profiles_subscription_events on public.profiles;
drop function if exists public.log_subscription_event();
drop table if exists public.subscription_events;
