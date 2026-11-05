# CONTEXTO.md — Bitácora HB Performance

Registro cronológico de lo que se va haciendo. Entrada nueva arriba o abajo según prefieras
(acá se agrega al final). Cada entrada: fecha, qué se hizo, decisiones/feedback.

---

## Estado actual (resumen rápido)
- **`index.html`** completo y funcional: navbar, hero con slideshow, nosotros, programas (3),
  asesorías (2 coaches), testimonios (3), footer.
- **Tipografía definitiva:** Inter bold (títulos, caja normal) + Playfair Display cursiva (acentos)
  + Inter (cuerpo). Ver `CLAUDE.md`.
- **Hero:** slideshow parallax con crossfade de 8 fotos (`images/img1.jpg` … `img8.jpg`).
  El **orden de aparición = el número del archivo** (el usuario reordena renombrando).
- **Pendiente:** crear sub-páginas enlazadas; reemplazar logo de texto por `logo.png`;
  optimizar peso de imágenes del hero.

---

## Bitácora

### 2026-06-12 — Creación inicial de la landing
- Se creó `index.html` completo según brief: navbar fija + hamburguesa móvil, hero full-viewport,
  secciones nosotros / programas / asesorías / testimonios, footer con aviso WodUp.
- Paleta en `:root` (negro `#0A0A0A` + dorado `#F5A800`). Placeholders grises para imágenes.
- Fade-in con IntersectionObserver, smooth scroll, responsive mobile-first.
- Fuente inicial: Barlow Condensed (títulos) + Inter (cuerpo).

### 2026-06-12 — Iteración de tipografía (varios pasos por feedback)
- ❌ Barlow Condensed no gustó.
- Probado Inter mayúsculas → "textos grandes no quedaban bien".
- Probado Oswald (condensada) → tampoco.
- El "Entrenate con" blanco grande llamaba demasiado la atención.
- ✅ **Decisión final** (a partir de referencia visual del hero de HBLab que envió el usuario):
  - Títulos: **Inter bold, caja normal**, `letter-spacing: -1px`.
  - Acentos: **Playfair Display cursiva** dorada, inline (clase `.accent`).
  - Cuerpo: Inter.
  - Hero rediseñado: **badge pill** arriba ("• Entrenamiento híbrido & coaching online")
    + título "Entrená con *propósito*" (propósito en cursiva dorada inline).
  - Se removió el logo gigante del hero y el antetítulo gris.

### 2026-06-12 — Slideshow parallax en el hero + archivos de registro
- Se reemplazó el fondo de líneas diagonales del hero por un **slideshow de fotos**:
  - 8 imágenes `images/hero-1.jpg` … `hero-8.jpg`, crossfade cada 5s (opacity 1.2s).
  - Overlay oscuro `rgba(0,0,0,0.52)` para legibilidad del texto.
  - **Parallax** en scroll a 0.3x (transform en el contenedor, con `requestAnimationFrame`).
  - **Ken Burns** (zoom 100%→105% en 10s) sobre la slide activa.
  - `object-fit: cover`; `object-position: top center` en impares (hero-1/3/5/7) y
    `center center` en pares (hero-2/4/6/8) para no cortar caras.
  - Sin flechas/dots/controles. Precarga de las 8 imágenes. Respeta `prefers-reduced-motion`.
  - z-index: slideshow 0, overlay 1, contenido 2. Se conservó todo el contenido del hero.
- Se **renombraron** las 8 imágenes existentes en `images/` a `hero-1..8.jpg`.
  - ⚠️ `hero-8.jpg` es en realidad un PNG de ~9.6 MB → conviene optimizar/convertir a JPG.
- Se crearon **`CLAUDE.md`** (guía + reglas) y **`CONTEXTO.md`** (esta bitácora).

### 2026-06-12 — Optimización de imágenes del hero
- Se optimizaron las 8 imágenes con PIL (Python): `convert('RGB')`, `exif_transpose`,
  resize a máx 1920px de ancho, JPEG `quality=82`, `optimize`, `progressive`.
- **`hero-8.jpg`**: de ~9.4 MB (era PNG) a **255 KB**. ✅ Problema de peso resuelto.
- Las demás quedaron entre 115–160 KB. Total del slideshow ahora ~1.1 MB (antes ~10.6 MB).
- Dimensiones resultantes: varias son verticales (853×1280 / 1170×1560 / 1170×2532) → confirma
  que la regla `object-position: top center` en impares ayuda a no cortar caras.

### 2026-06-12 — Calidad de imágenes + esquema de nombres img1..img8
- **Problema detectado:** la optimización anterior se guardó ENCIMA de los originales →
  se perdió detalle (sobre todo el ex `hero-8`). Aprendizaje: **no volver a sobrescribir
  originales**; trabajar sobre copias.
- El usuario volvió a cargar las imágenes en `images/` con el esquema **`img1`…`img8`**
  (decidió manejar el orden renombrando los archivos él mismo → nº de archivo = orden).
- Estado de las fuentes:
  - `img1.jpg`: 4000×2666, 716 KB (alta resolución, se ve nítida). Se unificó extensión a `.jpg`.
  - `img2`–`img8`: baja resolución de origen (853×1280 a 1170×2080). A pantalla completa el
    navegador las agranda → algo borrosas. **Limitación del original**, no de compresión.
- **Decisión:** NO re-comprimir img2–img8 (re-guardar solo agrega pérdida); se dejan en su
  calidad nativa. Para mejorarlas hace falta un original de mayor resolución.
- Se actualizó el markup del slideshow a `img1.jpg`…`img8.jpg`. `object-position`:
  `center` para `img1` (horizontal) y `top center` para `img2`–`img8` (verticales).
- **Regla a futuro:** para reordenar, el usuario renombra los archivos `imgN.jpg`
  (N = posición). El código siempre apunta a `img1`…`img8`.

### 2026-06-12 — Reconocimiento facial para encuadre del hero
- Se usó **OpenCV (Haar cascades:** frontal_default + frontal_alt2 + profileface) para detectar
  caras en cada imagen y calcular el **centroide ponderado por área** → punto focal en %.
- Resultado aplicado como `object-position` inline por imagen (reemplaza las clases pos-top/center):
  - img1 `22% 64%` · img2 `50% 30%`* · img3 `63% 33%` · img4 `56% 64%`
  - img5 `47% 56%` · img6 `50% 30%`* · img7 `50% 20%` · img8 `37% 40%`
  - (*) img2 e img6 sin detección → encuadre seguro centrado-arriba por defecto.
- Si alguna cara queda mal, se ajusta a mano el `object-position` de esa `<img>` (X% horizontal,
  Y% vertical; menor Y = más arriba).

### 2026-06-12 — Reencuadre verificado (desktop + mobile)
- La detección Haar metió falsos positivos → encuadres malos en varias. Se reemplazó por
  **revisión visual**: contact sheet de las 8 fotos + **simulación del recorte real** (object-fit
  cover) para contenedor desktop (~16:9) y mobile (~390×844), iterando hasta que la cara entre.
- **Clave entendida:** el eje que se recorta cambia según el dispositivo.
  - Desktop (ancho) → recorta vertical → manda el **Y%**.
  - Mobile (alto/angosto) → recorta horizontal → manda el **X%**.
  - Por eso cada imagen necesita X% (mobile) **e** Y% (desktop) bien puestos.
- Valores finales aplicados (verificados en ambos):
  img1 `45% 40%` · img2 `55% 26%` · img3 `68% 50%` · img4 `48% 35%` ·
  img5 `45% 28%` · img6 `58% 38%` · img7 `52% 26%` · img8 `50% 26%`.
- En mobile todas se ven bien; en desktop se bajó el Y% de img2/5/7/8 para que no corte la cabeza.

### 2026-06-12 — Preview en celular (verificación real)
- Se agregó `.claude/launch.json` (servidor estático `python -m http.server 5500`) para previsualizar.
- Se verificó el hero en viewport mobile **375×812** con capturas reales de las 8 slides:
  todas ocupan pantalla completa y mantienen a la persona/cara dentro del cuadro. ✅
- Detalle técnico encontrado: el screenshot del preview se cacheaba; se fuerza repaint con
  `window.scrollTo(0,1);scrollTo(0,0)` antes de capturar.
- El usuario aprobó el resultado del hero. **Pendiente:** reemplazar fotos por versiones de
  mayor resolución (Gemini) y luego recalcular `object-position`.

### 2026-06-12 — Logo real (código preparado)
- Navbar y footer ahora usan `<img class="logo-img" src="logo.png">` con **fallback automático**
  al texto "HB *Performance*" vía `onerror` (si el archivo no existe, no queda roto).
- CSS: `.logo-img` alto 38px (navbar) y `.logo-img--footer` 52px, ancho proporcional.
- **PENDIENTE del usuario:** dejar el archivo `logo.png` en la **raíz** del proyecto
  (junto a `index.html`). Ideal: PNG con fondo transparente, alto ≥ 200px.

### 2026-06-12 — Logo integrado (resuelto)
- El usuario subió **`logo.jpg`** (1254×1254, lockup dorado "HB PERFORMANCE" sobre fondo negro).
- Con PIL se generó **`logo.png`**: alpha = max(R,G,B) por pixel (negro→transparente,
  dorado→opaco), recortado al bounding box + 4% de padding. Resultado 1246×1180 (ratio ~1.06).
- Integrado en navbar (`.logo-img` 54px) y footer (`.logo-img--footer` 110px), centrado,
  transparente sobre fondo oscuro. Verificado en preview desktop. ✅
- Como es un lockup casi cuadrado, a alturas chicas "PERFORMANCE" se vuelve ilegible →
  por eso navbar a 54px (no 38). Originales: `logo.jpg` (fuente) + `logo.png` (el que usa la web).
- Fallback al texto sigue activo por si falta el archivo.

### 2026-06-12 — Repaso completo en celular (375×812)
- Se revisaron TODAS las secciones en mobile con capturas reales: hero, menú hamburguesa
  (abre/cierra OK), quiénes somos, programas, asesorías, testimonios (scroll horizontal OK), footer.
- **Resultado: nada roto, todo responsive y bien apilado.** ✅
- Único "pendiente visual": los placeholders grises (fotos de secciones, coaches, avatares) →
  es a propósito, hasta cargar imágenes reales.

### 2026-06-12 — Logo horizontal en navbar (más grande)
- Feedback: el lockup cuadrado se veía chico en la navbar.
- Con PIL se separó `logo.png` en **`logo-hb.png`** (la "HB", 779×485) y **`logo-perf.png`**
  (la palabra PERFORMANCE, 1152×175), detectando el hueco entre ambos por filas de alpha.
- Navbar ahora usa un **lockup horizontal** (`.logo-lockup`, flex): `.logo-hb` a 48px de alto +
  `.logo-perf` a 20px al lado. Más grande y legible. Verificado en desktop y mobile. ✅
- Footer sigue con el lockup completo `logo.png` a 110px (ahí se ve bien grande).
- Archivos de logo en raíz: `logo.jpg` (original), `logo.png` (lockup completo, footer),
  `logo-hb.png` + `logo-perf.png` (navbar). Fallback a texto si faltan.

### 2026-06-12 — "Quiénes somos": animación en vez de fotos (modelo a distancia)
- Decisión: el negocio vende **planes a distancia**, así que NO van fotos del gym físico.
  El usuario pidió una **animación divertida pero profesional de gente entrenando**.
- Se reemplazó la grilla 2×2 de placeholders por una **animación CSS/SVG pura** (`.nosotros-visual`):
  - Silueta de atleta en dorado haciendo **jumping jacks** (grupos `<line>` rotando desde las
    articulaciones con `transform-box: view-box` + `transform-origin` en píxeles del viewBox).
  - Fondo: grilla técnica con máscara radial + 2 **anillos de pulso** (`nvPulse`).
  - **Línea de ECG** (`stroke-dashoffset`) que viaja, y **chips flotantes** Ciencia/Método/Propósito.
  - Respeta `prefers-reduced-motion`. Verificado en desktop y mobile. ✅
- Sin librerías. Pendiente: feedback del usuario / posible variedad de ejercicios.

### 2026-06-12 — Sub-páginas de programas creadas (crossfit / hybrid / fuerza-corredores)
- Se crearon **3 páginas HTML** de detalle de programa, reusando el estilo real del `index.html`
  (colores, fuentes Inter+Playfair, navbar con logo horizontal, footer, botones, fade-in).
  - `crossfit.html` — "CrossFit *Program*" · $45.000/mes (+ USD 40 PayPal exterior) · CTA `#mp-crossfit`.
  - `hybrid.html` — "Hybrid *Evolution*" · incluye cards de **Niveles** (Inicial/Avanzado) y
    "Qué necesitás" · $45.000/mes · CTA `#mp-hybrid`.
  - `fuerza-corredores.html` — "Fuerza para *corredores*" · $40.000/mes · CTA `#mp-corredores`.
- Estructura común: hero corto (badge + título con acento Playfair + subtítulo) con **back-link**
  "← Volver a programas"; layout 2 columnas (izq: 2 placeholders 4:3 "foto programa" sticky en
  desktop / der: descripción + listas con **check dorado** + caja WodUp + caja de precio + CTA
  principal); banda de CTA secundario "¿Tenés dudas? Escribinos" → `#whatsapp`.
- Navbar de las sub-páginas: logo → `index.html`; links → `index.html#programas|#asesorias|#testimonios`.
- Las cards de programas del `index.html` **ya linkeaban** a estos archivos (no hubo que tocar el index).
- Placeholders de precio/CTA: `#mp-*` (Mercado Pago), `#whatsapp` (contacto). Falta enlazar los reales.
- Verificado: las 3 cargan sin errores de consola y con todo el contenido. (Las capturas del
  Browser pane estaban timeouteando, se validó por texto/consola.)
- ⚠️ Tono: directo/motivador estilo Hybrid Evolution. Plataforma = WodUp (iOS + navegador Android).

### 2026-06-12 — Doble botón de pago (MP + PayPal) en las 3 sub-páginas
- En la caja de precio de `crossfit.html`, `hybrid.html` y `fuerza-corredores.html` se reemplazó
  el CTA único por **dos botones lado a lado**:
  - **Botón 1 (Mercado Pago, ARS)** — estilo primario `btn btn-filled` (dorado):
    "Suscribirme — $XX.000 ARS" → `#mp-[programa]`.
  - **Botón 2 (PayPal, USD)** — estilo secundario `btn btn-outline` (borde): "Subscribe — USD XX"
    → `#paypal-[programa]`.
  - Valores: crossfit $45.000/USD 40 · hybrid $45.000/USD 40 · corredores $40.000/USD 35.
- CSS: `.prog-cta` pasó a `display:flex; gap:14px` con `.btn { flex:1 }`; en **≤600px** se apilan
  (`flex-direction:column`). Se unificó el `price-note` a "Suscripción mensual — Mercado Pago (ARS)
  o PayPal (exterior)."
- Verificado por texto en las 3: ambos botones y montos correctos. Placeholders `#mp-*` / `#paypal-*`
  siguen pendientes de enlazar a los links reales.

### 2026-07-18 — Fotos reales en las sub-páginas de programas
- Se reemplazaron los 2 placeholders grises de cada sub-página por `<img>` reales:
  - crossfit: `images/cross-1.jpg` (top center) + `images/cross-2.jpg` (center center).
  - hybrid: `images/hybrid-1.JPEG` (top center) + `images/hybrid-2.JPEG` (center center).
  - corredores: `images/corredores-1.JPEG` (top center) + `images/corredores-2.JPEG` (center center).
- CSS nuevo `.prog-media img`: `width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:8px`.
  Mantiene el diseño responsive (columna sticky en desktop, apilado en ≤900px).
- Se renombró `corredores-2.jpeg` → `corredores-2.JPEG` (unificar extensión; evita link roto en
  hosting case-sensitive).
- Verificado: las 6 imágenes cargan (loaded=true) con su `object-position` correcto.
- ⚠️ **Peso**: `cross-2.jpg` = 21 MB (3723×5584) y `hybrid-1.JPEG` = 12,8 MB (4000×6000) son
  demasiado pesadas para web → conviene optimizar/redimensionar (pendiente OK del usuario para no
  pisar originales).

### 2026-07-18 — Reencuadre de fotos en fuerza-corredores
- Feedback: quedaban descentradas. El `top center` de corredores-1 mostraba casi todo cielo y
  cortaba a la corredora (la persona está en la mitad-baja de la foto).
- Se simuló el recorte 4:3 con varios valores y se ajustó el `object-position`:
  - `corredores-1.JPEG` → **`center 82%`** (cuerpo entero + cabeza, mínimo cielo).
  - `corredores-2.JPEG` → **`center 35%`** (cara con aire arriba, torso y dorsal visibles).

### 2026-07-18 — Hybrid: 1ª foto "alejada" (fondo borroso)
- Feedback: `hybrid-1.JPEG` (4000×6000, plano medio) quedaba con mucho zoom en 4:3 con `cover`.
- Como es muy vertical, para "alejar" hay que mostrarla entera → nuevo patrón **`.prog-photo-fit`**:
  wrapper 4:3 con la misma imagen de fondo **borrosa** (`::before` con `blur(22px) brightness(.5)`,
  `scale(1.15)`) + la foto encima con `object-fit: contain`. Se ve la persona completa, más chica,
  y el cuadro se rellena sin barras negras.
- Solo se aplicó a hybrid-1; hybrid-2 sigue con `cover center center`.
- Patrón reutilizable para cualquier foto vertical que quede muy zoomeada en un cuadro 4:3.

### 2026-07-21 — Fix botón coach en mobile (index)
- En mobile el botón "Quiero esta asesoría →" de las coach-cards partía la flecha a una 2ª línea.
- Fix: `.coach-card .btn` a **todo el ancho** cuando las cards se apilan (≤900px) y en ≤480px
  `font-size:.9rem`, `letter-spacing:.5px`, `padding:14px 12px`, `white-space:nowrap`.
- Verificado a 400px: ambos botones en 1 línea, sin overflow.

### 2026-07-23 — Botón "Ingresar" en el navbar (acceso al portal)
- Se agregó un botón **"Ingresar"** a la derecha de los links del navbar (Programas | Asesorías |
  Testimonios), como último `<li class="nav-login">` dentro de `#navLinks`, que apunta a **`app/login.html`**.
- Estilo `a.btn-ingresar`: borde dorado `#F5A800`, fondo transparente, texto dorado, uppercase (fuente
  display); **hover** → fondo dorado + texto negro `#0A0A0A`.
- **Desktop:** separado del resto de los links por un divisor a la izquierda (`.nav-login`
  `border-left:1px solid rgba(255,255,255,.14)` + `padding-left:28px`).
- **Mobile (≤768px):** sin divisor; el `.nav-login` va centrado como **último item** del menú hamburguesa
  (padding vertical + border-top como los demás items; botón con más padding para el tap). Al estar dentro
  de `#navLinks`, el JS existente (`navLinks.querySelectorAll('a')`) ya le cierra el menú al clickear.
- **Verificado** en el Browser pane por DOM/CSS computado (las capturas timeouteaban por el slideshow del
  hero, como siempre): existe, texto "Ingresar", href `app/login.html`, es el último item; **desktop** (1280)
  → hamburguesa oculta, divisor 1px + padding 28px, borde 2px dorado, bg transparente; **mobile** (375) →
  menú abre, botón centrado (`justify-content:center`), sin divisor, borde dorado, padding 12px 34px;
  regla `:hover` = bg `var(--accent)` + color `#0A0A0A`. Sin errores de consola.

### 2026-07-23 — Footer sin aviso de WodUp
- Se **eliminó** el bloque `.notice-box` del footer de `index.html` (el aviso "📱 Nuestros programas se
  gestionan a través de WodUp… app.wodup.com"), **sin reemplazo**. El footer queda: logo → redes → copyright.
- La caja WodUp de las **sub-páginas de programa** (crossfit/hybrid/fuerza-corredores) NO se tocó — sigue ahí.
- La regla CSS `.notice-box` quedó sin usar (inofensiva); `index.html` parsea OK (`new Function`).

### 2026-07-24 — Checkout con datos previos + página de éxito post-pago
- En `crossfit.html` / `hybrid.html` / `fuerza-corredores.html`, el botón MP "Suscribirme — $XX.000 ARS"
  (`#btn-mp`) **ya NO va directo a Mercado Pago**: ahora abre un **modal** (`#payModal`) que pide nombre,
  email (requeridos) y teléfono (opcional). "Continuar al pago →" valida → **INSERT en
  `pending_subscriptions`** (`full_name, email, phone, program`) → redirige al `mp_link_<prog>` de
  `site_config`. El botón PayPal sigue yendo directo. Modal con CSS propio (`.pay-modal`), estilo landing.
- Nuevo **`pago-exitoso.html`** (raíz): ✅ "¡Gracias por suscribirte!" + aviso del email de activación +
  "revisá spam" + botón "Volver al inicio →" (`index.html`). Centrado, fondo `#0A0A0A`, dorado, favicon.
- La Edge Function `process-payment` (en Supabase, NO en el repo) la actualiza el usuario para buscar el
  `pending_subscriptions` por `program`, crear/activar el user y borrar el pending. Detalle en `app/CLAUDE.md`.
- ⚠️ Pendiente en Supabase: tabla `pending_subscriptions` + policy INSERT público (SQL en `app/CONTEXTO.md`)
  + actualizar `process-payment` + back-URL de MP → `pago-exitoso.html`. Verificado por harness (sin errores).

### 2026-07-23 — Páginas de asesoría sin precio
- En `asesoria-erika.html` y `asesoria-gonza.html` se **eliminó la sección de precio** (`.price-box` con
  "USD 150 / mes" + notas de PayPal/Mercado Pago + eyebrow "Precio"). Se reemplazó por una nota simple
  `.asesoria-nota`: "Las asesorías son personalizadas. El valor se coordina directamente con tu coach."
- Se **mantuvo el botón de WhatsApp** (`.coach-cta`, con el número y mensaje pre-cargado de cada coach).
- Las reglas CSS `.price-box` quedaron sin uso (inofensivas). El valor de la asesoría se coordina 1‑a‑1.

### 2026-07-20 — Páginas de asesorías creadas (erika / gonza)
- Se crearon **`asesoria-erika.html`** y **`asesoria-gonza.html`** con el estilo del sitio (navbar,
  footer, fuentes, botones, fade-in). Con esto **todas las sub-páginas están listas**.
- Estructura: **hero con foto del coach a pantalla** (`coach-erika.png` / `coach-gonza.png` como
  `.coach-hero-bg` cover + `.coach-hero-overlay` gradiente oscuro) con back-link "← Volver", badge,
  título "Asesoría *personalizada*" y subtítulo → intro breve → **Especialidades (acordeón de 3)** →
  **Qué incluye** (lista con emojis dorados) → **Precio** (USD 150/mes + subtexto ARS/PayPal-MP +
  aclaración tipo de cambio) → **CTA WhatsApp** (`btn-filled` ancho).
- **Acordeón:** `.acc-item`/`.acc-header`/`.acc-body`; abre/cierra con `max-height` (JS setea
  `scrollHeight`), **uno abierto a la vez**, ícono "+" que rota a "×". Verificado.
- Links CTA (WhatsApp con mensaje pre-cargado): Erika `wa.me/5491159574043`, Gonza `wa.me/5491122895924`.
- Los botones "Quiero esta asesoría" del index **ya linkeaban** a estas páginas (no hubo que tocar el index).
- ⚠️ Las fotos de coach son recortes verticales con fondo transparente; como hero a pantalla completa
  (cover) se ven a lo ancho con overlay. Erika queda bien con `cover` (`center 18%`).
- **Fix Gonza:** su foto es más alta/angosta (ratio 0.5) → con `cover` se le cortaba la cabeza.
  Se cambió a **`background-size: auto 85%; background-position: center 55%`** (muestra la figura
  entera sobre el fondo oscuro, cara despejada, con aire arriba del navbar). Simulado en Python antes
  de aplicar. En desktop se ve como retrato centrado (más angosto) — aceptable por el look oscuro.

### 2026-07-20 — Testimonios: botón "Ver más"
- Se muestran las **primeras 4** capturas; las 4 restantes (`.testi-more`) ocultas con
  `.testi-wall:not(.expanded) .testi-more { display:none }`.
- Botón `#testiToggle` (`.btn-outline`, en `.testi-more-wrap` centrado) togglea la clase `.expanded`
  del muro y cambia el texto **"Ver más" ↔ "Ver menos"** (+ `aria-expanded`). JS al final del `<script>`.
- Verificado: inicial 4 visibles → click 8 → click 4.

### 2026-07-20 — Testimonios: muro de capturas reales
- Se reemplazó la sección de testimonios (cards de relleno) por un **muro tipo mampostería** con
  8 capturas reales: `images/testimonio-1.JPEG` … `testimonio-8.JPEG` (proporciones variadas 2.54→0.86).
- ⚠️ El pedido decía `.png` pero los archivos están en **`.JPEG`** → se usó la extensión real.
- CSS: `.testi-wall` con **`column-count`** (3 desktop · 2 ≤768px · 1 ≤480px), `column-gap 20px`.
  `.testi-card`: `#1A1A1A`, `border-radius 12px`, `overflow:hidden`, sin padding, `break-inside:avoid`.
  Imagen `width:100%; height:auto` (respeta proporción). Hover: `scale(1.02)` + borde dorado + glow.
- Título "Lo que dice nuestra *comunidad*" + subtítulo "Mensajes reales de atletas que ya entrenan
  con nosotros". Fade-in aplicado al contenedor `.testi-wall` (no a cada card, para no chocar con el
  transform del hover). Imágenes con `loading="lazy"`.
- Verificado por JS: 8 imágenes cargan, columnas 3/2/1 según viewport, fade-in OK (opacity→1).
  Nota: el Browser pane está congelado (no avanza transiciones ni deja screenshotear), pero la lógica
  es correcta (al quitar la transición, opacity salta a 1).

### 2026-07-20 — Cards de programas: portada única (reemplaza .split-photo)
- Se **reemplazó todo el componente `.split-photo`** (2 fotos + diagonal + encuadre por cara) por una
  **sola imagen de portada** por card, prediseñada por el usuario:
  crossfit `card-crossfit.png` · hybrid `card-hybrid.png` · corredores `card-corredores.png`
  (las 3 son 1200×675 = 16:9, ~780 KB).
- CSS nuevo `.program-card .card-cover`: `aspect-ratio 16/9; object-fit:cover; object-position:center`.
  Bordes redondeados arriba salen del `overflow:hidden` + `border-radius` del card. Glow dorado del
  hover intacto (`.program-card:hover`).
- **Mobile (≤768px):** cards más compactas → imagen `height:200px` (aspect auto), `card-body`
  padding `18px 20px`, h3 1.5rem, gap del grid 20px. Se apilan (1 col ya desde ≤900px).
- Se eliminó todo el CSS de `.split-photo`/`.sp-half`/`.split-line` y los inline de encuadre por cara.
  Las fotos sueltas (`cross-*`, `hybrid-*`, `corredores-*`) ya NO se usan en el index (sí en las
  sub-páginas de programa).
- Verificado por JS: desktop 16:9 (362×204), mobile 200px alto, sin errores de consola.

### 2026-07-18 — Cards compuestas: 4º retoque (corredor cara / diagonal)
- Iteración: 158% cortaba por el borde derecho → 150% la diagonal le tapaba la cara ("se ve menos").
- **Clave:** la cara del chico está a la IZQ de su foto; para que quede entera y despejada de la
  diagonal (que en el medio pasa por ~x51%) hay que acercar/correr a la derecha del corte.
- Valor final: corredores-2 **`195% / 0% 18%`** (cara completa, limpia de la diagonal, centrada en su
  mitad, sin quedar tan pegada como el 175% original).

### 2026-07-18 — Cards compuestas: 3º retoque (corredor + anillas)
- Corredor der (corredores-2, el chico): achicado `175%→158%` + cara a la derecha (`0% 16%`).
- Crossfit izq (cross-1, el de las anillas): la cara está al centro de la foto, así que "achicar" y
  "mover a la izq" son opuestos. El usuario eligió **priorizar izquierda** → `118% / 100% 14%`
  (un toque más grande pero la cara bien ubicada a la izquierda).
- Valores actuales: cross-1 `118% 100% 14%` · cross-2 `170% 27% 40%` · hybrid-2 `155% 78% 62%` ·
  hybrid-1 `140% 60% 59%` · corredores-1 `130% 30% 45%` · corredores-2 `158% 0% 16%`.

### 2026-07-18 — Cards compuestas: 2º retoque (zoom out + cara wallball)
- cross ambas menos zoom, chico corredor menos zoom, y se descubrió que **hybrid-2 (izq) SÍ tiene
  cara** (el del wallball de amarillo, mirando la pelota, ~(47%,58%)) → se reencuadró para mostrarla.
- **Valores finales:** Crossfit L cross-1 `105% / 100% 11%` · R cross-2 `170% / 27% 40%` ·
  Hybrid L hybrid-2 `155% / 78% 62%` (cara wallball) · R hybrid-1 `140% / 60% 59%` (sin cambio) ·
  Corredores L corredores-1 `130% / 30% 45%` (sin cambio) · R corredores-2 `175% / 0% 17%`.

### 2026-07-18 — Cards compuestas: retoque de zoom/encuadre (feedback)
- corredor-2 estaba muy cerca → se alejó (230%→200%). cross alejadas 1-2 pts (135→120, 200→185).
  hybrid-1 no mostraba la cara → se ubicó la cara en (67%,55%) y se reencuadró.
- **Valores finales** (bg-size / bg-position):
  - Crossfit: L cross-1 `120% / 136% 13%` · R cross-2 `185% / 29% 40%`.
  - Hybrid: L hybrid-2 `130% / 82% 38%` · R hybrid-1.PNG `140% / 60% 59%` (cara visible).
  - Corredores: L corredores-1 `130% / 30% 45%` · R corredores-2 `200% / -2% 18%` (cara del chico, alejada).

### 2026-07-18 — Cards compuestas: caras detectadas y centradas por mitad
- Pedido: buscar las caras y centrarlas; en corredores la derecha debía ser la **cara del chico** (2402),
  no la señora.
- Detección con OpenCV: cross-1 cara (46,22) · cross-2 (51,41) · corredores-2 **chico (32,23)** + señora
  (77,29) · hybrid-1/hybrid-2/corredores-1 sin cara detectable (encuadre a ojo).
- Se **refactorizó `.split-photo`**: cada mitad pasó de `<img>` a **`<div class="sp-half">` con
  `background-image`**, para poder `background-size` (zoom) + `background-position` (paneo) por cara.
  Con `<img>`+cover no se podía mover una cara centrada al otro lado; con background sí.
- Valores (bg-size / bg-position) calculados por simulación para centrar cada cara en su cuña:
  - Crossfit: L cross-1 `135% / 97% 14%` · R cross-2 `200% / 30% 40%`.
  - Hybrid: L hybrid-2 `130% / 82% 38%` (medball) · R hybrid-1.PNG `140% / 42% 58%` (cara de la mina).
  - Corredores: L corredores-1 `130% / 30% 45%` · R corredores-2 `230% / 3% 19%` (**cara del chico**,
    con zoom 2.3x para traerla de x32% a la mitad derecha).
- ⚠️ El encuadre por cara es para **desktop (16:9)**. En **mobile** las mitades usan `background-size:
  cover; position:center` (con `!important`) — encuadre aproximado, no el fino por cara.

### 2026-07-18 — Ajuste de encuadre de las cards compuestas (focos)
- Feedback: "no enfoco nada" — con `top center` las fotos mostraban pared/cielo/techo, no a la persona.
- Clave del split: en 16:9 la foto (vertical) llena el ancho y se recorta en vertical → **solo importa
  el % vertical** (`object-position: center YY%`); la mitad izq/der la define el `clip-path`.
- Se simularon las cards reales (con diagonal) y se ajustó:
  - Crossfit: `cross-1` `center 15%` (cara del tipo) · `cross-2` `center center`.
  - Corredores: `corredores-1` `center 82%` (la zancada) · `corredores-2` `center 30%` (runner).
  - **Hybrid: se INVIRTIERON las fotos** (el sujeto de hybrid-2 estaba a la izq de su foto y quedaba
    cortado): izq **`hybrid-2` `center 40%`** (lanzamiento de medball) · der **`hybrid-1.PNG` `center 55%`**
    (la mina en el press, con cara visible). Así se ven las dos personas.
- Limitación del efecto: si el sujeto de una foto cae en la mitad que se recorta, no hay % que lo
  traiga; se resuelve eligiendo bien qué foto va a cada lado (por eso el swap en Hybrid).

### 2026-07-18 — Cards de programas (index): imagen compuesta con diagonal
- Se reemplazaron los 3 placeholders de las cards de programas por un componente **`.split-photo`**:
  - Dos fotos lado a lado separadas por una **diagonal dorada** (#F5A800, 3px). El corte se hace con
    `clip-path` (left `polygon(0 0,56% 0,44% 100%,0 100%)` / right complementario, ~12° de inclinación)
    y la línea es un `<svg>` con `<line>` + `vector-effect: non-scaling-stroke` (mantiene 3px).
  - Ambas fotos en **B&N** (`filter: grayscale(100%)`) → **a color al hacer hover en la card**
    (`.program-card:hover .split-photo img`), transición `filter 0.4s`.
  - Aspect **16:9** en desktop (diagonal vertical). En **≤768px** se apilan verticalmente,
    aspect **3:4** y la diagonal pasa a **horizontal** (se togglean `.line-v` / `.line-h`).
  - Fotos por card (izq `top center` / der `center center`):
    crossfit `cross-1.jpg`/`cross-2.jpg` · hybrid `hybrid-1.PNG`/`hybrid-2.JPEG` ·
    corredores `corredores-1.JPEG`/`corredores-2.JPEG`.
- ⚠️ El pedido apuntaba a `hybrid-1.JPEG`, pero ese archivo **ya no existe** (se reemplazó por
  `hybrid-1.PNG` en un cambio anterior). Se usó `hybrid-1.PNG` (el que existe, y más liviano).
- Verificado por JS: las 6 imágenes cargan, clip-paths y grayscale/hover OK en desktop y mobile.

### 2026-07-18 — Hybrid: cards de "Niveles" → opciones de plan
- Se reemplazaron las 2 cards `Inicial` / `Avanzado` por las dos opciones reales de plan
  (mismo estilo `.level-card`, sin tocar CSS):
  - **"Plan 3 días + 1 corrida"** — "Para quienes buscan equilibrio entre fuerza y running".
  - **"Plan 4 días + 1 corrida"** — "Para quienes quieren maximizar el volumen de entrenamiento".
- El rótulo (`eyebrow`) pasó de "Niveles" a **"Elegí tu plan"** (describe mejor las opciones).

### 2026-07-18 — Hybrid-1 reemplazada por PNG (revertido a cover)
- El usuario cambió la foto: `hybrid-1.JPEG` → **`hybrid-1.PNG`** (1206×1608, 3:4, ~397 KB — mucho
  más liviana que la JPEG de 12,8 MB).
- La nueva es una **escena completa** (press de banca en el gym), no un primer plano → ya no hace
  falta el truco de "alejar". Se **revirtió** a `.prog-media img` normal con `object-fit: cover`
  y `object-position: center center` (el press queda bien encuadrado). Se **eliminó** el CSS
  `.prog-photo-fit` (fondo borroso), ahora sin uso.
- ⚠️ Peso pendiente: ya solo queda `cross-2.jpg` = 21 MB para optimizar (hybrid-1 resuelto con la PNG).

### 2026-06-12 — Se eliminó la sección "Quiénes somos"
- Por decisión del usuario se **borró por completo** la sección `#nosotros` (HTML + todo el CSS
  asociado: `.nosotros-grid`, `.nosotros-text`, `.photo-grid` y toda la animación `.nosotros-visual`
  / `.nv-*` / `jj-*`). No se reemplazó por nada.
- También se quitó el link **"Nosotros"** del navbar (apuntaba a `#nosotros`, ya inexistente) y la
  regla residual en el responsive. La página fluye directo: **Hero → Programas**.

### 2026-06-12 — Fotos de coaches (asesorías) integradas
- El usuario subió `images/coach-erika.png` (433×577) y `images/coach-gonza.png` (538×1427),
  ambas **recortes con fondo transparente** (RGBA).
- Se reemplazaron los placeholders por `<img class="coach-photo">` con `object-fit: cover`,
  proporción 3:4 y un **fondo radial sutil** (`#232323`→`#0d0d0d`) detrás del recorte transparente
  para que la persona no quede flotando.
- `object-position`: Erika `50% 15%` (calza casi exacta en 3:4, con `cover`).
- Gonza: imagen muy alta (538×1427); con `cover` se veía demasiado grande/zoom → se cambió a
  **`object-fit: contain` + `object-position: 50% 100%`** (cuerpo completo, alejado, apoyado abajo).
- El usuario recortó la foto de Gonza (ahora 538×1076, ratio 0.5) y quedó pareja con Erika.
  Se ajustó el tamaño con `padding: 16% 11% 0` en el `<img>`. ⚠️ El archivo venía con un espacio
  en el nombre (`coach-gonza .png`) → se renombró a `coach-gonza.png`.
- Verificado en desktop y mobile: caras visibles, cards parejas. ✅
- Nota: `coach-erika.png` es de baja resolución (433px ancho) → en desktop se agranda un poco;
  si se consigue una más grande, mejora la nitidez.

### 2026-10-11 — Seguimiento de conversión: eventos del Pixel + UTMs en las landings de programas
- **Objetivo:** poder medir el embudo (visita → abre checkout → completa el formulario → paga) antes de
  correr Meta Ads, y saber quién entró/prerellenó el formulario sin depender de DMs.
- **Pixel (ID `1008115118926012`)**: ya estaban PageView (todas las páginas) y Purchase (`pago-exitoso.html`,
  desde `localStorage.hb_purchase`, deduplicado con `sessionStorage.hb_purchase_fired`). Se agregaron en
  `hybrid.html`, `fuerza-corredores.html` y `crossfit.html`:
  - `ViewContent` al cargar la página (`content_name`, `content_ids:[PAY_PROGRAM]`).
  - `InitiateCheckout` al abrir el modal de pago (`openPayModal`), con `value` = precio leído de `#precio-ars`
    y `currency: 'ARS'`.
  - `Lead` en `submitPay()` cuando el insert en `pending_subscriptions` salió bien (antes de ir a Mercado Pago).
  - Helpers `hbTrack()` (envuelve `fbq` en try/catch, nunca rompe el pago) y `hbPrice()`.
  - `SubscribedButtonClick` que se ve en Pixel Helper es automático de Meta, no lo agregamos nosotros.
- **UTMs:** `HB_UTM` captura `utm_source/medium/campaign/content` de la URL (máx. 100 car.) y los guarda en
  `sessionStorage.hb_utm` para que sobrevivan a la navegación interna. Se insertan junto con el pending en
  `pending_subscriptions`. **Fallback:** si el insert con UTMs falla (columnas inexistentes), reintenta sin ellas
  para no bloquear nunca un pago.
- **SQL (ya ejecutado por Erika en Supabase):** columnas `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`
  (text, nullable) en `pending_subscriptions`.
- **Convención de links:** DMs automáticos `?utm_source=instagram&utm_medium=dm&utm_campaign=corro` (y `=hibrido`);
  anuncios (cuando se corran) `utm_source=instagram&utm_medium=paid&utm_campaign=<nombre>&utm_content=<creativo>`.
  Los parámetros de URL solo hacen falta para links de anuncios; todavía no se corren ads.
- **Tests (Playwright, Supabase stubbeado):** en los 3 landings salen exactamente PageView → ViewContent →
  InitiateCheckout → Lead; insert con UTMs OK; sin UTMs el insert es el original; con columnas inexistentes
  reintenta sin UTMs y sigue al pago. Sin errores JS.
- ✅ **Deploy:** commiteado y pusheado a `main` el 2026-10-11 (GitHub Pages). Antes del push, Pixel Helper en
  hbperformance.fit mostraba solo PageView + SubscribedButtonClick (`sw.js` es push-only, no cachea).
  **Pendiente:** re-verificar con Pixel Helper que aparezcan ViewContent / InitiateCheckout / Lead en vivo.
- 📝 CLAUDE.md (sección "Tracking — Meta Pixel") actualizado con estos eventos y la captura de UTMs.
- 🔎 **Hallazgo abierto (pending_subscriptions):** `process-payment` borra el pending al terminar el alta
  (~línea 470, también como guard de idempotencia) y lo matchea por email del pagador (case-insensitive; fallback
  por recencia solo si hay un único pending en 15 min). Aun así, **una alumna compró y su fila seguía en pending**.
  Posibles causas a revisar en logs de la Edge Function: el pago se procesó por otra vía/rama (renovación o
  "webhook redundante" que no borra), el alta quedó en manual (`ALTA MANUAL REQUERIDA`), o falló el delete.
  Hasta confirmarlo, **no asumir que "pending = no pagó"**: cruzar con `profiles`/`payments`.
- Estado de los leads actuales (oct-2026, ver `pending_subscriptions` en Supabase): 1 compró; 1 lead de
  Fuerza para Corredores y 1 de CrossFit no completaron el pago. Siguiente paso sugerido: seguimiento breve a ambos.
  (Sin nombres acá: el repo es público.)
- **Pendientes de marketing:** confirmar cuenta publicitaria correcta (HB Performance vs "PAYPAL"), recrear la
  audiencia de retargeting en esa cuenta, filmar videos de CTA para retargeting, lanzar campaña de Tráfico
  (~USD 130 tráfico / ~70 retargeting), y cerrar el copy de la slide 5 del carrusel Hybrid.

### 2026-10-14 — Nuevo número de WhatsApp oficial
- Número de Erika `5491169377543` → **`5491159574043`** (+54 9 11 5957-4043) en los links hardcodeados:
  `asesoria-erika.html` (CTA, se conservó el `?text=` precargado), `app/set-password.html` (link inválido),
  `app/dashboard.html` (error al cancelar). Docs actualizadas (CLAUDE.md, app/CLAUDE.md, app/CONTEXTO.md;
  la entrada histórica del cambio anterior quedó como estaba).
- El resto de las páginas (crossfit/hybrid/corredores, pago-exitoso, Guía del dashboard) toma el número de
  `site_config.whatsapp_erika` → **se cambia desde admin → Configuración → Contacto (WhatsApp)**.
- Número de Gonza sin cambios. Placeholder del input en admin (`9 11 3643 3379`) sin tocar.
- ⏳ **Pendiente (Erika):** guardar `91159574043` en admin → Configuración → WhatsApp Erika (hasta entonces las landings usan el número anterior).

### 2026-10-15 — Alta manual: pago de Fuerza para Corredores sin cuenta (reintento de pago)
- **Síntoma:** un alumno pagó Corredores (2do intento; el 1ro fue rechazado) y no tenía cuenta ni le llegó mail.
- **Causa (confirmada en logs de `process-payment`, 11:22 AR):** llenó el modal de pago **dos veces** (una por
  intento, con 7 min de diferencia) → 2 pendings con el mismo email. El webhook `preapproval updated` llega con
  `payer_email:""` → solo queda el fallback por recencia → `Recencia AMBIGUA: 2 pendings` → `ALTA MANUAL REQUERIDA`.
  El email distinto entre MP y el modal NO fue la causa (con el webhook de preapproval hubiera fallado igual).
- **Corrección manual:** alta desde admin ("+ Asignar atleta", programa corredores → invite) + SQL: `UPDATE profiles`
  con el `mp_subscription_id` (preapproval id sacado del log `MP Preapproval:`), `INSERT` en `payments`
  (`alta_nueva`, bruto 40.000 / neto real de MP, `mp_payment_id` = n° de operación) y `DELETE` de los 2 pendings.
  Verificado: perfil activo, sub vinculada, pago registrado, 0 pendings.
- ✅ **Arreglo de fondo (mismo día) en `process-payment`:** en el fallback por recencia, si todos los pendings
  recientes (15 min) son del MISMO email → se toma el más reciente (ya no es "ambiguo"); solo con emails distintos
  sigue cayendo a manual. Tras el alta se borran **todos** los pendings de ese email+programa (no solo el
  matcheado). Helper `normEmail()` (lower+trim) para todas las comparaciones. Corregido el comentario "30 min" → 15.
- **Probado:** handler real corrido en Node con Supabase y MP stubbeados: 1 pending, 2 del mismo email, 2 de emails
  distintos (manual), match por payerEmail con duplicado viejo, reenvío del webhook tras el alta (skip silencioso) y
  mismo email en otro programa (no se borra). Todo OK; con el código anterior falla el caso del reintento.
- ⏳ **Pendiente (Erika):** desplegar `process-payment` en Supabase (no se auto-deploya).

### 2026-10-15 (b) — Admin: vista 🎯 Leads (seguimiento de `pending_subscriptions`)
- **Para qué:** ver a quienes completaron el formulario de pago y no terminaron de pagar, y hacerles seguimiento.
- **admin/index.html** — item nuevo **🎯 Leads** en el sidebar (entre Pagos y Configuración) con badge de
  **sin contactar** (`#leadsTabBadge`, se calcula al cargar el admin; no cuenta a los que ya son alumnos).
  Vista `#view-leads` (`loadLeads` / `renderLeads` / `updateLead`), mismos patrones que Pagos (`.rank-controls`,
  `.al-table`, `progBadge`, `flash`):
  - Columnas: nombre, programa, días desde `created_at`, origen (`utm_medium / utm_campaign` o "directo"),
    contacto (botón WhatsApp o "sin teléfono" + email), check **Contactado** (guarda `contacted_at`, muestra la
    fecha) y **nota** editable (`contact_note`, se guarda al salir del campo).
  - Orden: sin contactar primero, después más recientes arriba. Filtros: programa y contactado / sin contactar.
  - Si el email (lower+trim) ya existe en `profiles` → etiqueta **"Ya es alumno"**, oculto por defecto
    (toggle "Mostrar los que ya son alumnos (N)").
  - **Normalización del teléfono para wa.me** (`leadWaNumber`): solo dígitos → saca ceros iniciales → si empieza
    con `54` queda igual → si quedan 10 dígitos antepone `549` → si no, se usa tal cual.
  - UPDATE con `.select('id')`: si RLS devuelve 0 filas muestra error (no un éxito falso).
  - **Degradación:** si todavía no existen `contacted_at`/`contact_note`, la lista se ve igual con un aviso, sin
    check ni nota, y el filtro de estado deshabilitado.
- **SQL nuevo `supabase/leads.sql`** (idempotente): `contacted_at timestamptz` + `contact_note text`, policy
  **SELECT** ("Admin ve pending", recreada igual) y **UPDATE** ("Admin actualiza pending") solo para
  `get_my_role()='admin'`. La policy de INSERT anónimo no se toca. Incluye query opcional para listar las policies.
- **Verificación:** syntax-check de los 2 scripts inline (`new Function`) → 0 errores; todos los IDs del JS existen
  en el markup. Prueba en navegador con Supabase falso y datos ficticios: badge, orden, filtros, toggle de alumnos,
  check/nota (payload correcto), modo sin columnas y las 8 secciones del admin abren sin errores JS.
- ✅ **SQL ejecutado por Erika** en Supabase (2026-10-15) y vista probada en real (check + nota guardan OK).
  Commiteado y pusheado a `main`.

### 2026-10-19 — Ventana de acceso `access_from` (PREPARADO, sin ejecutar ni deployar)
- **Objetivo:** que un alumno NUEVO no vea planificaciones de semanas anteriores a su alta (pensando en una futura
  semana de prueba). Solo hacia atrás; hacia adelante no se limita. `access_from` NULL = ve todo (todos los actuales).
- **Relevado contra el esquema real** (dump de `pg_policies` + columnas que pasó Erika): planning_days / planning_blocks /
  exercise_links tienen permissive hybrid-aware + admin + restrictive `is_active_athlete()`. `planning_days.date` NOT NULL.
  `block_rm_exercises` ya no existe (dropeada 2026-07-28) → fuera de alcance. 30 athletes / 2 admins.
- **SQL preparado (NO corrido):** `supabase/migrations/20261019_access_from.sql` → columna `profiles.access_from date`
  (sin default) + helpers SECURITY DEFINER `athlete_can_see_date/day/block` (NOT EXISTS: solo pueden dar false a un
  atleta con access_from seteado; admin nunca) + 3 policies RESTRICTIVE nuevas "Ventana de acceso (access_from)"
  (SELECT, authenticated). No toca ninguna policy existente. **Aprobado por Erika** tras revisión.
  Rollback en DOS archivos (para no editar SQL en una emergencia), todos los scripts en `begin; … commit;`:
  · `20261019_access_from_ROLLBACK_apagar.sql` — **el de uso por defecto**: borra las 3 policies + funciones y deja la
    columna. Seguro aunque la process-payment nueva esté deployada.
  · `20261019_access_from_ROLLBACK_completo.sql` — además borra la columna. ⚠️ NO correrlo con la process-payment nueva
    deployada (rompería las altas): solo después de volver process-payment a la versión anterior.
- **Código aplicado en local (sin commit ni deploy):** process-payment alta nueva → `access_from = arMondayStr()`
  (lunes AR, UTC-3 fijo; probado con bordes domingo-noche/mes/año); reactivación y create-athlete sin cambios (no lo
  tocan). `app/dashboard.html` → `ACCESS_FROM` + `beforeAccess` / `updateProgNavLimits`: "←" de día y "Mes anterior"
  deshabilitados en el límite, días previos del calendario `.locked` (no clickeables), `goToProgramaDay` y
  `loadProgramaDay` clampean a access_from (UX; la protección real es la RLS). esbuild OK, syntax-check OK; probado
  con Supabase stub: con access_from bloquea 1–18/oct y deja 19–31; con NULL navega hacia atrás sin límite.
- ⚠️ **Orden obligatorio:** primero el SQL, después el deploy de process-payment (si no, el insert del alta falla).
- 🔎 **Hallazgo previo (no de esta tarea):** `is_active_athlete()` en producción sigue cortando por
  `payment_failed_at + 3 días`, pero desde 2026-09-27 la gracia la decide `payment_grace_until` (hasta 15 días). Un
  alumno con cobro fallido entre el día 4 y el corte real ve el dashboard pero **sin planificación** (la RLS ya lo cortó).
  Arreglo pendiente aparte: actualizar la función para usar `payment_grace_until`.

### 2026-10-24 — access_from: regla de reactivación + pendientes de seguridad
- **Decisión (Erika):** toda alta por pago arranca con `access_from` = lunes AR de la semana del alta, incluida la
  REACTIVACIÓN de alguien que **vuelve después de haberse ido**. Un alumno activo que se re-suscribe (cambio de tarjeta,
  de programa, duplicado) **conserva** su access_from. create-athlete sigue sin setearlo. Perfiles actuales no se tocan.
- Verificado: un cobro mensual normal **no** pasa por la rama `existingProfile` (la renovación corta antes por
  `mp_subscription_id`); solo llega ahí quien vuelve a llenar el modal de pago (suscripción nueva).
- ✅ **Condición de "vuelve" confirmada y aplicada en local (2026-10-30, sin commit ni deploy):** `isReturningAthlete()` =
  `cancelled` sin días pagos vigentes **o** `payment_grace_until` vencido (el corte por cobro fallido deja
  `subscription_status = 'active'`). Reintento exitoso de MP con la misma suscripción = renovación: conserva su historial.
- ⏳ **Pendientes en sesiones aparte (orden acordado):**
  1. **ANTES de la Fase 2 — process-payment, cruce de pendings en avisos de `preapproval`:** un webhook
     `subscription_preapproval` de una suscripción YA vinculada llega sin payer_email, cae al matcheo por recencia
     (15 min) y recién después chequea "webhook redundante". Si otra persona llenó el modal del mismo programa en esa
     ventana, se le da de alta con la suscripción de otro alumno. Fix propuesto: chequear `mp_subscription_id` ya
     vinculado ANTES de buscar el pending.
  2. **Después de cerrar la Fase 1 — `is_active_athlete()`:** sigue cortando por `payment_failed_at + 3 días`; debe usar
     `payment_grace_until` (hoy sin alumnos afectados, según Erika).
  3. **Prioridad baja — admin, alumnos cortados por cobro fallido:** siguen con `subscription_status = 'active'`, así que
     el admin probablemente los cuenta como activos aunque no tengan acceso. Revisar cómo mostrarlos distinto.

### 2026-10-26 — Editar email del alumno desde admin + detección de typos en el modal de pago
- **Disparador:** una alumna pagó y el mail de ingreso no le llegó porque su email quedó guardado con typo
  (`@gmail.con`). No había forma de corregir el email de un alumno (vive en Auth y en `profiles`).
- **Edge Function nueva `update-athlete-email`** (verify_jwt ON, admin-only por JWT como set-athlete-password):
  `{ old_email, new_email, resend_invite }`. Valida formato + que el nuevo no exista en profiles ni auth.users; cambia
  Auth (`email_confirm: true`) y después profiles; si profiles falla, revierte Auth. Reenvío del mail de ingreso con
  **recovery link** (`generateLink` + Resend, fallback `resetPasswordForEmail`): el invite falla con usuarios existentes
  y `set-password.html` acepta el token de recovery igual que el de invite.
- **Admin:** botón "✏️ Editar email" en el panel del alumno → modal `#modalEmail` (checkbox "Reenviar mail de ingreso"
  tildado). Fix de paso: `#modalSetPw`/`#modalEmail` con z-index 300 (se abrían detrás del panel lateral, z 260).
- **Landings (crossfit/hybrid/fuerza-corredores):** sugerencia "¿Quisiste decir …@gmail.com?" para typos de dominio
  (`.con`, `.coom`, `.cmo`, `gmial`, `gmai`, `hotmial`, `yahooo`, etc.). No bloquea: "No, está bien" sigue al pago.
- **Probado:** function con handler real en Node + stubs (13 casos: feliz, sin reenvío, 401/403, formato, duplicado en
  profiles y solo en auth, old_email inexistente, revert de Auth si falla profiles, fallbacks de mail). Landings en el
  navegador (sugiere, corrige, confirma y sigue; emails válidos sin aviso). Modal del admin con harness (sb falso).
- `.claude/launch.json`: config `static-node` (puerto 5501) porque en esta PC no hay python.
- ⏳ **Pendiente (Erika):** deploy `supabase functions deploy update-athlete-email` y corregir el email de la alumna
  desde admin (+ verificar su perfil/pago con el SQL que se pasó por chat).

### 2026-10-30 — access_from en producción (Fase 1)
- ✅ Migración `20261019_access_from.sql` corrida por Erika. Verificado: 3 policies "Ventana de acceso (access_from)"
  RESTRICTIVE/SELECT presentes, 0 perfiles con access_from, un alumno sigue viendo su historial.
- ✅ `process-payment` deployada por Erika (confirmado por ella; sin verificación independiente del código en Supabase).
- ✅ `app/dashboard.html` publicado con este commit.
- ✅ **Cuenta de prueba restringida (2026-10-30):** UI OK (navegación y calendario limitados). RLS OK simulando la sesión de esa cuenta en el SQL Editor (rol authenticated + JWT): de 18 días, 88 bloques y 191 exercise_links anteriores a access_from, 0 visibles en los tres.
- ⏳ **Pendiente de probar:** renovación de una cuenta con access_from, y la primera
  alta nueva / reactivación reales (revisar que quede el lunes correcto). El webhook completo no se probó de punta a punta.
- Nota de operación: al copiar SQL o código desde el editor usar Ctrl+C; el 30/10 la migración local quedó vacía (se
  restauró antes de commitear) y su texto se pegó primero por error en el editor de la Edge Function (deploy falló, sin efecto).

### 2026-10-30 (b) — process-payment: no cruzar pendings en avisos de suscripciones ya vinculadas
- **Problema:** un aviso `subscription_preapproval` (o una cuota `scheduled`) llega sin email. Si la suscripción ya era
  de un alumno y otra persona había llenado el formulario del mismo programa en los últimos 15 min, se creaba una cuenta
  para esa persona, sin pagar, con la suscripción del alumno. Después `maybeSingle` no reconocía los cobros del alumno.
- **Arreglo (deployado por Erika el 2026-10-30, tras consulta de cruces sin filas y simulación 18 de 18):** al entrar en `status === 'authorized'` se chequea primero si
  `mp_subscription_id` ya está en `profiles`: si está, responde `already_provisioned` sin buscar pending; si la consulta
  falla, responde 500 para que MP reintente. El fallback por recencia NO se tocó.
- **Único cambio de comportamiento:** baja en admin con la sub vieja viva y pending propio: ya no reactiva con la sub
  vieja; reactiva cuando llega el aviso de la sub nueva.
- **Simulación de avisos (correr ANTES de cada deploy de process-payment, desde la raíz del repo):**
  `node supabase/tests/process-payment.sim.mjs` — corre el código real con MP y Supabase simulados (@example.test), sin
  red ni base. Tiene que terminar con todos los casos OK (hoy 32 de 32) (sale con código 1 si algo falla). Los casos "CONOCIDO" fijan
  los cruces abiertos: si se arreglan, hay que actualizarlos. Con la versión anterior falla 5 casos (detecta el cruce).
  Prueba la lógica de la función, NO cómo se comporta MP en realidad.
- **Antes de deployar:** correr `supabase/checks/detectar_cruces.sql` (solo lectura, suscripciones duplicadas en `profiles`
  (`group by mp_subscription_id having count(*) > 1`); si devuelve filas, corregir esos perfiles primero.
- **Privacidad:** se reemplazó el nombre y un email reales por "alumno de prueba" en process-payment, app/CONTEXTO.md y
  supabase/payment_grace.sql. El repo es PÚBLICO: esos datos siguen en el historial de git hasta que se decida limpiarlo.
- ⏳ **Pendientes nuevos:**
  1. **Paso siguiente — fallback por recencia en planes pagos:** puede asignar una suscripción a otra persona (pending
     propio con más de 15 min, o mail de MP distinto al del formulario). Propuesta: no dar de alta por recencia y esperar
     el cobro, que trae el email. Primero medir cuántas altas lo necesitaron.
  2. **Prioridad baja — email ajeno en el formulario:** alguien escribe el email de otra persona y paga → se reactiva
     ese perfil y se cancela su suscripción.
  3. **Fase 2 — probar con cuentas de prueba de MP:** si un preapproval por API (sin plan, `pending`,
     `external_reference` = id del pending) acepta `free_trial`, y qué pasa si se paga con un mail distinto a `payer_email`.

### 2026-10-30 (c) — Revisión de secretos (archivos actuales + todo el historial)
- Sin secretos de servidor: 0 coincidencias de claves de Mercado Pago, Resend, service_role/JWT, `sb_secret_`, tokens de
  GitHub ni claves privadas. Nunca se commitearon `.env` ni `Codigos.txt` (está en `.gitignore`).
- Solo 2 claves, ambas de front: publishable de Supabase (pública por diseño) y la key de YouTube en `admin/index.html`
  (⏳ confirmar en Google Cloud que esté restringida por dominio; pendiente desde la auditoría del 2026-08-06).
- Búsqueda por patrones: no detecta un secreto con formato no contemplado.

### 2026-10-30 (d) — Fase 2, etapa 1: script para probar identificación con planes
- `supabase/tests/mp-etapa1.mjs` (local, sin commit). Se descartó el entorno de prueba de MP (rechazaba el pago). Ahora opera en PRODUCCIÓN sobre un único plan de prueba técnica ($100, 1 día gratis), con candados. Antes: menú con un plan de
  7 días gratis, genera links con `external_reference`, revisa suscripciones, busca por mail, analiza la URL de regreso y
  compara una cancelación antes/después. Pide la credencial oculta, no la guarda y rechaza las de producción.
- No toca Supabase ni `process-payment`. Probado solo con MP y terminal simulados; falta correrlo contra MP real.
- **Decisiones (Erika):** el plan de CrossFit volvió a 0 días el 19/10, la suscripción de su prueba está cancelada y ningún alumno cambió su fecha de cobro. Orden de identificación: opciones con plan → c3 (API con plan y tarjeta cargada con el componente oficial de MP, datos directo a MP) → "sin plan" solo si c3 falla. Ya no se confía en los pendings sin identificación: alta manual.
- **Etapa 1 con cuentas reales (2026-10-31):** cuenta de trabajo cobra, MP personal paga, sin usar el formulario del sitio. Simulación ampliada (27 de 27): un plan que `process-payment` no conoce responde 422 sin alta, sin reactivar y sin tocar pendings, aunque haya perfil o pending con el mail del pagador. Excepción (caso CONOCIDO): si `external_reference` es un programa válido sí se resuelve; por eso el script solo genera referencias `ETAPA1-...`. MP no documenta monto mínimo: $100 está sin confirmar. Los candados se probaron con MP simulado, no contra MP real.

### 2026-10-31 — Fase 2: resultados de la etapa 1 y plan actualizado (sin código)
**Resultados con cuentas reales** (una sola suscripción de prueba, pagada con dinero disponible; tarjeta sin probar; ids y mails fuera del repo):
- `external_reference` en el link del plan: **descartada**, la suscripción queda con el campo vacío.
- Volver a consultar la suscripción: **descartada**, `payer_email` siguió vacío a la hora y media.
- Página de regreso: **funciona**, vuelve con `preapproval_id` y es la suscripción correcta.
- Búsqueda por mail: funciona solo con el mail de la cuenta de MP del pagador. Con otro mail da 0.
- `payer_id`: viene aunque `payer_email` esté vacío. Coincidió entre dos suscripciones de la misma cuenta (19/10 y 31/10).
- ✅ **Etapa 1 cerrada (2026-11-01).** Primer cobro: aprobado por $100, cerca de 1 h 20 después de la hora programada. El mail del pagador vino en el pago; la suscripción y su aviso siguieron con `payer_email` vacío.
- `process-payment` con el plan desconocido, en real: todos los avisos terminaron en 422 "No se pudo determinar el program", sin ningún "User created/activated". MP reintentó cada 15-20 min. El perfil de Erika quedó igual.
- Cancelación: pasa a `cancelled` y MP **sigue devolviendo `next_payment_date`**. Durante la prueba esa fecha sirve como fin del acceso, pero el sistema no debe tomarla como cobro futuro en una suscripción cancelada.
- Cierre: pago devuelto y plan de prueba cancelado por Erika desde el panel.
- Para la etapa 6: el cobro puede llegar más de una hora después de la fecha, así que el acceso no puede cortarse justo al vencer la prueba.

**Decisión (Erika): seguimos con PLANES.** Los planes de prueba de producción se crean por API, como el de la etapa 1, con la página de regreso configurada. Después Erika edita los días de prueba desde el panel de MP. c3 y "sin plan" quedan sin uso mientras esto funcione.

**Identificación:**
1. **Principal:** la página de regreso de prueba manda al servidor el `preapproval_id` y el id del pending (guardado en el navegador al completar el formulario).
2. **El servidor no confía en la dirección.** Consulta la suscripción en MP y exige: plan de prueba, `authorized`, no vinculada a ningún perfil, creada después del pending y hace poco. Si algo no cierra: alta manual.
3. **Respaldo si no vuelve a la página:** búsqueda por el mail del formulario dentro del plan de prueba. Si no encuentra exactamente una: alta manual. **Nunca recencia.**
4. **`payer_id` en `profiles`**, para detectar a quien repite la prueba con otro mail y la misma cuenta de MP.

**Decidido también (propuesto por Claude, aprobado por Erika el 2026-11-01):**
- El plan de la suscripción tiene que ser el del programa del pending, y el pending no puede estar ya usado.
- Ventana de "hace poco": 2 horas entre pending y suscripción.
- Índice único en `profiles.mp_subscription_id`, porque el regreso y el webhook pueden llegar a la vez. Antes correr `supabase/checks/detectar_cruces.sql`.
- El webhook de un plan de prueba dispara el respaldo: nunca da de alta por sí solo.
- `payer_id` ya usado: sin alta automática, queda para revisión.
- **Alta manual pendiente:** cada caso aparece en admin → Pruebas. Esa suscripción sigue viva en MP y **va a cobrar** aunque la persona no tenga acceso: hay que dar el alta o cancelarla antes del cobro.
- Primer cobro de una suscripción sin vincular en plan de prueba: sin alta automática, y aviso para resolverlo a mano.
- Sin id del pending en el navegador (ver riesgos): el regreso le pide el mail del formulario y sigue con las mismas verificaciones.

**Riesgos sin probar (van en la etapa 8):**
- Celular: link abierto desde Instagram/WhatsApp, pago en la app de MP y regreso en otro navegador, sin el id del pending.
- Editar los días desde el panel: confirmar que el plan conserva la página de regreso y que sigue volviendo con `preapproval_id` (la etapa 1 no editó el plan).
- Pago con tarjeta y regreso.
- `payer_id` no sirve contra alumnos anteriores: `profiles` no lo tiene. Para ellos sigue valiendo el control por mail.

**Etapas:**
1. Identificación: ✅ cerrada el 2026-11-01.
2. ✅ Datos (cerrada el 2026-11-02): marca de prueba en el pending; en el perfil estado de prueba (cuatro valores), inicio, fin y fecha de resolución; `payer_id`; índice único.
3. Planes de prueba creados por API con la página de regreso (Erika edita los días desde el panel) + función de entrada: elegibilidad, mensaje genérico, límite de intentos, pending creado por el servidor, id devuelto al navegador.
4. Alta de prueba: función de identificación (regreso + respaldo) y `process-payment`.
5. `prueba.html`, página de regreso propia, Pixel `StartTrial` sin `Purchase`.
6. Primer cobro y cancelación: incluye la marca en `cancel-subscription`, fin de acceso si cancela en MP, corte si el cobro es rechazado. + conteo de días de la prueba en el perfil del portal y aviso del día 6 "se termina tu semana gratis" (pedidos de Erika 2026-11-04).
7. Admin → Pruebas: En prueba, Canceló, Siguió, Cobro rechazado, conversión, altas manuales pendientes.
8. Prueba real de 1 día, con los riesgos de arriba. ⚠️ Antes: revisión legal del texto del cobro automático y del botón de arrepentimiento (Ley 24.240). ⚠️ Antes de abrir al público: correr también la prueba real de la etapa 5b (alta paga con una cuenta de MP que ya usó la prueba), `supabase/checks/etapa5b_pruebas.md` pasos 7 a 20.
9. Prueba real de 7 días; después Hybrid y Corredores.

### 2026-11-01 — process-payment: error si no se guarda el perfil + migración de la etapa 2 (local)
- **Arreglo en local (sin commit ni deploy):** si falla el guardado del perfil en un alta o una reactivación, responde 500 para que MP reintente, sin borrar el pending, sin registrar el cobro y sin loguear "User created/activated". Buscar `PERFIL NO GUARDADO` en los logs.
- **Alta nueva:** además borra el usuario de Auth recién invitado, porque si no el reintento fallaría siempre en el invite. No lo borra si ya tiene perfil o si no se pudo comprobar (`ALTA MANUAL REQUERIDA`). El mail de invitación de ese intento ya salió y su link deja de servir.
- **Simulación:** 32 de 32; los 5 casos nuevos fallan con el código anterior. No prueba Auth real.
- **Reactivación (aprobado por Erika, 2026-11-02):** la suscripción vieja se cancela en MP recién después de guardar el perfil. Simulaciones: 32 de 32 y 21 de 21. Se deploya después del arreglo de `profiles`.
- **Etapa 2:** `20261101_trial_datos.sql` aprobada en diseño por Erika, **sin ejecutar**, y se corre recién con el arreglo deployado. Rollbacks: `_ROLLBACK_apagar` (saca trigger, función y policy) y `_ROLLBACK_completo` (también columnas e índices). Probados en Postgres en memoria con un esquema mínimo, no contra la base real.
- **Permisos de alumnos:** confirmado el 2026-11-02 con `supabase/checks/permisos_profiles.sql`, ver la entrada siguiente.

### 2026-11-02 — URGENTE: un alumno podía editar cualquier columna de su perfil (lista blanca en producción)
- ✅ **Migración corrida por Erika y probada desde la consola con su cuenta de prueba:** rechazados `role`, `subscription_end`, `access_from`, `subscription_status` y `program`; `full_name` guarda. Reenviar un valor igual al actual no da error, y con un valor distinto se rechaza.
- **Hueco confirmado por Erika:** `authenticated` tiene UPDATE sobre `profiles`, la policy propia solo exige `auth.uid() = id` y no había triggers. Un alumno puede cambiarse `role` a admin, vencimiento, estado, `access_from`, etc.
- **Propuesta:** `20261102_profiles_lista_blanca.sql`, con trigger BEFORE UPDATE. El alumno solo puede cambiar `full_name`, `phone`, `avatar_url`, `hybrid_variant` y `shortcut_guide_seen`; una columna nueva queda protegida. Admin, `service_role` y SQL Editor sin límite. Rollback: `_ROLLBACK_apagar`.
- **Probado** en Postgres en memoria con un esquema armado desde la documentación (42 de 42), también junto con la etapa 2. No probado contra la base real.
- **Orden:** 1) lista blanca, 2) deploy de `process-payment`, 3) etapa 2.
- ⏳ **Revisar con resultados:** `supabase/checks/auditar_perfiles.sql` (señales de abuso; no hay historial de cambios) y `supabase/checks/auditar_permisos.sql` (todas las tablas y Storage).
- ✅ `process-payment` (error si no guarda y cancelación después de guardar) deployada por Erika el 2026-11-02, con control de cruces sin filas.
- **Registro de Auth:** "Allow new users to sign up" estaba prendido. El código oficial de Auth solo lo verifica en el registro público, no en la invitación; la documentación no lo aclara. ⏳ Apagarlo y probar ingreso, recuperación e invitación.
- ⏳ **Cuentas de Auth sin perfil:** 4, ninguna pagando; 3 identificadas y 1 sin reconocer (sin datos en el repo). Antes de borrarlas: `supabase/checks/antes_de_borrar_usuarios.sql`. Supabase no deja borrar un usuario con archivos en Storage.
- **Propuesta local (sin commit ni deploy):** en un alta nueva con mail confirmado en Auth y sin perfil, el invite falla y hoy responde 500: la persona paga sin acceso. `process-payment` reusa ese usuario, le crea el perfil y manda un mail de ingreso (link de recuperación). No toca un usuario que ya tenga perfil. Requiere el registro apagado. Simulaciones: 39 de 39 y 21 de 21; no prueba Auth real.
- ⏳ **Borrado de alumnos en admin (solo análisis):** borra el perfil y deja Auth, borra sus pagos en cascada y no cancela en MP. Recomendado: baja para alumnos reales; eliminar solo para pruebas y errores, con una Edge Function.
- **Decisiones (Erika, 2026-11-02):** diff del alta con mail ya existente en Auth aprobado, queda en local sin commit y se deploya el día que apague el registro y haga las pruebas. Para alumnos reales se usa "Dar de baja", no "Eliminar". Hoy ninguna de las 4 cuentas sin perfil está pagando ni tiene acceso.
- ⏳ **Orden de pendientes:**
  1. ✅ Etapa 2: `20261101_trial_datos.sql` corrida por Erika el 2026-11-02. Verificado en la base real: 6 columnas nuevas, 0 perfiles y 0 pendings marcados; un INSERT anónimo normal pasa y uno con `is_trial = true` da error de RLS.
  2. Apagar el registro + pruebas + deploy del arreglo del alta con mail ya existente en Auth.
  3. Consultas de la cuenta desconocida y borrado de las 4 cuentas.
  4. Edge Function `delete-athlete` para el botón Eliminar.
  5. `send-push` / `notifications`, `full_name` escapado y resto de la tabla de riesgos (detalle abajo).
- ⏳ **Detalle del punto 5, en este orden** (riesgos vistos en código y documentación; salvo que se indique, sin confirmar en la base):
  1. `send-push` sin autenticación (confirmado en el código) y `notifications` con INSERT abierto.
  2. Revisar que `full_name` esté escapado en todo el admin.
  3. El resto: INSERT y DELETE sobre el propio perfil; registro abierto en Auth; escrituras sin el corte de `is_active_athlete()`; INSERT de `messages` con `from_id = auth.uid()` sin límite de canal; INSERT abierto en `pending_subscriptions`; firma del webhook de MP en modo monitor (confirmado en el código); buckets públicos de imágenes.

⏳ **Pendiente nuevo, para revisar más adelante:** hoy, si un link tiene `external_reference` = un programa válido (por ejemplo `hybrid`), `process-payment` resuelve el programa con eso y reactiva un perfil aunque el plan sea desconocido (caso CONOCIDO de la simulación).

Script: la hora se muestra en formato de 24 horas. Sin commit ni push.

### 2026-11-01 — process-payment: cobros aprobados que no quedaban en `payments`
- **Problema:** 4 cobros automáticos sin fila en `payments` (2 altas, 2 renovaciones). Ya cargados a mano, sin backfill. Los logs de esas fechas no existen: la causa de cada caso sigue sin confirmar hasta consultar MP.
- **Causa de fondo:** el cobro solo se registraba por dos caminos (renovación con la suscripción correcta y alta por `authorized_payment`). En los demás la función respondía OK y MP no reintentaba: avisos casi simultáneos, suscripción distinta a la guardada, cobro todavía en proceso, aprobado con cuota en `recycling`, o error al consultar MP o al guardar.
- **Arreglo:** con cobro aprobado y perfil identificado se registra siempre. Por mail del pagador se registra sin revincular (log `SUSCRIPCION SIN VINCULAR`). Errores de MP o del guardado → 5xx para que MP reintente; cobro en proceso → 503. Sin perfil o con la suscripción en 2 perfiles → log `COBRO SIN REGISTRAR`, sin adivinar. El 1er cobro queda `alta_nueva` aunque entre por la rama de renovación.
- **Sin cambios:** el bloque de gracia y corte es idéntico (comparado con diff). Solo se agregó antes el registro del cobro aprobado con cuota en `recycling`: si ese guardado falla, responde 500 y la gracia se aplica en el reintento.
- ⏳ **Abierto:** un cobro aprobado con cuota en `recycling` todavía marca fallo de cobro a quien pagó. No se tocó por ser lógica de gracia.
- **Pruebas:** `supabase/tests/process-payment-pagos.sim.mjs` nueva, con `mp_payment_id` único como la base real y varios avisos por caso, incluidos avisos repetidos. Contra el código anterior fallaban 11 de 20; ahora pasan todos. Simulación anterior sin cambios de resultado. Solo simulación: falta ver el comportamiento real de los reintentos de MP.
- ⏳ **Pendiente (Erika):** deploy de `process-payment`. Botón "Sincronizar con MP": se decide con los resultados de las consultas.

### 2026-11-02 — Fase 2, etapa 3: propuesta (sin deploy, sin SQL, sin commit)
- `supabase/tests/mp-plan-prueba.mjs` (local): crea y verifica el plan de prueba de CrossFit. Probado solo con MP simulado.
- Plan guardado en `site_config.mp_trial_plan_crossfit`; `process-payment` solo mapea `mp_plan_*`, así que hasta la etapa 4 responde 422 a ese plan.
- **Indispensable antes de crear cualquier pending de prueba:** `process-payment` tiene que ignorar `is_trial = true` al buscar y limpiar pendings; si no, el alta de un comprador pago puede tomar el pending de prueba de otra persona. Va en el mismo archivo que el arreglo del alta con mail en Auth, por eso conviene apagar el registro antes.
- Alta con mail en Auth y filtro `is_trial` listos en local para el mismo deploy. Simulaciones: 43 de 43 y 21 de 21; los 4 casos de prueba fallan sin el filtro.
- Decisiones de Erika: pending de prueba sin usar se reusa y renueva su fecha; cuenta en Auth = no elegible; el registro se apaga antes de ese deploy.
- `20261102_trial_intentos.sql` y su rollback, locales y sin ejecutar: `trial_attempts` e índice único por mail de pending de prueba. Probados en Postgres en memoria (18 de 18).
- ✅ **Registro de Auth apagado por Erika y probado en la base real (2026-11-02):** ingreso OK; recuperar contraseña OK; invitación desde `create-athlete` OK hasta entrar al portal, con la cuenta de prueba borrada después; `signUp` rechazado con "Signups not allowed for this instance" (422). La invitación desde `process-payment` se confirma con la primera alta real.
- ✅ `process-payment` con filtro `is_trial` y alta con mail en Auth deployada por Erika el 2026-11-02, con control de cruces sin filas.
- `supabase/functions/start-trial` y `supabase/tests/start-trial.sim.mjs` escritas en local, sin commit ni deploy. Simulación: 42 de 42, con Supabase simulado. ✅ `20261102_trial_intentos.sql` corrida y verificada por Erika el 2026-11-02 (tabla, índice y RLS). ✅ `start-trial` deployada por Erika el 2026-11-02 con `verify_jwt` OFF: desde `crossfit.html` un cuerpo vacío da la respuesta genérica y `trial_attempts` guardó el intento. ✅ Plan de prueba de CrossFit creado y cargado en `site_config` por Erika el 2026-11-02; la verificación del script dio las 7 líneas en OK. ✅ **Etapa 3 cerrada (2026-11-02):** Erika corrió `supabase/checks/etapa3_pruebas.md` en la base real, sin pagar: alta, reintento y mayúsculas con el mismo pending; cuenta existente y otro programa con respuesta genérica; sexto intento frenado (5 intentos, una sola `ip_hash`, un solo pending); checkout del plan de prueba correcto; formulario pago funcionando; limpieza en 0. En el formulario pago un mail quedó mal guardado por el autocompletado de Chrome; escrito a mano se guardó bien.

### 2026-11-02 — Fase 2, etapa 4: plan aprobado por Erika
- **`confirm-trial` hace todas las altas de prueba.** La llaman la página de regreso y el webhook; `process-payment` solo le pasa los avisos de suscripciones sin vincular de planes de prueba.
- **Identificación:** regreso con `preapproval_id` + id del pending; sin id, la página pide el mail del formulario; respaldo del webhook: pendings de prueba de las 2 horas previas, buscando cada mail en MP dentro del plan, y solo si exactamente uno coincide con esa suscripción. Nunca recencia.
- **Exige:** consulta a MP con `authorized` y plan de prueba del programa; sin vincular; creada después del pending y dentro de 2 horas; pending sin usar; `payer_id` presente y sin usar; mail sin perfil y sin cuenta en Auth. Lo demás queda para revisión.
- **Alta:** solo cuenta nueva, con `trial_status = in_trial` y fin = `next_payment_date`. Una prueba nunca reactiva ni modifica un perfil ni cancela una suscripción vieja. Acceso desde el lunes de esa semana. Doble suscripción: a mano.
- **Agregados:** tabla `trial_reviews` y reserva del pending, para que el regreso y el webhook no den el alta a la vez.
- **Sin revisión automática (decisión 2026-11-02):** el caso se guarda con el primer aviso y se considera pendiente si sigue abierto a los 30 minutos. Se reintenta en cada aviso de MP y al volver a la página. Responder error se descartó porque es el webhook de los alumnos y casi no ayuda.
- **Para la etapa 5 (Erika):** el formulario de prueba pide el mail dos veces y avisa errores típicos de tipeo (`gmail.co`, `hotmial`, etc.).
- **Para la etapa 6:** cancelar y cobro rechazado todavía usan la lógica normal. El primer cobro, al día 7, quedaría como `renovacion_automatica` porque `mpChargeType` solo acepta 3 días desde `subscription_start`: hay que marcarlo como alta.
- **Para la etapa 7, antes de abrir al público:** aviso diario solo si hay casos pendientes, por cron; registrar el cobro de una suscripción dada de alta a mano.
- **Prueba real:** suscripción al plan de 7 días con la otra cuenta de MP y un alias, `confirm-trial` llamada desde la consola, invitación y portal, cancelación el mismo día y limpieza.
- ⏳ **Escrito en local, sin commit, sin deploy y sin SQL corrido:** `supabase/functions/confirm-trial`, desvío en `process-payment`, `20261102_trial_revisiones.sql` y su rollback. Simulaciones: `confirm-trial.sim.mjs` 73 de 73, con 16 de 16 roturas a propósito detectadas; `process-payment` 52 de 52; pagos 21 de 21; `start-trial` 42 de 42. SQL en Postgres en memoria: 29 de 29, con pedidos en secuencia y sin concurrencia real. Nada probado todavía contra MP real.
- SQL y rollback aprobados por Erika el 2026-11-02, todavía sin correr. Pasos en `supabase/checks/etapa4_pruebas.md`. Sin secreto nuevo: `process-payment` se identifica ante `confirm-trial` con `SERVICE_ROLE_KEY`, que ya tienen las dos funciones.
- ✅ **Etapa 4 probada en real por Erika (2026-11-04), todo según `etapa4_pruebas.md`:** SQL corrido y verificado; `confirm-trial` y `process-payment` deployadas con Verify JWT OFF; suscripción real con MP personal y alias; regreso con `preapproval_id`; el webhook dejó el caso `sin_identificar` sin dar el alta; la confirmación con el id del pending dio el alta, cerró el caso y borró el pending; una sola invitación; portal OK; cancelación en MP reflejada en el perfil; limpieza en 0.
- Agregado a lo aprobado: límite de 20 pedidos por hora por IP en la página de regreso, porque cada pedido consulta MP con el token de todo el negocio. El camino por mail queda en 5.

### 2026-11-04 — Fase 2, etapa 5: plan aprobado por Erika (páginas de la prueba)
- **Alcance:** dos páginas nuevas, `prueba.html` y `prueba-regreso.html`. No se tocan funciones, landings ni el pago normal.
- **`prueba.html`:** explica la semana y el cobro posterior ("7 días gratis, después $X por mes; si cancelás en MP antes del día 7 no se cobra nada"), con el precio de la misma clave de `site_config` que verificó el plan. Campos: nombre, mail, repetir mail, teléfono opcional. Detección de typos de las landings + regla nueva: `gmail.` con cualquier terminación que no sea `.com`. Confirmación obligatoria "Te vamos a escribir a: …" (el autocompletado llena los dos mails con el mismo error) y casilla obligatoria del cobro. Llama a `start-trial`, guarda el id del pending en el navegador y va al checkout. Programa por la dirección (`?programa=crossfit`); por ahora solo CrossFit.
- **`prueba-regreso.html`:** lee `preapproval_id` + id guardado y llama a `confirm-trial`. Listo → "revisá tu mail (y spam), hasta 5 min". `retry` → reintenta sola ~5 veces en ~1 minuto; si no alcanza, mensaje de revisión. Sin id guardado → pide el mail del formulario, con detección de typos. Revisión → "Recibimos tu suscripción y la estamos revisando", con WhatsApp, sin decir "error". Sin `preapproval_id` → mensaje con WhatsApp.
- **Pixel:** `PageView` en las dos; `ViewContent`, `InitiateCheckout` y `Lead` en el formulario; `StartTrial` solo con el alta confirmada, una vez por suscripción. Nunca `Purchase` ni `hb_purchase`.
- **Sin enlazar:** sin links desde el sitio y con `noindex` hasta la etapa 8. El aviso "estás en tu semana de prueba" en el portal queda para la etapa 6.
- **Prueba:** primero en local con respuestas simuladas (cada estado, celular y escritorio, capturas); Erika revisa textos; commit/push con su OK (publica); prueba real con alias A (camino normal) y alias B (misma cuenta MP, sin id guardado → pide mail → revisión `payer_repetido`); cancelar y limpiar.
- ⚠️ **Requisito ANTES de la etapa 8 (abrir al público):** Erika revisa con su contador o abogado el texto del cobro automático y el botón de arrepentimiento (Ley 24.240). `prueba.html` tiene un lugar previsto para ese texto (bloque marcado `LEGAL`).
- ⏳ **Escritas en local, sin commit ni push (2026-11-04):** `prueba.html` y `prueba-regreso.html`. Probadas en el navegador con respuestas simuladas de `site_config`, `start-trial` y `confirm-trial` (simulador fuera del repo): validaciones, tipeo (`gmail.co`, `gmail.com.ar`, `gmial`, `hotmail.con`), mails distintos, casilla, confirmación, UTMs en el pedido, `hb_trial` guardado y sin `hb_purchase`, reintentos (2 y agotados = 6 pedidos), camino por mail con "probá de nuevo", sin `preapproval_id`, precio que no carga (botón bloqueado), `start-trial` con error o sin red, programa sin prueba. Pixel: `ViewContent` → `InitiateCheckout` → `Lead`; `StartTrial` una vez, no se repite al recargar; nunca `Purchase`. Sin desborde horizontal a 390 px. Capturas de 14 estados (celular y escritorio) enviadas a Erika para revisar textos. Falta: revisión de textos, push y prueba real con alias A y B.
- ✅ **Textos aprobados por Erika (2026-11-04)**, con un agregado: se puede cancelar **desde el perfil en el portal o en Mercado Pago** (en "Cómo funciona", "Qué incluye", nota del precio, casilla y página de alta). El botón del perfil ya aparece en la prueba (`subscription_status = active`) y `cancel-subscription` cancela en MP.
- **Pedidos de Erika para etapas siguientes (2026-11-04):**
  - **Etapa 6:** en el perfil del portal, conteo de la semana gratis (días usados y días que quedan, hasta `trial_ends_at`). Va junto con el aviso "estás en tu semana de prueba". Probar también la cancelación desde el perfil durante la prueba: acceso hasta el fin de la semana y sin cobro.
  - **También etapa 6 (decisión de Erika):** aviso el día 6 de que la semana gratis está por terminar, con un cron diario. Canal (push o mail) a definir según el pendiente de seguridad de `send-push` / `notifications`.
  - **Aviso del día 6 por mail con Resend (decisión de Erika, 2026-11-04):** mandarlo por **mail con Resend** (ya usado por `process-payment` y `update-athlete-email`, remitente `noreply@hbperformance.fit`) desde la función del cron, más el conteo visible en el perfil. No usar push por ahora: `send-push` no tiene autenticación y toma título y texto del pedido, así que sumarle un tipo nuevo agranda una puerta por la que cualquiera puede mandar avisos falsos a los alumnos. Además, el push solo llega a quien activó notificaciones. El arreglo de `send-push` / `notifications` sigue en su lugar de la lista de pendientes y no bloquea la etapa 6. La push queda como extra opcional cuando se resuelva ese pendiente.
- ✅ **Commit y push de las dos páginas (2026-11-04, `ee3bb35`), con OK de Erika.** Quedan publicadas sin links y con `noindex`. Pasos de la prueba real en `supabase/checks/etapa5_pruebas.md` (alias A camino normal, alias B misma cuenta de MP sin id guardado → `payer_repetido`, Pixel con "Probar eventos", cancelación y limpieza).
- ⚠️ **Prueba real, alias A (2026-11-04):** formulario, checkout y regreso funcionaron ("¡Listo!", alta dada). Pero **MP cobró $45.000 en el momento** (dinero en cuenta) y puso el próximo cobro a un mes: **no aplicó los 7 días gratis**. Causa probable, sin confirmar: la misma cuenta personal de MP ya había usado ese plan en la etapa 4 y MP da la prueba una sola vez por cuenta y plan. Se cancela y se devuelve. Parte C (alias B, misma cuenta) suspendida: MP también le cobraría.
- ⚠️ **Hueco encontrado:** `confirm-trial` dio el alta como prueba aunque MP no aplicó la prueba, porque el `payer_id` de la etapa 4 se borró en la limpieza. Resultado: `in_trial` con fin = próximo cobro (un mes). **Antes de la etapa 8:** si MP no aplicó la prueba (próximo cobro a más de ~8 días de la creación o sin `free_trial`), no dar alta de prueba y dejar el caso en revisión. Revisar también el texto "Hoy no se cobra nada" para quien ya usó la prueba. Dato real: el aviso del cobro llegó antes que la página (`trial_reviews` quedó con `charge_seen_at`) y la página dio el alta igual; otra señal a usar: caso con cobro visto = no dar alta de prueba.
- ✅ **Confirmado en real (2026-11-05), con otra cuenta de MP:** alias A **sin cobro** (MP aplicó los 7 días); alias B con la misma cuenta **cobrado en el momento** → MP da la prueba **una sola vez por cuenta y plan**. Nuestro lado con B: la página pidió el mail y mostró "Recibimos tu suscripción" (revisión), sin alta. Consecuencia: quien repite paga desde el día 1 y queda en revisión; hay que darle acceso a mano (admin, etapa 7) y avisarlo en el texto de `prueba.html`.
- ✅ **Etapa 5 probada en real por Erika (2026-11-05), según `etapa5_pruebas.md`:** páginas publicadas; tipeo, mails distintos, casilla y confirmación; checkout del plan de prueba; regreso con alta ("¡Listo!"); camino por mail con revisión `payer_repetido` (B), sin perfil ni invitación y con UTMs en el pending; sin `preapproval_id` y WhatsApp OK; Pixel sin `Purchase` y `StartTrial` solo con alta; ambas suscripciones canceladas y limpieza en 0. Alta de A con `trial_ends_at` a 7 días. Cobros de la cuenta repetida devueltos. **Pendiente antes de la etapa 8:** freno de `confirm-trial` cuando MP no aplicó la prueba o ya vio un cobro, y texto para quien ya usó la prueba.

### 2026-11-05 — Fase 2, etapa 5b: propuesta "opción A" (sin código, sin deploy, sin commit)
- ✅ **Aprobada por Erika el 2026-11-05**, incluidos: alta paga sin bloquear `payer_repetido` y `Purchase` con el precio. Primer paso: script de solo lectura `supabase/tests/mp-etapa5b.mjs`, escrito y probado con MP simulado (plazo con y sin prueba, `free_trial`, búsqueda de cuotas con éxito y con falla, pago devuelto). Sin commit; falta que Erika lo corra contra MP real.
- ✅ **Script corrido por Erika contra MP real (2026-11-05):** 4 suscripciones canceladas del plan. 2 con prueba: plazo 7,0 días y 0 cuotas. 2 sin prueba: plazo 30,0 días y 1 cuota `processed` de $45.000 cobrada en el mismo segundo de la creación, pago devuelto. `/authorized_payments/search` funciona (4 de 4). **La suscripción no trae `free_trial` ni en las que tuvieron prueba:** se detecta por el plazo y la cuota.
- ⏳ **Código de la 5b escrito en local, sin deploy ni commit (2026-11-05):** `confirm-trial` (plazo hasta 10 días = prueba, 20 o más = alta paga, en el medio `fecha_dudosa`; alta paga solo con primer cobro aprobado por `price_<programa>_ars` y registrado como `alta_nueva`; `payer_repetido` solo bloquea la prueba; cobro visto con prueba = `cobro_en_prueba`; `charge_seen` se anota y sigue identificando; respuesta pública con `paid` y `new`; una suscripción ya vinculada paga reintenta registrar su cobro). `prueba-regreso.html`: estado "¡Listo, ya tenés acceso!", `Purchase` con el precio o `StartTrial` solo si ese pedido creó el alta, una vez por suscripción (lista guardada con formato nuevo, compatible con el viejo). `prueba.html`: nota "si ya la usaste, Mercado Pago cobra la primera cuota al suscribirte". `process-payment` sin cambios.
- Simulaciones: `confirm-trial` 97 de 97 (24 casos nuevos, incluidos los 4 órdenes de llegada), 23 de 23 roturas a propósito detectadas; la simulación ahora marca como falla cualquier error inesperado. `process-payment` 52, pagos 21, `start-trial` 42, sin cambios. Páginas probadas en local con respuestas simuladas. Pasos en `supabase/checks/etapa5b_pruebas.md`.
- **Decisión de Erika (2026-11-05):** la prueba real de la 5b se hace junto con las pruebas reales de la etapa 8, **antes de abrir al público**. Hoy solo se deploya `confirm-trial` con control mínimo (simulaciones, versión anterior a mano, deploy con Verify JWT OFF y llamada vacía).
- ✅ **`confirm-trial` de la 5b deployada por Erika (2026-11-05)** con control mínimo: simulación 97 de 97, versión anterior (76c477a) a mano, `registerPaidCharge` presente, Verify JWT OFF, llamada vacía con la respuesta genérica. Prueba real pendiente para la etapa 8.
**Decisión de Erika:** si MP no aplicó la prueba y cobró la primera cuota, la persona se da de alta sola como **alumno pago normal**: sin `trial_status`, `access_from` = lunes de la semana del alta, pago `alta_nueva` en Pagos, mensaje propio en la página de regreso, sin `StartTrial`. Se mantienen todas las verificaciones de identidad; si no hay certeza, revisión y nunca recencia.
- **Detección (en `confirm-trial`, con datos de MP, nunca del navegador):**
  1. **Plazo hasta el próximo cobro** (`next_payment_date − date_created`). Con prueba ≈ duración de la prueba (1 a 7 días); sin prueba ≈ 1 mes (visto en real: 7 días vs. un mes). Hasta 10 días = prueba; 20 días o más = sin prueba; en el medio = revisión `fecha_dudosa`.
  2. **Sin prueba, el alta paga exige el primer cobro aprobado** de esa suscripción, buscado en MP (`/authorized_payments/search?preapproval_id=`), con monto igual al del plan. Cobro todavía en proceso = reintentar; rechazado = revisión `primer_cobro_rechazado`; sin cobro = reintentar y, si no aparece, revisión.
  3. **Contradicciones = revisión:** plazo de prueba pero con cobro visto (`cobro_en_prueba`).
- **Identidad:** las mismas verificaciones (pending, programa, ventana de 2 horas, mail sin perfil y sin cuenta en Auth, `payer_id` presente). Mail con cuenta = revisión: una prueba nunca reactiva ni modifica un perfil. **A decidir por Erika:** en el alta paga NO bloquear `payer_repetido` (paga precio completo, como en el checkout normal, donde una cuenta de MP puede pagar a varios alumnos). Sí se guarda el `payer_id`.
- **Alta paga:** invitación + perfil como cualquier alta (`subscription_status = active`, `subscription_start` hoy, `access_from` lunes, `mp_subscription_id`, `payer_id`, sin campos `trial_*`). `confirm-trial` registra el cobro como `alta_nueva` (bruto y neto de `/v1/payments`), con el `mp_payment_id` único para no duplicar.
- **Orden de llegada:**
  - **Página primero, cobro ya aprobado (lo más común):** alta paga + cobro registrado. El aviso del cobro llega después, encuentra el perfil vinculado y su registro se descarta por duplicado.
  - **Página primero, cobro en proceso:** la página reintenta ~1 minuto ("Estamos confirmando tu pago"). Si no alcanza, mensaje de revisión. Cuando llega el aviso del cobro, el webhook intenta identificar por el respaldo de mail; si no hay certeza, queda en revisión con el cobro visto, y una recarga de la página lo vuelve a intentar.
  - **Aviso del cobro primero (lo visto en real el 04/11):** hoy `charge_seen` deja el caso en revisión sin intentar nada. Cambia a: intentar identificar con el respaldo; si no hay certeza, revisión con `charge_seen_at`. Cuando vuelve la página con el id del pending, da el alta paga, registra el cobro (el aviso ya no se repite porque se respondió 200) y cierra el caso.
  - **Nunca vuelve a la página y el mail no coincide con su cuenta de MP:** queda en revisión con el cobro visto. Pagó: el alta a mano tiene que registrar el cobro (admin, etapa 7) y el aviso diario lo muestra.
- **Respuesta pública nueva:** `{ok:true, paid:true}` en el alta paga, y una marca de "alta nueva en este pedido" para los eventos del Pixel.
- **Página de regreso:** mensaje "Ya habías usado tu semana gratis, así que se cobró la primera cuota. Ya tenés acceso a tu portal." + aviso del mail y spam. **Pixel:** `Purchase` con el precio y `currency: ARS`, sin `StartTrial`, solo cuando ese pedido creó el alta y una vez por suscripción en el navegador. No se cruza con `pago-exitoso` (otro flujo). Lo mismo para `StartTrial`: solo con alta nueva en ese pedido (hoy se dispararía otra vez desde otro dispositivo).
- **`prueba.html`:** sumar a la nota del precio "La semana gratis es una sola vez por persona: si ya la usaste, Mercado Pago cobra la primera cuota al suscribirte." El checkout de MP muestra "7 días gratis" igual.
- **Etapa:** nueva **5b**, antes de la 6. Corrige lo que ya está publicado (hoy quien repite queda como prueba de un mes y su cobro sin registrar) y la 6 se apoya en esto para el primer cobro.
- **Prueba:** (0) script de solo lectura con el token en la terminal, sobre las suscripciones canceladas del 04 y 05/11: plazo con y sin prueba, `free_trial` en la suscripción y si `/authorized_payments/search` lista el cobro (no está documentado). Si no lo lista, frenar y repensar. (1) Simulaciones de `confirm-trial` y `process-payment` con los cuatro órdenes de llegada, cobro en proceso y rechazado, `fecha_dudosa`, `cobro_en_prueba`, mail con cuenta, y roturas a propósito. (2) Real: cuenta de MP que ya usó el plan → cobra → mensaje de alta paga, perfil sin prueba, `alta_nueva` en Pagos, un `Purchase` y ningún `StartTrial`; cancelar, devolver, limpiar. La prueba sin cobro con una cuenta nueva queda para la etapa 8 si no hay otra cuenta sin usar.
- **Para la revisión legal (antes de la etapa 8):** quien paga así puede pedir la baja con reembolso (botón de arrepentimiento).

## Mantenimiento / pendientes
Lo que no bloquea la Fase 2 ni arriesga a los alumnos actuales. Una línea y su prioridad.
- Baja: si el aviso del cobro llega antes que la página de regreso, `process-payment` loguea `COBRO SIN REGISTRAR: primer cobro de una prueba sin vincular` aunque después `confirm-trial` lo registre. Cambiar el texto en el próximo deploy de `process-payment`.
- Media: si cambia el precio de un programa en `site_config`, hay que cambiar también su plan de prueba en MP (la página de prueba muestra el de `site_config`).
- Media: `create-athlete` da error si el mail ya existe en Auth sin perfil (el admin lo ve en pantalla).
- Baja: al cancelar o editar un plan, MP manda un aviso que `process-payment` trata como suscripción y responde 502 ("Preapproval not found"; visto el 01/11 con el plan de prueba cancelado). Hay que ignorar esos avisos con 200.
