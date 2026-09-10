-- ============================================================================
-- Tabla `payments` — historial de pagos (automáticos de MP + manuales)
-- Correr en el SQL Editor de Supabase. Idempotente (create if not exists).
-- ----------------------------------------------------------------------------
-- Diseño (2026-09-10):
--  · paid_at es DATE (la fecha REAL en que pagó el alumno, elegida por el admin
--    en manuales; en automáticos = date_approved de MP convertido a hora AR).
--    Al ser DATE, el filtro por mes compara strings 'YYYY-MM-DD' sin desfase UTC.
--  · net_amount = neto real tras comisión de MP (transaction_details.net_received_amount).
--    En manuales = amount (sin comisión). Puede quedar null si la llamada a MP falla.
--  · mp_payment_id UNIQUE (null en manuales) → idempotencia del webhook (ON CONFLICT DO NOTHING).
--    Postgres permite múltiples NULL en una columna UNIQUE, así que muchos manuales conviven.
--  · prev_subscription_end = snapshot del subscription_end del atleta ANTES de que este
--    pago lo extendiera → permite revertir con seguridad si el pago se anula.
-- ============================================================================

create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  athlete_id            uuid not null references public.profiles(id) on delete cascade,
  program               text,
  amount                numeric(12,2) not null,               -- bruto
  net_amount            numeric(12,2),                        -- neto real (nullable)
  paid_at               date not null,                        -- fecha real del pago (la que elige el admin)
  type                  text not null check (type in ('alta_nueva','renovacion_manual','renovacion_automatica')),
  method                text not null check (method in ('manual','mp')),
  manual_channel        text check (manual_channel in ('transferencia','suscripcion_mp_vieja')),
  created_by            uuid references public.profiles(id),  -- admin que cargó el manual (null en automáticos)
  mp_payment_id         text unique,                          -- id del pago en MP (null en manuales)
  prev_subscription_end date,                                 -- snapshot para revertir si se anula
  created_at            timestamptz not null default now()    -- fecha de CARGA del registro (≠ paid_at)
);

create index if not exists payments_paid_at_idx  on public.payments (paid_at);
create index if not exists payments_athlete_idx  on public.payments (athlete_id);

-- RLS: solo admins pueden leer/escribir desde el navegador.
-- (Las Edge Functions usan service_role, que bypassa RLS → el webhook inserta igual.)
alter table public.payments enable row level security;

drop policy if exists payments_admin_all on public.payments;
create policy payments_admin_all on public.payments
  for all
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');
