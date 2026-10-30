-- ============================================================================
-- Detectar cruces: suscripciones de Mercado Pago vinculadas a más de un perfil.
-- SOLO LECTURA. Correr en el SQL Editor de Supabase ANTES de cada deploy de process-payment.
-- Sin filas: no hay suscripciones compartidas. Con filas: hubo un cruce; no deployar y revisar esos perfiles.
-- ============================================================================

select mp_subscription_id, count(*)
from public.profiles
where mp_subscription_id is not null
group by 1
having count(*) > 1;
