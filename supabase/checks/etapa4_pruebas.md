# Etapa 4: SQL, deploy y prueba real de confirm-trial

Hacé los pasos en orden. Si un resultado no coincide, frená y pasame lo que salió.

**No guardes en este archivo tu alias, ids ni claves: el repo es público.** La consola te los pide en una ventanita.
En los SQL, reemplazá `TU_ALIAS` solo en el editor de Supabase.

## Parte A: controles previos

### 1. Terminal: simulaciones

Corré cada línea en la terminal de VS Code, desde la raíz del proyecto.

```bash
node supabase/tests/confirm-trial.sim.mjs
```

```bash
node supabase/tests/process-payment.sim.mjs
```

```bash
node supabase/tests/process-payment-pagos.sim.mjs
```

**Tiene que dar**, en la última línea de cada una: `73 de 73`, `52 de 52` y `21 de 21`.

### 2. SQL: detectar cruces

Es el contenido de `supabase/checks/detectar_cruces.sql`.

```sql
select mp_subscription_id, count(*)
from public.profiles
where mp_subscription_id is not null
group by 1
having count(*) > 1;
```

**Tiene que dar:** ninguna fila. Con filas, no deployes.

### 3. SQL: el plan de prueba sigue cargado

```sql
select key, length(value) > 0 as cargado from public.site_config where key = 'mp_trial_plan_crossfit';
```

**Tiene que dar:** una fila, con `cargado = true`.

### 4. Guardar la versión actual de process-payment para poder volver atrás

Abrí esta dirección y dejá la pestaña abierta durante toda la etapa. Es la última versión subida, la misma que está deployada:

`https://github.com/ekapradacoach/hbperformance/blob/df59ae8/supabase/functions/process-payment/index.ts`

**Tiene que dar:** el archivo, sin el texto `delegateToConfirmTrial`. Buscalo con Ctrl+F: 0 resultados.

## Parte B: el SQL

### 5. SQL: correr la migración

Abrí `supabase/migrations/20261102_trial_revisiones.sql`, copiá el archivo completo, pegalo en el SQL Editor y tocá Run.

**Tiene que dar:** `Success. No rows returned`.

### 6. SQL: verificar

```sql
select
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'trial_reviews') as rls_activo,
  has_table_privilege('anon', 'public.trial_reviews', 'select') as anon_lee,
  has_table_privilege('authenticated', 'public.trial_reviews', 'select') as alumno_lee,
  has_function_privilege('anon', 'public.reservar_pending_prueba(uuid, text)', 'execute') as anon_reserva,
  has_function_privilege('authenticated', 'public.reservar_pending_prueba(uuid, text)', 'execute') as alumno_reserva,
  has_function_privilege('service_role', 'public.reservar_pending_prueba(uuid, text)', 'execute') as servidor_reserva,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pending_subscriptions'
    and column_name in ('trial_claimed_at', 'trial_claimed_by')) as columnas_reserva,
  (select count(*) from public.pending_subscriptions where trial_claimed_at is not null) as reservas,
  (select count(*) from public.trial_reviews) as casos;
```

**Tiene que dar:**

| Columna | Valor |
|---|---|
| `rls_activo` | `true` |
| `anon_lee` | `false` |
| `alumno_lee` | `false` |
| `anon_reserva` | `false` |
| `alumno_reserva` | `false` |
| `servidor_reserva` | `true` |
| `columnas_reserva` | `2` |
| `reservas` | `0` |
| `casos` | `0` |

## Parte C: la clave interna

### 7. Panel: confirmar los secretos. No hay que crear ninguno

`process-payment` se identifica ante `confirm-trial` con **`SERVICE_ROLE_KEY`**, el secreto que ya tienen las dos funciones. No generes ni pegues ningún valor.

En Supabase, andá a **Edge Functions → Secrets** y mirá solo los nombres.

**Tiene que dar:** en la lista están `SERVICE_ROLE_KEY` y `MP_ACCESS_TOKEN`. Si falta alguno, frená.

## Parte D: deploy

### 8. Panel: deployar confirm-trial

1. En **Edge Functions**, creá una función nueva desde el editor, con el nombre exacto `confirm-trial`.
2. Pegá completo `supabase/functions/confirm-trial/index.ts`. Antes de deployar, mirá que la línea 2 del panel diga `Edge Function: confirm-trial`.
3. Tocá Deploy.
4. En los detalles de la función, dejá **Verify JWT en OFF**.

**Tiene que dar:** la función aparece como activa y con Verify JWT apagado.

### 9. Consola: confirmar que está el código correcto

Abrí `https://hbperformance.fit/crossfit.html` (sin `www`), tocá F12 y andá a **Console**. Si Chrome no te deja pegar, escribí `allow pasting` y tocá Enter.

```js
var CT = 'https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/confirm-trial';
var llamar = async (body) => { const r = await fetch(CT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); console.log(r.status, t); return JSON.parse(t); };
await llamar({});
```

**Tiene que dar:** `200 {"ok":false,"error":"No pudimos confirmar tu prueba, escribinos"}`.

Si dice otra cosa, se pegó otro archivo: frená antes de seguir.

### 10. SQL: detectar cruces otra vez

Repetí el paso 2.

**Tiene que dar:** ninguna fila.

### 11. Panel: deployar process-payment

1. Abrí `process-payment` en **Edge Functions**.
2. Pegá completo `supabase/functions/process-payment/index.ts`. Antes de deployar, buscá `delegateToConfirmTrial` en el panel: tiene que aparecer.
3. Tocá Deploy.
4. **Verify JWT tiene que seguir en OFF**: MP llama sin sesión. No lo cambies. Si estaba en ON, frená y avisame antes de tocarlo.

**Tiene que dar:** deploy correcto y Verify JWT apagado.

### 12. Consola: confirmar que el webhook responde

En la misma consola:

```js
var w = await fetch('https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/process-payment', { method: 'POST', body: '{}' }); console.log(w.status, await w.text());
```

**Tiene que dar:** `200 {"ok":true,"skipped":"no-resource-id"}`.

Esto solo muestra que responde. El desvío a `confirm-trial` se comprueba en el paso 18.

## Parte E: prueba real con tu MP personal

**Elegí un momento en el que puedas hacer toda la parte E y la F el mismo día.** La suscripción queda viva y cobra el precio real a los 7 días si no la cancelás.

Pagá con tu cuenta personal de MP, no con la de trabajo. Usá un alias que no tenga cuenta en el portal.

### 13. Consola: crear el pending de prueba

En la misma pestaña. Si la recargaste, repetí primero las tres líneas del paso 9.

```js
var ALIAS = prompt('Alias nuevo, que nunca se haya usado en el portal');
var st = await (await fetch('https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/start-trial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: 'Prueba Etapa 4', email: ALIAS, phone: '1100000000', program: 'crossfit' }) })).json(); console.log(JSON.stringify(st));
```

**Tiene que dar:** `"ok":true`, con `pending_id` e `init_point`.

**No cierres ni recargues esta pestaña.**

### 14. Consola: abrir el checkout

```js
window.open(st.init_point, '_blank');
```

**Tiene que dar:** el checkout con `HB Performance - CrossFit - 7 días gratis`, el precio de CrossFit y 7 días gratis.

### 15. Web: suscribirte

Entrá con tu cuenta personal de MP y confirmá la suscripción.

**Tiene que dar:** MP confirma la suscripción y **no cobra nada hoy**. Si ves un cobro, seguí directo al paso 25 para cancelar y avisame.

### 16. Web: copiar el id de la suscripción

MP te lleva a `hbperformance.fit/prueba-regreso.html`. Si muestra un botón para volver al sitio, tocalo.

**Tiene que dar:** una página de "no encontrada", porque recién se crea en la etapa 5. La dirección tiene que incluir `preapproval_id=...`.

Copiá solo el valor que sigue a `preapproval_id=`. Si la dirección no lo trae, seguí al paso 25 para cancelar y avisame.

### 17. Esperar 2 minutos

Es para que llegue el aviso de MP antes de confirmar. Así este paso prueba también el respaldo.

### 18. SQL y logs: el webhook pasó por confirm-trial

```sql
select reason, program, email, resolved_at, created_at from public.trial_reviews;
```

**Tiene que dar:** una fila con `reason = sin_identificar`, `program = crossfit` y `resolved_at` vacío. El respaldo no te reconoce porque el alias no es el mail de tu cuenta de MP, y por eso no da el alta.

En **Edge Functions → process-payment → Logs** no tiene que aparecer `No se pudo llamar a confirm-trial`.

**Si no hay filas:** esperá 5 minutos más y repetí. Si sigue vacío, frená antes del paso 19: el aviso no llegó o no pasó por el desvío. Para no quedar con la suscripción viva, seguí al paso 25.

### 19. Consola: confirmar la prueba, como hará la página de regreso

Volvé a la pestaña de `crossfit.html`.

```js
var SUB = prompt('Pegá el preapproval_id');
var c1 = await llamar({ preapproval_id: SUB.trim(), pending_id: st.pending_id });
```

**Tiene que dar:** `200 {"ok":true}`.

- Si trae `"retry":true`, esperá un minuto y repetí la última línea.
- Si da la respuesta genérica sin `retry`, mirá el motivo en el SQL del paso 18, pasámelo y seguí al paso 25.

### 20. SQL: revisar el perfil

Reemplazá `TU_ALIAS` en el editor.

```sql
select program, role, subscription_status, trial_status, trial_started_at, trial_ends_at, trial_resolved_at,
  payer_id is not null as tiene_payer, mp_subscription_id is not null as tiene_suscripcion, subscription_start, access_from
from public.profiles where lower(trim(email)) = lower(trim('TU_ALIAS'));
```

**Tiene que dar:** una sola fila, con estos valores:

| Columna | Valor |
|---|---|
| `program` | `crossfit` |
| `role` | `athlete` |
| `subscription_status` | `active` |
| `trial_status` | `in_trial` |
| `trial_started_at` | ahora |
| `trial_ends_at` | unos 7 días después |
| `trial_resolved_at` | vacío |
| `tiene_payer` | `true` |
| `tiene_suscripcion` | `true` |
| `subscription_start` | hoy |
| `access_from` | el lunes de esta semana |

### 21. SQL: caso cerrado y pending usado

```sql
select
  (select count(*) from public.trial_reviews where resolved_at is null) as casos_abiertos,
  (select count(*) from public.pending_subscriptions where lower(trim(email)) = lower(trim('TU_ALIAS'))) as pendings_del_alias;
```

**Tiene que dar:** `casos_abiertos = 0` y `pendings_del_alias = 0`.

### 22. Consola: repetir la confirmación

```js
await llamar({ preapproval_id: SUB.trim(), pending_id: st.pending_id });
```

**Tiene que dar:** `200 {"ok":true}`, y **ningún mail de invitación nuevo** en el paso 23.

### 23. Mail: la invitación

Revisá la casilla del alias, incluido spam.

**Tiene que dar:** **una sola** invitación. Es la primera vez que se prueba la invitación enviada por una función del alta.

### 24. Web: entrar al portal

En una ventana de incógnito, abrí el link de la invitación, creá una contraseña de prueba y entrá.

**Tiene que dar:** el portal abre con CrossFit y deja ver la semana actual. No debería aparecer ningún aviso de pago.

La contraseña no se guarda en ningún archivo ni me la pases.

### 25. Web: cancelar la suscripción. **No lo saltees**

En tu cuenta personal de MP, andá a **Suscripciones**, abrí `HB Performance - CrossFit - 7 días gratis` y cancelala.

**Tiene que dar:** MP la muestra como cancelada. Si no podés cancelarla, avisame hoy mismo.

### 26. SQL: la cancelación llegó

Esperá 2 minutos y corré:

```sql
select subscription_status, trial_status from public.profiles where lower(trim(email)) = lower(trim('TU_ALIAS'));
```

**Tiene que dar:** `subscription_status = cancelled`. `trial_status` sigue en `in_trial`: eso se resuelve en la etapa 6.

Si no llegaste a dar el alta, esta consulta da cero filas. Lo que importa es que MP la muestre cancelada.

## Parte F: limpieza

### 27. Panel: borrar la cuenta de prueba

En **Authentication → Users**, buscá **exactamente tu alias**, confirmá que es ese y borralo.

**Tiene que dar:** el usuario desaparece. Si da error, frená y pasámelo.

### 28. SQL: borrar los datos de prueba

Reemplazá `TU_ALIAS` en el editor y corré todo junto.

Esto borra **todos** los casos e intentos de esas dos tablas. Antes de abrir al público solo contienen tus pruebas.

```sql
delete from public.profiles where lower(trim(email)) = lower(trim('TU_ALIAS'));
delete from public.pending_subscriptions where lower(trim(email)) = lower(trim('TU_ALIAS'));
delete from public.trial_reviews;
delete from public.trial_attempts;
select
  (select count(*) from public.profiles where lower(trim(email)) = lower(trim('TU_ALIAS'))) as perfiles,
  (select count(*) from auth.users where lower(trim(email)) = lower(trim('TU_ALIAS'))) as cuentas,
  (select count(*) from public.pending_subscriptions where is_trial) as pendings_de_prueba,
  (select count(*) from public.trial_reviews) as casos,
  (select count(*) from public.trial_attempts) as intentos;
```

**Tiene que dar:** los cinco en `0`.

### 29. Control de alumnos actuales

En el próximo cobro normal de un alumno, mirá **process-payment → Logs**.

**Tiene que dar:** `Renovación (cobro recurrente OK)`, sin `confirm-trial` en ese aviso. Este paso puede quedar para otro día.

## Si algo sale mal

- **`process-payment` da errores:** pegá la versión de la pestaña del paso 4 y volvé a deployar. Hacelo primero, porque es lo que usan tus alumnos.
- **Hay que deshacer todo:** primero `process-payment` anterior, después borrá `confirm-trial` y por último corré `supabase/migrations/20261102_trial_revisiones_ROLLBACK.sql`.

## Qué no cubre esta prueba

Queda para la etapa 8:

- El respaldo del webhook con un mail que sí coincide con la cuenta de MP.
- La página de regreso real, y volver desde el celular.
- El pago con tarjeta.
- La edición de días en el panel.

## Qué pasarme

Decime qué pasos dieron lo esperado y copiá lo que salió en los que no. Reemplazá antes tu alias por `ALIAS`, y no pases ids de suscripción, `payer_id` ni contraseñas.
