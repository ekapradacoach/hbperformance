# Etapa 5: prueba real de las páginas de la semana de prueba

Hacé los pasos en orden. Si un resultado no coincide, frená y pasame lo que salió.

**No guardes en este archivo tus alias, ids ni claves: el repo es público.** En los SQL, reemplazá `ALIAS_A` y `ALIAS_B` solo en el editor de Supabase.

No hay SQL nuevo ni deploy: las funciones son las de la etapa 4. Esta etapa prueba las dos páginas de punta a punta.

**Hacé todo el mismo día.** Las dos suscripciones quedan vivas y cobran el precio real a los 7 días si no las cancelás (paso 22).

Necesitás:
- Tu cuenta personal de MP, la misma para A y B.
- Dos alias nuevos, que nunca se hayan usado en el portal.
- Chrome en la computadora. No uses ventana de incógnito: la página guarda un dato en el navegador.

## Parte A: controles previos

### 1. Web: las páginas están publicadas

Abrí estas tres direcciones (sin `www`):

1. `https://hbperformance.fit/prueba.html?programa=crossfit`
2. `https://hbperformance.fit/prueba.html`
3. `https://hbperformance.fit/prueba-regreso.html`

**Tiene que dar:**
1. "Probá CrossFit *gratis*", con **$45.000** en "Cómo funciona", en el precio y en la casilla. El botón está habilitado.
2. "Esta prueba no está disponible".
3. "No encontramos tu suscripción", con el botón de WhatsApp.

Si la 1 dice "página no encontrada", esperá 2 minutos: GitHub Pages tarda en publicar.

### 2. SQL: punto de partida

```sql
select
  (select count(*) from public.trial_reviews) as casos,
  (select count(*) from public.pending_subscriptions where is_trial) as pendings_de_prueba,
  (select count(*) from public.profiles where trial_status is not null) as perfiles_de_prueba;
```

**Tiene que dar:** los tres en `0`. Si no, pasame los números antes de seguir.

### 3. Meta: abrir "Probar eventos"

1. En **Administrador de eventos** de Meta, abrí el píxel de HB Performance y andá a **Probar eventos**.
2. En la dirección del sitio, poné `https://hbperformance.fit/prueba.html?programa=crossfit&utm_source=prueba&utm_medium=etapa5` y tocá **Abrir sitio web**.
3. Dejá la pestaña de Meta abierta y usá la pestaña nueva que se abre.

**Tiene que dar:** en Meta aparecen `PageView` y `ViewContent`.

## Parte B: alias A, camino normal

### 4. Web: formulario con un error de tipeo a propósito

En la pestaña nueva, completá:
- Nombre: `Prueba Etapa 5 A`.
- Email: tu alias A, pero terminado en `@gmail.co`. Si tu alias no es de Gmail, tipeá mal el dominio (por ejemplo `hotmial`).
- Teléfono: vacío.

Tocá afuera del campo del mail.

**Tiene que dar:** "¿Quisiste decir …?" con el mail corregido. Tocá **Sí, corregir**.

### 5. Web: validaciones

1. En "Repetí tu email", escribí el alias A con una letra cambiada y tocá **Empezar mi semana gratis**.
2. Corregilo para que sea igual al alias A y volvé a tocar el botón sin marcar la casilla.

**Tiene que dar:**
1. "Los dos mails no coinciden. Revisalos."
2. "Para seguir, marcá que entendés cuándo se cobra."

### 6. Web: confirmación del mail

Marcá la casilla y tocá **Empezar mi semana gratis**.

**Tiene que dar:** la ventana "¿Tu mail está bien?" con tu alias A escrito bien. Tocá **Sí, es correcto**.

### 7. Web: checkout de MP

**Tiene que dar:** te lleva al checkout de `HB Performance - CrossFit - 7 días gratis`, con el precio de CrossFit y 7 días gratis. En Meta aparecen `InitiateCheckout` y `Lead`.

Si en vez del checkout aparece un error rojo con WhatsApp, frená y pasámelo.

### 8. Web: suscribirte

Entrá con tu cuenta personal de MP y confirmá la suscripción. Si MP muestra un botón para volver al sitio, tocalo.

**Tiene que dar:** MP **no cobra nada hoy** y te devuelve a `hbperformance.fit/prueba-regreso.html`. Ahí ves "Confirmando tu prueba…" y después "¡Listo, ya arrancaste!".

- Si queda en "Mercado Pago todavía está procesando…", esperá: reintenta sola durante un minuto.
- Si termina en "Recibimos tu suscripción", frená y corré el SQL del paso 10.
- Si ves un cobro, seguí directo al paso 22 para cancelar y avisame.

### 9. Meta: StartTrial, sin Purchase

**Tiene que dar:** en Meta aparecen `PageView` y `StartTrial`. **No tiene que aparecer `Purchase`.**

Después recargá la página de regreso (F5).

**Tiene que dar:** sigue diciendo "¡Listo, ya arrancaste!", y en Meta aparece solo otro `PageView`, **sin un segundo `StartTrial`**.

### 10. SQL: el alta de A

Reemplazá `ALIAS_A` en el editor.

```sql
select program, subscription_status, trial_status, trial_ends_at,
  payer_id is not null as tiene_payer, mp_subscription_id is not null as tiene_suscripcion, access_from
from public.profiles where lower(trim(email)) = lower(trim('ALIAS_A'));

select
  (select count(*) from public.trial_reviews where resolved_at is null) as casos_abiertos,
  (select count(*) from public.pending_subscriptions where lower(trim(email)) = lower(trim('ALIAS_A'))) as pendings_de_a;
```

**Tiene que dar:**
- Primera consulta: una fila con `crossfit`, `active`, `in_trial`, `trial_ends_at` unos 7 días después, `tiene_payer = true`, `tiene_suscripcion = true` y `access_from` el lunes de esta semana.
- Segunda consulta: `casos_abiertos = 0` y `pendings_de_a = 0`.

### 11. Mail y portal de A

1. Revisá la casilla del alias A, incluido spam.
2. En otra ventana (puede ser incógnito), abrí el link, creá una contraseña de prueba y entrá.
3. Andá a **Perfil**. **No toques "Cancelar suscripción"**: solo mirá que esté.

**Tiene que dar:**
1. **Una sola** invitación.
2. El portal abre con CrossFit.
3. El botón "Cancelar suscripción" aparece en el perfil. Es lo que dice la página de prueba. Cancelar desde el perfil se prueba en la etapa 6.

## Parte C: alias B, misma cuenta de MP y sin el id en el navegador

Este caso prueba dos cosas: que la página pide el mail cuando el navegador no tiene el id, y que la misma cuenta de MP no puede repetir la prueba.

### 12. Web: formulario de B

Volvé a la pestaña del sitio y abrí `https://hbperformance.fit/prueba.html?programa=crossfit&utm_source=prueba&utm_medium=etapa5`.

Completá con `Prueba Etapa 5 B` y el alias B en los dos campos de mail, marcá la casilla, tocá **Empezar mi semana gratis** y después **Sí, es correcto**.

**Tiene que dar:** el checkout de MP, igual que en el paso 7. **Todavía no te suscribas.**

### 13. Consola: borrar el id guardado

Abrí **otra pestaña** con `https://hbperformance.fit/crossfit.html`, tocá F12 y andá a **Console**. Si Chrome no te deja pegar, escribí `allow pasting` y tocá Enter.

```js
localStorage.removeItem('hb_trial'); console.log(localStorage.getItem('hb_trial'));
```

**Tiene que dar:** `null`. Cerrá esa pestaña.

### 14. Web: suscribirte con B

Volvé a la pestaña del checkout y confirmá la suscripción con la **misma** cuenta personal de MP.

**Tiene que dar:** MP no cobra nada hoy y te devuelve a la página de regreso, que muestra "Un paso más" y pide el mail.

Si MP no te deja suscribirte porque ya tenés esa suscripción, hacé primero el paso 22 solo para la suscripción de A y volvé a abrir el checkout con el paso 12.

### 15. Web: el mail en la página de regreso

1. Escribí el alias B con el dominio mal (como en el paso 4), tocá afuera y después **Sí, corregir**.
2. Tocá **Confirmar**.

**Tiene que dar:**
1. "¿Quisiste decir …?" con el mail corregido.
2. "Recibimos tu suscripción", con el botón de WhatsApp y el link "¿Escribiste mal el mail? Probá de nuevo". **No tiene que decir "¡Listo!"** y en Meta **no tiene que aparecer otro `StartTrial`**.

### 16. SQL: el caso de B

Reemplazá `ALIAS_B` en el editor.

```sql
select reason, program, resolved_at is null as abierto from public.trial_reviews where lower(trim(email)) = lower(trim('ALIAS_B'));

select
  (select count(*) from public.profiles where lower(trim(email)) = lower(trim('ALIAS_B'))) as perfiles_de_b,
  (select utm_source || ' / ' || utm_medium from public.pending_subscriptions where lower(trim(email)) = lower(trim('ALIAS_B'))) as origen_de_b;
```

**Tiene que dar:**
- Primera consulta: una fila con `reason = payer_repetido`, `program = crossfit` y `abierto = true`.
- Segunda consulta: `perfiles_de_b = 0` y `origen_de_b = prueba / etapa5`.

Si `reason` dice `sin_identificar`, llegó un aviso de MP después de tu confirmación. Recargá la página de regreso: vuelve a pedir el mail. Repetí el paso 15 y después esta consulta.

### 17. Mail de B

Revisá la casilla del alias B, incluido spam.

**Tiene que dar:** **ninguna** invitación.

## Parte D: casos sueltos de la página de regreso

### 18. Web: recarga después del alta de A

Abrí la dirección exacta del paso 8, la que tiene `preapproval_id` de A. La encontrás en el historial de Chrome.

**Tiene que dar:** "¡Listo, ya arrancaste!" sin pasar por "Confirmando". Si el historial no la tiene, saltealo.

### 19. Web: dirección sin datos

Abrí `https://hbperformance.fit/prueba-regreso.html`.

**Tiene que dar:** "No encontramos tu suscripción".

### 20. Web: los botones de WhatsApp

En esa página, tocá **Escribir por WhatsApp**.

**Tiene que dar:** abre el chat con el número del negocio y el mensaje "Hola! Me suscribí a la semana de prueba y no se confirmó." **No lo mandes.**

### 21. Meta: cerrar "Probar eventos"

**Tiene que dar:** en todo el recorrido nunca apareció `Purchase`, y `StartTrial` apareció una sola vez, la del paso 9.

## Parte E: cancelar. **No lo saltees**

### 22. Web: cancelar las dos suscripciones

En tu cuenta personal de MP, andá a **Suscripciones**. Abrí cada una de `HB Performance - CrossFit - 7 días gratis` y cancelala. Tienen que ser dos.

**Tiene que dar:** MP muestra las dos como canceladas. Si no podés cancelar alguna, avisame hoy mismo.

### 23. SQL: la cancelación llegó

Esperá 2 minutos y corré, con los dos alias reemplazados:

```sql
select
  (select subscription_status from public.profiles where lower(trim(email)) = lower(trim('ALIAS_A'))) as estado_a,
  (select count(*) from public.trial_reviews where resolved_at is null) as casos_abiertos;
```

**Tiene que dar:** `estado_a = cancelled` y `casos_abiertos = 0`. El caso de B se cierra solo cuando llega la cancelación.

## Parte F: limpieza

### 24. Panel: borrar la cuenta de A

En **Authentication → Users**, buscá **exactamente el alias A**, confirmá que es ese y borralo. El alias B no tiene cuenta.

**Tiene que dar:** el usuario desaparece. Si da error, frená y pasámelo.

### 25. SQL: borrar los datos de prueba

Reemplazá los dos alias en el editor y corré todo junto.

Esto borra **todos** los casos e intentos de esas dos tablas. Antes de abrir al público solo contienen tus pruebas.

```sql
delete from public.profiles where lower(trim(email)) in (lower(trim('ALIAS_A')), lower(trim('ALIAS_B')));
delete from public.pending_subscriptions where lower(trim(email)) in (lower(trim('ALIAS_A')), lower(trim('ALIAS_B')));
delete from public.trial_reviews;
delete from public.trial_attempts;
select
  (select count(*) from public.profiles where lower(trim(email)) in (lower(trim('ALIAS_A')), lower(trim('ALIAS_B')))) as perfiles,
  (select count(*) from auth.users where lower(trim(email)) in (lower(trim('ALIAS_A')), lower(trim('ALIAS_B')))) as cuentas,
  (select count(*) from public.pending_subscriptions where is_trial) as pendings_de_prueba,
  (select count(*) from public.trial_reviews) as casos,
  (select count(*) from public.trial_attempts) as intentos;
```

**Tiene que dar:** los cinco en `0`.

### 26. Consola: limpiar el navegador

En cualquier pestaña de `hbperformance.fit`, en Console:

```js
localStorage.removeItem('hb_trial'); localStorage.removeItem('hb_trial_done'); console.log('listo');
```

**Tiene que dar:** `listo`.

## Si algo sale mal

- **Las páginas fallan:** no toca a tus alumnos, porque no están enlazadas desde el sitio. Cancelá las suscripciones (paso 22), limpiá (pasos 24 a 26) y pasame lo que salió.
- **No hace falta volver atrás ninguna función:** esta etapa no deploya nada.

## Qué no cubre esta prueba

Queda para la etapa 8:

- Volver desde el celular o desde la app de MP.
- El camino por mail con alta exitosa en real. Ya está cubierto en las simulaciones.
- El pago con tarjeta.

Queda para la etapa 6: cancelar desde el perfil durante la prueba.

## Qué pasarme

Decime qué pasos dieron lo esperado y copiá lo que salió en los que no. Reemplazá antes tus alias por `ALIAS_A` y `ALIAS_B`, y no pases ids de suscripción, `payer_id` ni contraseñas.
