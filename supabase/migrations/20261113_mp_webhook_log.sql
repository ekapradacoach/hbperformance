-- ============================================================================
-- Resultados de los avisos de Mercado Pago (process-payment) — 2026-11-13
-- Correr A MANO en el SQL Editor de Supabase, en una sola ejecución. Idempotente.
-- Rollback: 20261113_mp_webhook_log_ROLLBACK.sql
-- ----------------------------------------------------------------------------
-- · Tabla NUEVA mp_webhook_log: una fila por aviso que procesa process-payment, para entender qué pasó con un
--   cobro sin depender de los logs de Supabase (duran ~1 día). Solo ids de MP y estados: SIN mails ni nombres.
-- · Escribe solo process-payment (service_role, no necesita policy). Lee solo admin (get_my_role() = 'admin').
-- · Aditiva: no cambia ninguna tabla ni dato existente. Si process-payment se deploya antes que este SQL,
--   el registro falla en silencio y el aviso se procesa igual.
-- ============================================================================

begin;

create table if not exists public.mp_webhook_log (
  id                  bigint generated always as identity primary key,
  received_at         timestamptz not null default now(),
  event_type          text,        -- subscription_preapproval / subscription_authorized_payment / payment / ...
  action              text,        -- created / updated / ...
  resource_id         text,        -- data.id del aviso
  preapproval_id      text,        -- suscripción resuelta
  payment_id          text,        -- id del pago en MP (= n° de operación), si el aviso trae cobro
  charge_status       text,        -- estado del pago en la cuota (approved / rejected / ...)
  invoice_status      text,        -- estado de la cuota (scheduled / processed / recycling)
  subscription_status text,        -- estado de la suscripción en MP al procesar
  http_status         integer,     -- respuesta dada a MP (2xx = no reintenta)
  result              text not null check (result in ('registrado', 'ya_estaba', 'cobro_sin_registrar', 'saltado', 'error')),
  reason              text         -- motivo corto (status de la respuesta), sin datos personales
);

create index if not exists mp_webhook_log_received_idx on public.mp_webhook_log (received_at desc);
create index if not exists mp_webhook_log_payment_idx  on public.mp_webhook_log (payment_id);
create index if not exists mp_webhook_log_preapproval_idx on public.mp_webhook_log (preapproval_id);

alter table public.mp_webhook_log enable row level security;

grant select on public.mp_webhook_log to authenticated;

drop policy if exists "Admin lee avisos de MP" on public.mp_webhook_log;
create policy "Admin lee avisos de MP" on public.mp_webhook_log
  for select to authenticated
  using (public.get_my_role() = 'admin');

commit;

-- Verificación: tiene que dar tabla = 1, rls = true, policies = 1.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'mp_webhook_log') as tabla,
  (select relrowsecurity from pg_class where oid = 'public.mp_webhook_log'::regclass) as rls,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'mp_webhook_log') as policies;
