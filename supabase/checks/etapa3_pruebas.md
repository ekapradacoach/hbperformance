# Etapa 3: pruebas de start-trial con alias (sin pagar)

Hacelas en orden: el límite es de 5 intentos por hora y las pruebas 3 a 8 cuentan cada intento.

**No guardes tu alias ni tus mails en este archivo: el repo es público.** La consola te los pide en una ventanita.
En los SQL, reemplazá `TU_ALIAS` solo en el editor de Supabase.

Si un resultado no coincide, frená y pasame lo que salió.

## Preparación

### 1. SQL: empezar con el contador de intentos en cero

Tu prueba anterior dejó intentos guardados. Esta tabla solo tiene tus pruebas, porque el formulario de prueba todavía no está publicado.

```sql
delete from public.trial_attempts;
select count(*) as intentos from public.trial_attempts;
```

**Tiene que dar:** `intentos = 0`.

### 2. SQL: confirmar que no hay pendings de prueba

```sql
select count(*) as pendings_de_prueba from public.pending_subscriptions where is_trial;
```

**Tiene que dar:** `pendings_de_prueba = 0`. Si da otro número, frená: puede ser un pending de una prueba anterior.

### 3. Consola: preparar la prueba

Abrí `https://hbperformance.fit/crossfit.html` (sin `www`), tocá F12 y andá a **Console**.
Si Chrome no te deja pegar, escribí `allow pasting` y tocá Enter.

Pegá este bloque. Te va a pedir tu alias nuevo y el mail de una cuenta que ya exista en el portal.

```js
var ALIAS = prompt('Alias nuevo, que nunca se haya usado en el portal');
var CUENTA = prompt('Mail de una cuenta de prueba que ya exista en el portal');
var probar = async (email, program) => {
  const r = await fetch('https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/start-trial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Prueba Etapa 3', email, phone: '1100000000', program }),
  });
  const d = await r.json();
  console.log(r.status, JSON.stringify(d));
  return d;
};
```

**Tiene que dar:** `undefined`. Es normal: solo prepara lo que sigue.

## Pruebas de start-trial

Cada comando se pega en la misma consola. Si recargás la página, repetí el paso 3.

La **respuesta genérica** es exactamente esta:
`200 {"ok":false,"error":"No pudimos iniciar tu prueba, escribinos"}`

### 4. Consola: alias nuevo

```js
var r1 = await probar(ALIAS, 'crossfit');
```

**Tiene que dar:** `200`, con `"ok":true`, un `pending_id` y un `init_point`.

### 5. Consola: abrir el checkout sin pagar

```js
window.open(r1.init_point, '_blank');
```

**Tiene que dar:** el checkout de MP, con estos datos:
- Nombre: `HB Performance - CrossFit - 7 días gratis`
- Precio: el de CrossFit
- 7 días gratis

**Cerrá la pestaña sin completar nada.** No inicies sesión ni cargues una tarjeta.

### 6. Consola: reintento con el mismo alias

```js
var r2 = await probar(ALIAS, 'crossfit'); console.log('mismo pending:', r2.pending_id === r1.pending_id);
```

**Tiene que dar:** `"ok":true` y `mismo pending: true`.

### 7. Consola: mail de una cuenta que ya existe

```js
await probar(CUENTA, 'crossfit');
```

**Tiene que dar:** la respuesta genérica.

### 8. Consola: otro programa

```js
await probar(ALIAS, 'hybrid');
```

**Tiene que dar:** la respuesta genérica.

### 9. Consola: mismo alias en mayúsculas (quinto intento)

```js
var r3 = await probar(ALIAS.toUpperCase(), 'crossfit'); console.log('mismo pending:', r3.pending_id === r1.pending_id);
```

**Tiene que dar:** `"ok":true` y `mismo pending: true`.

### 10. Consola: sexto intento

Es el mismo alias que funcionó recién. Ahora lo frena el límite.

```js
await probar(ALIAS, 'crossfit');
```

**Tiene que dar:** la respuesta genérica.

### 11. SQL: revisar lo que quedó guardado

```sql
select ip_hash, count(*) as intentos from public.trial_attempts group by ip_hash;
select email, program, is_trial, created_at from public.pending_subscriptions where is_trial;
```

Supabase muestra solo el resultado de la última consulta. Corré cada línea por separado: seleccionala y tocá Run.

**Tiene que dar:**
- Intentos: **una sola fila, con `intentos = 5`.** El sexto se rechaza sin guardarse. Si hay varias filas, la IP cambió entre pedidos y el límite no te frenó por la razón esperada: frená.
- Pendings: **una sola fila**, con tu alias en minúsculas, `crossfit` e `is_trial = true`.

## El formulario pago sigue funcionando

### 12. Web: formulario normal de CrossFit

En `crossfit.html`, tocá el botón de suscripción de Mercado Pago y completá el formulario con tu alias.

**Tiene que dar:** te lleva al checkout del plan pago. **Cerrá la pestaña sin pagar.**

Esto suma un evento `Lead` de prueba en Meta. No afecta nada más.

### 13. SQL: revisar los dos pendings

Reemplazá `TU_ALIAS` en el editor.

```sql
select email, program, is_trial, created_at from public.pending_subscriptions
where lower(trim(email)) = lower(trim('TU_ALIAS')) order by created_at;
```

**Tiene que dar:** dos filas, una con `is_trial = true` y otra con `is_trial = false`.

## Limpieza

### 14. Consola: borrar el dato de compra del navegador

Lo guardó el formulario del paso 12. Si no lo borrás, tu navegador podría informar una compra falsa más adelante.

```js
localStorage.removeItem('hb_purchase'); console.log('compra de prueba:', localStorage.getItem('hb_purchase'));
```

**Tiene que dar:** `compra de prueba: null`.

### 15. SQL: borrar los datos de prueba

Reemplazá `TU_ALIAS` en el editor y corré todo junto.

```sql
delete from public.pending_subscriptions where lower(trim(email)) = lower(trim('TU_ALIAS'));
delete from public.trial_attempts;
select
  (select count(*) from public.pending_subscriptions where lower(trim(email)) = lower(trim('TU_ALIAS'))) as pendings_del_alias,
  (select count(*) from public.pending_subscriptions where is_trial) as pendings_de_prueba,
  (select count(*) from public.trial_attempts) as intentos;
```

**Tiene que dar:** los tres en `0`.

## Qué pasarme

Decime qué pasos dieron lo esperado y copiá lo que salió en los que no. Si incluye tu alias, reemplazalo antes por `ALIAS`.
