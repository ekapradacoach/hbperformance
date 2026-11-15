# Finanzas, etapas 1 y 2: pagos en la ficha y gastos

Hacé los pasos en orden. Si un resultado no coincide, frená y pasame lo que salió.

**No guardes en este archivo nombres, mails ni ids de alumnos: el repo es público.**

Qué cambia:
- **Etapa 1.** En 👥 Alumnos → ficha del alumno, sección nueva **Pagos**: todos sus pagos (fecha, monto, tipo, método, neto), el total neto y bruto, y, si es de MP, los **cobros fallidos** de su suscripción actual (rechazados o en reintento, desde el 13/11/2026, cuando empezó `mp_webhook_log`). Solo lectura: editar o anular sigue en 💰 Pagos. No hay SQL nuevo.
- **Etapa 2.** Tabla nueva `expenses` (mes, categoría publicidad / otro, concepto, monto en pesos), solo admin. Vista nueva **🧾 Gastos** en el menú, debajo de 💰 Pagos: elegís el mes, ves el total, publicidad y otros (con el mes anterior al lado), y cargás, editás o borrás gastos.

**No se tocan** `payments`, `process-payment`, la semana de prueba, el portal ni las landings. No hay funciones nuevas para deployar.

## Parte A: SQL

### 1. Tabla de gastos

Pegá y corré `supabase/migrations/20261115_gastos.sql` completo.

**Tiene que dar** (la consulta del final del archivo): `tabla = 1`, `rls = true`, `policies = 1`, `gastos = 0`.

Volvé a correr el archivo completo: **tiene que dar lo mismo** (no duplica nada).

### 2. Permisos

```sql
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as permisos
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'expenses' and grantee in ('anon', 'authenticated')
group by grantee order by grantee;
```

**Tiene que dar:** una sola fila, `authenticated` con `DELETE, INSERT, SELECT, UPDATE`. Sin fila de `anon`. (Lo que puede ver cada uno lo corta la policy: solo el admin.)

## Parte B: commit

### 3. Commit y push

Avisame y hago el commit y el push de `admin/index.html`, las migraciones y la documentación. GitHub Pages tarda unos minutos en publicar.

## Parte C: en el admin

### 4. Ficha del alumno (etapa 1)

En 👥 Alumnos, abrí la ficha de:
- **un alumno de MP con varios meses:** aparece **Pagos** con el total neto en dorado, la cantidad de pagos, el bruto y la fecha del primero, y la lista con cada pago. Abajo, **Cobros fallidos en Mercado Pago**: "Ninguno registrado desde el 13/11/2026" o la lista con fecha y "Rechazado" / "En reintento".
- **un alumno manual:** la lista de pagos, sin la parte de cobros fallidos.
- **un alumno sin pagos** (si hay): "Sin pagos registrados."

Compará un alumno con 💰 Pagos: los montos de cada mes tienen que coincidir.

### 5. Gastos (etapa 2)

En 🧾 Gastos, mes actual:
1. **➕ Cargar gasto** → Publicidad, concepto "Prueba", monto 1. Aparece en la tabla y los totales suben $1.
2. **✏️** en esa fila → cambiá el monto a 2 → Guardar. El total cambia.
3. **🗑️** → Aceptar. Desaparece y los totales vuelven a como estaban.
4. **Nada en amarillo** con "¿Falta correr …?".

Después cargá los gastos reales del mes (publicidad de Meta y lo que quieras sumar en "Otro").

### 6. SQL: control

```sql
select month, category, count(*), sum(amount) from expenses group by 1, 2 order by 1, 2;
```

**Tiene que dar:** lo mismo que muestra 🧾 Gastos, mes por mes.

## Volver atrás

- **Admin:** revertir el commit (vuelve la ficha sin Pagos y se va 🧾 Gastos). Hacerlo **antes** del rollback de SQL.
- **Gastos:** `supabase/migrations/20261115_gastos_ROLLBACK.sql`. **Borra todos los gastos cargados**; si querés conservarlos, antes corré `select * from expenses order by month, id;` y exportá el resultado.
- La etapa 1 no tiene SQL: con revertir el commit alcanza.
