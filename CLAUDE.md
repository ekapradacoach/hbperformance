# CLAUDE.md — Guía del proyecto HB Performance

> **Para Claude:** Al **iniciar** cada sesión, leé este archivo y `CONTEXTO.md` antes de tocar nada.
> Al **finalizar** cada tarea, actualizá `CONTEXTO.md` con lo que se hizo (fecha, cambio, decisiones).

## Qué es el proyecto
Landing page de **HB Performance** — gimnasio de entrenamiento híbrido + coaching online.
Sitio estático, **sin frameworks ni dependencias** (HTML + CSS + JS puro). Todo en `index.html`
con CSS y JS embebidos. Funciona offline salvo las fuentes de Google Fonts.

## Archivos
```
HB Performance/
├── index.html                ← landing principal (hero, programas, asesorías, testimonios)
├── crossfit.html             ← sub-página programa CrossFit ✅
├── hybrid.html               ← sub-página programa Hybrid Evolution ✅
├── fuerza-corredores.html    ← sub-página programa Fuerza para Corredores ✅
├── asesoria-erika.html       ← página asesoría Erika Prada ✅
├── asesoria-gonza.html       ← página asesoría Gonza Gonda ✅
├── logo.jpg                  ← logo original (fondo negro)
├── logo.png                  ← lockup completo transparente (usado en footer)
├── logo-hb.png / logo-perf.png ← partes del logo para el navbar horizontal
├── images/                   ← img1.jpg … img8.jpg (slideshow hero) + coach-erika.png / coach-gonza.png
├── CLAUDE.md                 ← este archivo (guía + reglas de trabajo)
└── CONTEXTO.md               ← bitácora: registro cronológico de cambios y decisiones
```
Todas las sub-páginas ✅ creadas (programas + asesorías).

### Páginas de asesorías (asesoria-erika / asesoria-gonza)
Mismo navbar/footer/estilo. Estructura: **hero con foto del coach a pantalla** (`.coach-hero-bg`
cover + `.coach-hero-overlay` gradiente) + back-link "← Volver" + badge + "Asesoría *personalizada*"
+ subtítulo → intro → **Especialidades: acordeón de 3** (uno abierto a la vez, `max-height` animado,
ícono "+"→"×") → **Qué incluye** (lista emojis) → **nota `.asesoria-nota`** ("Las asesorías son
personalizadas. El valor se coordina directamente con tu coach.") → **CTA WhatsApp** (`btn-filled`).
⚠️ **Ya NO hay precio ni botones de pago** (MP/PayPal): se eliminó la sección de precio (2026-07-23);
solo queda la nota y el CTA de WhatsApp. (Las reglas CSS `.price-box` quedaron sin uso, inofensivas.)
- Links WhatsApp con mensaje pre-cargado: Erika `wa.me/5491136433379` · Gonza `wa.me/5491122895924`.
- Fotos hero: `coach-erika.png` (bg-position `center 18%`) · `coach-gonza.png` (`center 8%`).

### Sub-páginas de programas (crossfit / hybrid / fuerza-corredores)
Mismo navbar/footer/estilo que `index.html`. Estructura: hero corto (back-link "← Volver a
programas" + badge + título con acento + subtítulo) → layout 2 columnas (izq: 2 placeholders
"foto programa" 4:3 · der: descripción, listas con check dorado, caja WodUp, caja de precio) →
banda CTA "¿Tenés dudas? Escribinos" (`#whatsapp`).
- **Precio con DOS botones**: MP `btn-filled` "Suscribirme — $XX.000 ARS" (`#mp-[prog]`) +
  PayPal `btn-outline` "Subscribe — USD XX" (`#paypal-[prog]`). Lado a lado; apilados en ≤600px.
- Montos: crossfit 45.000/USD40 · hybrid 45.000/USD40 · corredores 40.000/USD35.
- `hybrid.html` tiene sección **"Elegí tu plan"** con 2 cards (`.level-card`): "Plan 3 días + 1
  corrida" y "Plan 4 días + 1 corrida".
- **Fotos** (2 por página, `.prog-media img` 4:3, `object-fit:cover`, bordes redondeados):
  crossfit `cross-1/2.jpg` · hybrid `hybrid-1.PNG` + `hybrid-2.JPEG` · corredores `corredores-1/2.JPEG`.
  ⚠️ `cross-2.jpg` = 21 MB → optimizar cuando el usuario confirme. (`hybrid-1.JPEG` fue eliminada;
  ahora es `hybrid-1.PNG`, liviana.)

### Cards de programas en index.html — imagen de portada única `.card-cover`
Cada card usa **una sola imagen de portada** (`images/card-crossfit.png` · `card-hybrid.png` ·
`card-corredores.png`, 1200×675 = 16:9). `.program-card .card-cover`: `aspect-ratio 16/9;
object-fit:cover; object-position:center`. Bordes redondeados arriba vía `overflow:hidden` del card;
glow dorado en `.program-card:hover`.
- **Mobile ≤768px:** cards compactas → `.card-cover` `height:200px` (aspect auto), `card-body`
  padding `18px 20px`, h3 1.5rem, gap grid 20px.
- (Histórico: antes había un componente `.split-photo` de 2 fotos con diagonal dorada + encuadre por
  cara con `background-size/position`; se reemplazó por la portada única. Las fotos sueltas
  `cross-*`/`hybrid-*`/`corredores-*` quedan solo en las sub-páginas de programa.)
- Placeholders de pago/contacto pendientes de enlazar (`#mp-*`, `#paypal-*`, `#whatsapp`).

## Identidad visual (NO cambiar sin pedido explícito)
Definida en `:root` como CSS custom properties.
- Fondo dominante: `#0A0A0A` · Cards/secciones: `#1A1A1A` · Footer: `#0D0D0D`
- Acento dorado: `#F5A800` (CTAs, bordes, highlights)
- Texto: `#FFFFFF` primario, `#AAAAAA` secundario · Placeholders: `#2A2A2A` / `#666666`

## Tipografía (sistema actual — definitivo según feedback del usuario)
- **Títulos:** `Inter` bold (700/800), **caja normal** (NO mayúsculas, NO condensada),
  `letter-spacing: -1px`. Look "sans sólido y apretado".
- **Palabras de acento:** `Playfair Display` **cursiva** dorada, inline dentro del título
  (clase `.accent`). Ej: "Entrená con *propósito*".
- **Cuerpo:** `Inter` 400–600.
- Referencia que le gusta al usuario: hero de HBLab (sans bold + acento serif cursiva inline + badge pill).
- ❌ Descartadas por feedback: Barlow Condensed, Oswald/condensadas, títulos en mayúsculas grandes.

## Estructura de la página (index.html)
Navbar fija → Hero (slideshow) → Programas (`#programas`) → Asesorías (`#asesorias`)
→ Testimonios (`#testimonios`) → Footer.
La sección "Quiénes Somos" (`#nosotros`) **fue eliminada** (negocio a distancia).

### Navbar — botón "Ingresar"
A la derecha de los links (Programas | Asesorías | Testimonios), como último `<li>` del `.nav-links`
(`li.nav-login`), un botón **"Ingresar"** (`a.btn-ingresar`) que apunta a `app/login.html` (portal).
Estilo: borde dorado `#F5A800`, fondo transparente, texto dorado; **hover** → fondo dorado + texto negro.
Desktop: separado del resto con un divisor a la izquierda (`border-left` + `padding-left`). Mobile (≤768px):
sin divisor, aparece **centrado como último item** del menú hamburguesa desplegable. Al estar dentro de
`#navLinks`, el JS existente ya le cierra el menú al clickear.

### Testimonios — muro de capturas (`.testi-wall`)
Muro tipo mampostería con 8 capturas reales `images/testimonio-1.JPEG`…`8.JPEG` (proporciones
variadas). CSS `column-count` **3 desktop / 2 ≤768px / 1 ≤480px**, `column-gap 20px`. `.testi-card`:
`#1A1A1A`, `border-radius 12px`, sin padding, `break-inside:avoid`; img `width:100%; height:auto`.
Hover: `scale(1.02)` + borde dorado + glow. Fade-in en el contenedor (no por card, para no chocar con
el hover-transform). Se muestran **4** y un botón **"Ver más"** (`#testiToggle`) togglea `.expanded`
en el muro para revelar las 4 restantes (`.testi-more`), cambiando a "Ver menos".

## Reglas técnicas
- Mobile-first, totalmente responsive. `scroll-behavior: smooth`.
- Animaciones fade-in con `IntersectionObserver` (clase `.fade-in` → `.visible`).
- Imágenes placeholder: div gris `#2A2A2A` con label `#666666`.
- HTML5 semántico (`header`, `main`, `section`, `footer`, `nav`).
- Respetar `prefers-reduced-motion` en animaciones del hero.
- Logo: **imágenes reales** (dorado). Navbar = lockup horizontal `logo-hb.png` + `logo-perf.png`;
  footer = `logo.png` completo. Fallback automático a texto "HB *Performance*" si faltan los archivos.

## Cómo trabajar
1. Leé `CONTEXTO.md` para el estado actual.
2. Hacé el cambio pedido respetando colores y tipografía salvo indicación contraria.
3. Probá mentalmente responsive + que no rompa otras secciones.
4. Actualizá `CONTEXTO.md` (entrada nueva con fecha y resumen).
