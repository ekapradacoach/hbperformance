# Última entrada al portal

Hacé los pasos en orden. Si un resultado no coincide, frená y pasame lo que salió.

**No guardes en este archivo nombres, mails ni ids de alumnos: el repo es público.** Las consultas de acá devuelven solo cantidades.

Qué cambia:
- **Base:** columna nueva `profiles.last_seen_at` y función `registrar_entrada()`. El alumno no puede escribir la columna directo (la protege la lista blanca de perfiles); solo la función, que anota su propia entrada, como mucho una vez por día.
- **Portal (`app/dashboard.html`):** al abrir la app (y al volver a mirarla si quedó abierta), llama a `registrar_entrada()` una vez por día. Si falla, el portal sigue igual.
- **Admin → 📈 Métricas → Alumnos más activos:** columna nueva **"Última entrada"** al lado de "Última actividad", y una nota que explica las dos.

Empieza a juntar datos desde que se corre el SQL: lo anterior no existe, así que al principio casi todos figuran con "—".

## Parte A: SQL

### 1. Columna y función

Pegá y corré `supabase/migrations/20261116_ultima_entrada.sql` completo.

**Tiene que dar** (la consulta del final): `columna = 1`, `funcion = 1`, `con_entrada = 0`.

Volvé a correrlo: **tiene que dar lo mismo**.

### 2. Permisos

```sql
select has_function_privilege('anon', 'public.registrar_entrada()', 'execute') as anon,
       has_function_privilege('authenticated', 'public.registrar_entrada()', 'execute') as alumnos;
```

**Tiene que dar:** `anon = false`, `alumnos = true`.

## Parte B: commit

### 3. Commit y push

**Primero el SQL (Parte A), después el commit.** Igual, si el admin se publica antes, Métricas sigue funcionando (muestra "—").

Avisame y hago el commit y el push de `app/dashboard.html`, `admin/index.html`, la migración y la documentación. GitHub Pages tarda unos minutos en publicar.

## Parte C: probarlo

### 4. Con tu cuenta de alumno de prueba

1. Abrí el portal con una cuenta de alumno (la tuya de prueba). Recargá con Ctrl + F5.
2. En el SQL Editor:

```sql
select count(*) as con_entrada_hoy from profiles
where last_seen_at is not null
  and (last_seen_at at time zone 'America/Argentina/Buenos_Aires')::date = (now() at time zone 'America/Argentina/Buenos_Aires')::date;
```

**Tiene que dar:** 1 o más.

3. Admin → 📈 Métricas → Alumnos más activos → **Todos**: esa cuenta tiene la fecha de hoy en "Última entrada".

### 5. Al día siguiente

Volvé a correr la consulta del paso 4: tiene que ir subiendo a medida que los alumnos abren la app. En el ranking, "Última entrada" se va llenando.

## Volver atrás

1. Revertir el commit (portal y admin).
2. Después, `supabase/migrations/20261116_ultima_entrada_ROLLBACK.sql`: saca la función y la columna (se pierden las fechas).

Si se corre el rollback sin revertir el commit, nada se rompe: el portal ignora el error y Métricas muestra "—".
