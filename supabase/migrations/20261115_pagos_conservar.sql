-- ============================================================================
-- Finanzas, etapa 0d (2026-11-15): los pagos se conservan cuando se elimina un alumno.
-- Correr en el SQL Editor de Supabase. Rollback: 20261115_pagos_conservar_ROLLBACK.sql
-- ----------------------------------------------------------------------------
-- Antes: payments.athlete_id era NOT NULL con ON DELETE CASCADE → "Eliminar" en el admin borraba todos los pagos del
-- alumno y bajaban los ingresos de meses pasados.
-- Ahora: athlete_id admite vacío y es ON DELETE SET NULL → el pago queda (monto, fecha, programa, método) sin alumno.
-- No cambia ningún pago existente. process-payment y el admin siguen insertando igual (siempre con alumno).
-- Decisión de Erika (2026-11-15).
-- ============================================================================
do $$
declare fk text;
begin
  -- Nombre real de la FK de athlete_id (por si no es el de por defecto).
  select c.conname into fk
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.payments'::regclass and c.contype = 'f' and a.attname = 'athlete_id';
  if fk is not null then
    execute format('alter table public.payments drop constraint %I', fk);
  end if;
end $$;

alter table public.payments alter column athlete_id drop not null;
alter table public.payments
  add constraint payments_athlete_id_fkey foreign key (athlete_id) references public.profiles(id) on delete set null;

-- Verificación: tiene que decir "SET NULL" y "YES".
--   select rc.delete_rule, (select is_nullable from information_schema.columns
--            where table_schema = 'public' and table_name = 'payments' and column_name = 'athlete_id') as admite_vacio
--     from information_schema.referential_constraints rc where rc.constraint_name = 'payments_athlete_id_fkey';
