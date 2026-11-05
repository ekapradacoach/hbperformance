# Etapa 5b: deploy y prueba real del alta paga desde la prueba

Si MP no aplica la semana gratis (la cuenta de MP ya la usó) y cobra la primera cuota, `confirm-trial` da el alta como **alumno pago normal**: sin campos de prueba, con el pago `alta_nueva` en Pagos, mensaje propio en la página de regreso y `Purchase` en el Pixel, sin `StartTrial`.

Hacé los pasos en orden. Si un resultado no coincide, frená y pasame lo que salió.

**No guardes en este archivo tu alias, ids ni claves: el repo es público.** En los SQL, reemplazá `TU_ALIAS` solo en el editor de Supabase.

No hay SQL nuevo. Se deploya **solo `confirm-trial`**: `process-payment` no cambia.

**Esta prueba cobra $45.000 de verdad** (con tu cuenta personal, que ya usó la prueba) y después se devuelven. Hacela completa el mismo día.

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

```bash
node supabase/tests/start-trial.sim.mjs
```

**Tiene que dar**, en la última línea de cada una: `97 de 97`, `52 de 52`, `21 de 21` y `42 de 42`.

### 2. Guardar la versión actual de confirm-trial para poder volver atrás

Abrí esta dirección y dejá la pestaña abierta durante toda la etapa. Es la versión deployada hoy:

`https://github.com/ekapradacoach/hbperformance/blob/76c477a/supabase/functions/confirm-trial/index.ts`

**Tiene que dar:** el archivo, sin el texto `registerPaidCharge`. Buscalo con Ctrl+F: 0 resultados.

### 3. SQL: punto de partida

```sql
select
  (select count(*) from public.trial_reviews) as casos,
  (select count(*) from public.pending_subscriptions where is_trial) as pendings_de_prueba,
  (select count(*) from public.profiles where trial_status is not null) as perfiles_de_prueba,
  (select count(*) from public.site_config where key = 'price_crossfit_ars' and value = '45000') as precio_ok;
```

**Tiene que dar:** `casos = 0`, `pendings_de_prueba = 0`, `perfiles_de_prueba = 0` y `precio_ok = 1`. Si el precio no está en `45000`, frená: `confirm-trial` compara el cobro con ese valor.

## Parte B: publicar y deployar

### 4. Commit y push (lo hago yo, con tu OK)

Publica las dos páginas nuevas y el código de `confirm-trial` en el repo. Esperá 2 minutos.

**Tiene que dar:** en `https://hbperformance.fit/prueba.html?programa=crossfit`, la nota del precio termina con "si ya la usaste, Mercado Pago cobra la primera cuota al suscribirte."

### 5. Panel: deployar confirm-trial

1. Abrí `confirm-trial` en **Edge Functions**.
2. Pegá completo `supabase/functions/confirm-trial/index.ts`. Antes de deployar, buscá `registerPaidCharge` en el panel: tiene que aparecer.
3. Tocá Deploy.
4. **Verify JWT tiene que seguir en OFF.** Si estaba en ON, frená y avisame.

**Tiene que dar:** deploy correcto y Verify JWT apagado.

### 6. Consola: la función responde

Abrí `https://hbperformance.fit/crossfit.html` (sin `www`), tocá F12 y andá a **Console**. Si Chrome no te deja pegar, escribí `allow pasting` y tocá Enter.

```js
var r = await fetch('https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/confirm-trial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); console.log(r.status, await r.text());
```

**Tiene que dar:** `200 {"ok":false,"error":"No pudimos confirmar tu prueba, escribinos"}`.

## Parte C: prueba real con la cuenta que ya usó la prueba

Usá tu **cuenta personal de MP** (la de la etapa 4 y del alias A del 04/11): MP ya no le da la prueba y va a cobrar. Usá un alias nuevo, sin cuenta en el portal.

### 7. Meta: abrir "Probar eventos"

Como en la etapa 5: **Administrador de eventos → Probar eventos**, con la dirección `https://hbperformance.fit/prueba.html?programa=crossfit`, y tocá **Abrir sitio web**. Usá la pestaña que se abre.

### 8. Web: formulario

Completá con `Prueba Etapa 5b`, tu alias en los dos campos de mail, marcá la casilla, tocá **Empezar mi semana gratis** y **Sí, es correcto**.

**Tiene que dar:** el checkout de MP de `HB Performance - CrossFit - 7 días gratis`. En Meta: `InitiateCheckout` y `Lead`.

### 9. Web: suscribirte

Confirmá con tu cuenta personal.

**Tiene que dar:**
- MP **cobra $45.000** (es lo esperado esta vez).
- Te devuelve a la página de regreso, que muestra **"¡Listo, ya tenés acceso!"** y "Ya habías usado tu semana gratis, así que se cobró la primera cuota."
- Si muestra "Mercado Pago todavía está procesando…", esperá: reintenta sola durante un minuto.
- Si termina en "Recibimos tu suscripción", frená y corré el SQL del paso 11.

### 10. Meta: Purchase, sin StartTrial

**Tiene que dar:** `PageView` y **`Purchase`** con valor 45000. **No tiene que aparecer `StartTrial`.**

Recargá la página de regreso (F5).

**Tiene que dar:** sigue "¡Listo, ya tenés acceso!" y en Meta solo otro `PageView`, **sin un segundo `Purchase`**.

### 11. SQL: el alta paga

Reemplazá `TU_ALIAS` en el editor.

```sql
select program, subscription_status, trial_status, trial_started_at, trial_ends_at,
  subscription_start, access_from, payer_id is not null as tiene_payer, mp_subscription_id is not null as tiene_suscripcion,
  (select string_agg(pay.type || ' ' || pay.amount || ' ' || pay.method, ', ') from public.payments pay where pay.athlete_id = p.id) as pagos
from public.profiles p where lower(trim(p.email)) = lower(trim('TU_ALIAS'));

select
  (select count(*) from public.trial_reviews where resolved_at is null) as casos_abiertos,
  (select count(*) from public.pending_subscriptions where lower(trim(email)) = lower(trim('TU_ALIAS'))) as pendings_del_alias;
```

**Tiene que dar:**

| Columna | Valor |
|---|---|
| `program` | `crossfit` |
| `subscription_status` | `active` |
| `trial_status`, `trial_started_at`, `trial_ends_at` | vacíos |
| `subscription_start` | hoy |
| `access_from` | el lunes de esta semana |
| `tiene_payer`, `tiene_suscripcion` | `true` |
| `pagos` | `alta_nueva 45000 mp`, **uno solo** |

Y en la segunda: `casos_abiertos = 0` y `pendings_del_alias = 0`.

### 12. Esperar 5 minutos y repetir el SQL del paso 11

Es para que llegue el aviso del cobro de MP.

**Tiene que dar:** lo mismo. En `pagos`, **un solo** `alta_nueva`: el aviso no tiene que duplicarlo.

En **Edge Functions → process-payment → Logs** puede aparecer `COBRO SIN REGISTRAR: primer cobro de una prueba sin vincular` si el aviso llegó antes que la página. Es esperable: ese cobro lo registra `confirm-trial`. Lo que no tiene que aparecer es `No se pudo llamar a confirm-trial`.

### 13. Admin: Pagos

En el panel de admin, andá a **Pagos**.

**Tiene que dar:** el pago de $45.000 del alias, como alta nueva.

### 14. Mail y portal

1. Revisá la casilla del alias, incluido spam.
2. En una ventana de incógnito, abrí el link, creá una contraseña de prueba y entrá.

**Tiene que dar:** **una sola** invitación; el portal abre con CrossFit, sin ningún aviso de prueba, y en **Perfil** aparece "Cancelar suscripción". **No lo toques.**

## Parte D: cancelar y devolver. **No lo saltees**

### 15. Web: cancelar la suscripción

En tu cuenta personal de MP, andá a **Suscripciones** y cancelá `HB Performance - CrossFit - 7 días gratis`.

**Tiene que dar:** MP la muestra cancelada.

### 16. Devolver los $45.000

Desde tu cuenta de trabajo: **Actividad**, abrí ese cobro y tocá **Devolver dinero**.

### 17. SQL: la cancelación llegó

Esperá 2 minutos.

```sql
select subscription_status from public.profiles where lower(trim(email)) = lower(trim('TU_ALIAS'));
```

**Tiene que dar:** `cancelled`.

## Parte E: limpieza

### 18. Panel: borrar la cuenta de prueba

En **Authentication → Users**, buscá **exactamente tu alias**, confirmá que es ese y borralo.

### 19. SQL: borrar los datos de prueba

Reemplazá `TU_ALIAS` en el editor y corré todo junto. Al borrar el perfil se borran también sus pagos.

```sql
delete from public.profiles where lower(trim(email)) = lower(trim('TU_ALIAS'));
delete from public.pending_subscriptions where lower(trim(email)) = lower(trim('TU_ALIAS'));
delete from public.trial_reviews;
delete from public.trial_attempts;
select
  (select count(*) from public.profiles where lower(trim(email)) = lower(trim('TU_ALIAS'))) as perfiles,
  (select count(*) from auth.users where lower(trim(email)) = lower(trim('TU_ALIAS'))) as cuentas,
  (select count(*) from public.payments pay where not exists (select 1 from public.profiles x where x.id = pay.athlete_id)) as pagos_sin_perfil,
  (select count(*) from public.pending_subscriptions where is_trial) as pendings_de_prueba,
  (select count(*) from public.trial_reviews) as casos,
  (select count(*) from public.trial_attempts) as intentos;
```

**Tiene que dar:** los seis en `0`. Si `pagos_sin_perfil` no da 0, no borres nada más y pasámelo.

### 20. Consola: limpiar el navegador

En cualquier pestaña de `hbperformance.fit`, en Console:

```js
localStorage.removeItem('hb_trial'); localStorage.removeItem('hb_trial_done'); console.log('listo');
```

## Si algo sale mal

- **`confirm-trial` falla:** pegá la versión de la pestaña del paso 2 y volvé a deployar. Tus alumnos no la usan: solo afecta a la prueba, que no está enlazada.
- **No hace falta tocar `process-payment`:** no cambió.

## Qué no cubre esta prueba

- **La prueba sin cobro con la versión nueva**, porque hace falta una cuenta de MP que nunca haya usado el plan. Está cubierta en las simulaciones y se prueba en real en la etapa 8.
- El cobro todavía en proceso o rechazado al volver a la página (simulaciones).
- El orden "aviso del cobro primero y página después" ya pasó en real el 04/11; ahora está en las simulaciones.

## Qué pasarme

Decime qué pasos dieron lo esperado y copiá lo que salió en los que no. Reemplazá antes tu alias por `ALIAS`, y no pases ids de suscripción, `payer_id` ni contraseñas.
