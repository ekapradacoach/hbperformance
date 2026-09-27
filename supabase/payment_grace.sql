-- ============================================================================
-- Corte por cobro fallido basado en INTENTOS (no en plazo fijo) — 2026-09-27
-- Correr en el SQL Editor de Supabase. Idempotente.
-- ----------------------------------------------------------------------------
-- Reemplaza el plazo fijo de 3 días (que cortaba antes de que MP reintentara, caso Mariano).
--  · payment_grace_until: deadline que decide el server. El dashboard corta cuando hoy > este valor.
--      1er fallo → +15 días (backstop). 2do fallo real de MP → = ahora (corte inmediato). Éxito → null.
--  · payment_failed_attempt: retry_attempt de la invoice guardado en el 1er fallo. Sirve para deduplicar
--      reenvíos del MISMO intento (un fallo cuenta como "2do real" solo si su retry_attempt es MAYOR a este).
-- process-payment escribe ambos; el guard de dashboard.html solo lee payment_grace_until.
-- ============================================================================

alter table public.profiles
  add column if not exists payment_grace_until    timestamptz,
  add column if not exists payment_failed_attempt integer;
