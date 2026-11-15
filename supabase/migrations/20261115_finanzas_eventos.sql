-- ============================================================================
-- Finanzas, etapa 0b (2026-11-15): historial de altas y bajas (`subscription_events`).
-- Correr UNA vez en el SQL Editor de Supabase. Rollback: 20261115_finanzas_eventos_ROLLBACK.sql
-- ----------------------------------------------------------------------------
-- Para qué: hoy ninguna tabla guarda cuándo entró o se fue un alumno (una reactivación pisa las fechas del perfil y
-- "Eliminar" borra la fila). Sin esto, Métricas no puede contar bajas ni activos de meses pasados.
--
-- Cómo se llena: un TRIGGER en `profiles` anota cada cambio de estado, venga de donde venga (process-payment,
-- cancel-subscription, confirm-trial, trial-admin, create-athlete o el admin). No se toca ninguna función.
--   · alta              → perfil nuevo activo, o vuelve alguien que nunca había pagado (p. ej. una prueba que no siguió)
--   · reactivacion      → vuelve (cancelled → active) un ex alumno; o un cortado por cobro fallido arranca de nuevo
--   · baja              → pasa a cancelled. access_until = subscription_end (fin del acceso pago). Si la fecha se
--                         carga o corrige después, se actualiza en la última baja.
--   · baja_anulada      → vuelve ANTES de que termine su acceso: la baja queda anulada (voided) y no cuenta.
--   · prueba_inicio / prueba_convertida / prueba_cancelada → semana de prueba (una prueba cancelada NO es baja).
--   Métricas cuenta una baja en el mes de access_until (decisión de Erika, 2026-11-15).
-- El trigger NUNCA frena un cambio en `profiles`: si algo falla deja un WARNING en el log de Postgres y sigue.
--
-- Reconstrucción (solo si la tabla está vacía): aproximada, desde `payments` (existe desde el 2026-09-10) y el estado
-- actual de los perfiles. source = 'reconstruccion'. Ver los criterios abajo.
--
-- Permisos: RLS. Solo admin lee (get_my_role() = 'admin'). Nadie escribe desde el navegador: solo el trigger.
-- Si se borra un alumno, sus eventos quedan con athlete_id vacío (on delete set null).
-- ============================================================================

create table if not exists public.subscription_events (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid references public.profiles(id) on delete set null,
  program       text,
  kind          text not null check (kind in ('alta', 'reactivacion', 'baja', 'baja_anulada',
                                             'prueba_inicio', 'prueba_convertida', 'prueba_cancelada')),
  event_date    date not null,           -- día (hora AR) en que pasó
  access_until  date,                    -- solo baja / prueba_cancelada: hasta cuándo tiene acceso
  voided        boolean not null default false,  -- baja anulada porque volvió antes de perder el acceso
  source        text not null default 'trigger' check (source in ('trigger', 'reconstruccion')),
  created_at    timestamptz not null default now()
);
create index if not exists subscription_events_date_idx    on public.subscription_events (event_date);
create index if not exists subscription_events_athlete_idx on public.subscription_events (athlete_id, event_date);

alter table public.subscription_events enable row level security;
drop policy if exists subscription_events_admin_select on public.subscription_events;
create policy subscription_events_admin_select on public.subscription_events
  for select using (public.get_my_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------
create or replace function public.log_subscription_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  hoy        date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  had_entry  boolean;
  open_baja  uuid;
begin
  begin
    if new.role is distinct from 'athlete' then return null; end if;

    if tg_op = 'INSERT' then
      if new.trial_status = 'in_trial' then
        insert into subscription_events (athlete_id, program, kind, event_date)
        values (new.id, new.program, 'prueba_inicio',
                coalesce((new.trial_started_at at time zone 'America/Argentina/Buenos_Aires')::date, hoy));
      elsif new.subscription_status = 'active' then
        insert into subscription_events (athlete_id, program, kind, event_date) values (new.id, new.program, 'alta', hoy);
      end if;
      return null;
    end if;

    -- Semana de prueba
    if old.trial_status = 'in_trial' and new.trial_status = 'converted' then
      insert into subscription_events (athlete_id, program, kind, event_date) values (new.id, new.program, 'prueba_convertida', hoy);
    elsif old.trial_status = 'in_trial' and new.trial_status in ('cancelled', 'charge_rejected') then
      insert into subscription_events (athlete_id, program, kind, event_date, access_until)
      values (new.id, new.program, 'prueba_cancelada', hoy, new.subscription_end);
      return null;   -- una prueba que no siguió no es una baja
    end if;

    -- Baja, o corrección de la fecha de fin de una baja
    if new.subscription_status = 'cancelled' and old.subscription_status is distinct from 'cancelled' then
      insert into subscription_events (athlete_id, program, kind, event_date, access_until)
      values (new.id, new.program, 'baja', hoy, new.subscription_end);
    elsif new.subscription_status = 'cancelled' and old.subscription_status = 'cancelled'
          and new.subscription_end is distinct from old.subscription_end then
      update subscription_events set access_until = new.subscription_end
       where id = (select id from subscription_events
                    where athlete_id = new.id and kind = 'baja' and not voided
                    order by event_date desc, created_at desc limit 1);
    end if;

    -- Vuelta
    if old.subscription_status = 'cancelled' and new.subscription_status = 'active' then
      select id into open_baja from subscription_events
       where athlete_id = new.id and kind = 'baja' and not voided and access_until >= hoy
       order by created_at desc limit 1;
      if open_baja is not null then
        update subscription_events set voided = true where id = open_baja;
        insert into subscription_events (athlete_id, program, kind, event_date) values (new.id, new.program, 'baja_anulada', hoy);
      else
        select exists (select 1 from subscription_events
                        where athlete_id = new.id and kind in ('alta', 'reactivacion', 'prueba_convertida')) into had_entry;
        insert into subscription_events (athlete_id, program, kind, event_date)
        values (new.id, new.program, case when had_entry then 'reactivacion' else 'alta' end, hoy);
      end if;
    elsif old.subscription_status = 'active' and new.subscription_status = 'active'
          and old.payment_grace_until is not null and old.payment_grace_until <= now()
          and new.subscription_start is distinct from old.subscription_start then
      -- Cortado por cobro fallido (sigue 'active') que vuelve con una suscripción nueva.
      insert into subscription_events (athlete_id, program, kind, event_date) values (new.id, new.program, 'reactivacion', hoy);
    end if;
  exception when others then
    raise warning 'subscription_events: no se pudo registrar el cambio de %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.log_subscription_event() from public, anon, authenticated;

drop trigger if exists profiles_subscription_events on public.profiles;
create trigger profiles_subscription_events
  after insert or update of subscription_status, subscription_end, trial_status, subscription_start
  on public.profiles
  for each row execute function public.log_subscription_event();

-- ---------------------------------------------------------------------------
-- Reconstrucción (aproximada). Solo si la tabla está vacía: correr el archivo dos veces no duplica.
--   1) Pagos: un hueco de más de 40 días entre dos pagos del mismo alumno = baja (último pago + 1 mes) y
--      reactivación (el pago que vuelve).
--   2) Entrada de cada alumno: prueba (inicio / convertida / cancelada, por sus fechas) o alta = el día más viejo
--      entre la creación del perfil y su primer pago. Una prueba cancelada que después pagó suma un alta.
--   3) Baja actual: perfiles cancelled (salvo pruebas que nunca pagaron), access_until = subscription_end.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.subscription_events) then
    raise notice 'subscription_events ya tiene filas: no se reconstruye';
    return;
  end if;

  -- 1) Huecos en los pagos
  insert into public.subscription_events (athlete_id, program, kind, event_date, access_until, source)
  select g.athlete_id, g.program, 'baja', (g.prev + interval '1 month')::date, (g.prev + interval '1 month')::date, 'reconstruccion'
    from (select pa.athlete_id, pr.program, pa.paid_at,
                 lag(pa.paid_at) over (partition by pa.athlete_id order by pa.paid_at) as prev
            from public.payments pa join public.profiles pr on pr.id = pa.athlete_id
           where pr.role = 'athlete') g
   where g.prev is not null and g.paid_at - g.prev > 40;
  insert into public.subscription_events (athlete_id, program, kind, event_date, source)
  select g.athlete_id, g.program, 'reactivacion', g.paid_at, 'reconstruccion'
    from (select pa.athlete_id, pr.program, pa.paid_at,
                 lag(pa.paid_at) over (partition by pa.athlete_id order by pa.paid_at) as prev
            from public.payments pa join public.profiles pr on pr.id = pa.athlete_id
           where pr.role = 'athlete') g
   where g.prev is not null and g.paid_at - g.prev > 40;

  -- 2) Entrada
  insert into public.subscription_events (athlete_id, program, kind, event_date, source)
  select p.id, p.program, 'prueba_inicio',
         coalesce((p.trial_started_at at time zone 'America/Argentina/Buenos_Aires')::date, (p.created_at at time zone 'America/Argentina/Buenos_Aires')::date),
         'reconstruccion'
    from public.profiles p where p.role = 'athlete' and p.trial_status is not null;
  insert into public.subscription_events (athlete_id, program, kind, event_date, source)
  select p.id, p.program, 'prueba_convertida',
         coalesce((p.trial_resolved_at at time zone 'America/Argentina/Buenos_Aires')::date, (p.created_at at time zone 'America/Argentina/Buenos_Aires')::date),
         'reconstruccion'
    from public.profiles p where p.role = 'athlete' and p.trial_status = 'converted';
  insert into public.subscription_events (athlete_id, program, kind, event_date, access_until, source)
  select p.id, p.program, 'prueba_cancelada',
         coalesce((p.trial_resolved_at at time zone 'America/Argentina/Buenos_Aires')::date, (p.created_at at time zone 'America/Argentina/Buenos_Aires')::date),
         case when not exists (select 1 from public.payments pa where pa.athlete_id = p.id) then p.subscription_end end,
         'reconstruccion'
    from public.profiles p where p.role = 'athlete' and p.trial_status in ('cancelled', 'charge_rejected');
  insert into public.subscription_events (athlete_id, program, kind, event_date, source)
  select p.id, p.program, 'alta',
         case when p.trial_status is null
              then least((p.created_at at time zone 'America/Argentina/Buenos_Aires')::date,
                         coalesce((select min(pa.paid_at) from public.payments pa where pa.athlete_id = p.id), 'infinity'::date))
              else (select min(pa.paid_at) from public.payments pa where pa.athlete_id = p.id) end,
         'reconstruccion'
    from public.profiles p
   where p.role = 'athlete'
     and coalesce(p.subscription_status, '') <> 'pending'
     and (p.trial_status is null
          or (p.trial_status in ('cancelled', 'charge_rejected') and exists (select 1 from public.payments pa where pa.athlete_id = p.id)));

  -- 3) Baja actual
  insert into public.subscription_events (athlete_id, program, kind, event_date, access_until, source)
  select p.id, p.program, 'baja',
         coalesce(p.subscription_end, (p.created_at at time zone 'America/Argentina/Buenos_Aires')::date),
         p.subscription_end, 'reconstruccion'
    from public.profiles p
   where p.role = 'athlete' and p.subscription_status = 'cancelled'
     and not (coalesce(p.trial_status, '') in ('cancelled', 'charge_rejected')
              and not exists (select 1 from public.payments pa where pa.athlete_id = p.id));
end $$;

-- ---------------------------------------------------------------------------
-- Verificación (correr después; no muestra datos de alumnos):
--   select kind, source, count(*) from subscription_events group by 1, 2 order by 1, 2;
--   select count(*) as bajas_sin_fecha from subscription_events where kind = 'baja' and access_until is null and not voided;
--   select tgname from pg_trigger where tgname = 'profiles_subscription_events';
-- ---------------------------------------------------------------------------
