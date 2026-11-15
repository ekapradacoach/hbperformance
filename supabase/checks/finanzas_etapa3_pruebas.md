# Finanzas, etapa 3: tablero 💹 Finanzas

Hacé los pasos en orden. Si un resultado no coincide, frená y pasame lo que salió.

**No guardes en este archivo nombres, mails ni ids de alumnos: el repo es público.** Las consultas de acá devuelven solo sumas y cantidades.

Qué cambia: una vista nueva **💹 Finanzas** en el menú, debajo de 📈 Métricas. Tiene selector de mes, filtro **Grupales / Todo** y cuatro bloques (Ingresos, Alumnos, Publicidad, Rentabilidad), más la tabla "¿Cuántos se quedan?". Cada número trae su variación contra el mes anterior (% y diferencia) y un **?** que explica qué es, cómo se calcula y qué significa si sube o baja.

**No hay SQL nuevo ni funciones para deployar.** Usa lo que ya está: pagos, historial de altas y bajas (etapa 0), gastos (etapa 2) y los precios de ⚙️ Configuración. **No se tocan** pagos, alumnos, la semana de prueba ni el portal: el tablero solo lee.

## Parte A: control previo

### 1. Terminal: simulación

```bash
node supabase/tests/finanzas-tablero.sim.mjs
```

**Tiene que dar:** `64 de 64 casos OK`.

## Parte B: commit

### 2. Commit y push

Avisame y hago el commit y el push. GitHub Pages tarda unos minutos en publicar.

## Parte C: en el admin

### 3. Se ve

Admin → 💹 Finanzas, mes actual, **Grupales**:
- Arriba dice que el mes todavía no terminó.
- Aparecen los cuatro bloques con números, y en cada tarjeta una línea "▲/▼ …% · … vs octubre" (o "Sin comparación").
- Tocá un **?**: se abre la explicación; tocalo de nuevo y se cierra.
- **Nada en amarillo** con "No se pudieron leer …".

### 4. Coincide con lo que ya tenés

Elegí **octubre** (mes completo) y compará:

| En 💹 Finanzas (Grupales) | Tiene que coincidir con |
|---|---|
| Publicidad | 🧾 Gastos → octubre → Publicidad |
| Pruebas que pasan a pagar | 🧪 Pruebas → octubre → % de conversión |
| Altas y Bajas | 📈 Métricas → Evolución de alumnos → fila de octubre (Altas y Bajas) |
| Activos al cierre | 📈 Métricas → Evolución → "Activos al cierre" de octubre (puede diferir si hay asesorías activas: Métricas cuenta todo; probá con **Todo**) |

Y en el SQL Editor, cada consulta por separado:

```sql
select sum(amount) as bruto, sum(coalesce(net_amount, amount)) as neto, count(*) as pagos
from payments
where paid_at >= '2026-10-01' and paid_at < '2026-11-01'
  and program in ('crossfit', 'hybrid', 'corredores');
```

**Tiene que dar:** `bruto` = "Cobrado (bruto)", `neto` = "Te quedó (neto)" y `pagos` = la cantidad debajo de "Cobrado".

```sql
select sum(amount - net_amount) as comision
from payments
where paid_at >= '2026-10-01' and paid_at < '2026-11-01'
  and program in ('crossfit', 'hybrid', 'corredores') and method = 'mp' and net_amount is not null;
```

**Tiene que dar:** igual a "Comisión de Mercado Pago".

Tocá **Todo** y corré la primera consulta sin la línea `and program in (...)`: tiene que coincidir otra vez.

### 5. Meses sin datos

Elegí un mes anterior a septiembre de 2026: los ingresos dan $0 y varios números dicen **N/D** (no hay datos para calcularlos). Elegí un mes futuro: "Ese mes todavía no empezó."

## Qué tener en cuenta al leerlo

- Con pocos alumnos los porcentajes saltan mucho: mirá siempre el número de al lado.
- El mes en curso se compara con el anterior completo: a mitad de mes casi todo se ve "▼".
- Abajo de todo, "¿De dónde salen estos números?", tiene la lista de límites (historia corta, precios de hoy, publicidad sin separar por programa, etc.).

## Volver atrás

Revertir el commit del admin: se va 💹 Finanzas y nada más cambia. No hay SQL que deshacer.
