// ============================================================================
// Simulación de pedidos contra el código REAL de start-trial.
// No usa la red ni la base: Supabase está simulado en memoria. Datos ficticios (@example.test).
//
// Correr desde la raíz del repo, ANTES de cada deploy de start-trial:
//   node supabase/tests/start-trial.sim.mjs
//
// Sale con código 1 si algún caso falla. Demuestra la lógica de la función, NO cómo se comportan Supabase o MP en real.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] || path.join(here, '..', 'functions', 'start-trial', 'index.ts');
const GENERIC = '{"ok":false,"error":"No pudimos iniciar tu prueba, escribinos"}';
const MIN = 6e4;
const ago = ms => new Date(Date.now() - ms).toISOString();

// ---- Supabase en memoria ----
let db;
const likeToRe = p => new RegExp('^' + p.replace(/\\(.)|[%_]|[.*+?^${}()|[\]\\]/g, (m, esc) => (esc ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : m === '%' ? '.*' : m === '_' ? '.' : '\\' + m)) + '$', 'i');
function table(name) {
  const s = { filters: [], op: 'select' };
  const run = () => {
    if (db.fail?.[name + ':' + s.op]) return { data: null, count: null, error: { message: 'falla simulada' } };
    const rows = db[name] || (db[name] = []);
    const match = x => s.filters.every(f => f(x));
    if (s.op === 'insert') {
      const value = { id: name + '-' + (db.seq = (db.seq || 0) + 1), created_at: new Date().toISOString(), ...s.value };
      if (name === 'pending_subscriptions' && value.is_trial) {
        if (db.raceOnce) { rows.push({ ...value, id: 'ganador' }); db.raceOnce = false; return { data: null, error: { code: '23505', message: 'duplicate key' } }; }
        if (rows.some(r => r.is_trial && r.email.trim().toLowerCase() === value.email.trim().toLowerCase())) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      rows.push(value);
      return { data: { id: value.id }, error: null };
    }
    if (s.op === 'update') { rows.filter(match).forEach(x => Object.assign(x, s.value)); return { data: null, error: null }; }
    if (s.op === 'delete') { db[name] = rows.filter(x => !match(x)); return { data: null, error: null }; }
    const out = rows.filter(match);
    if (s.head) return { data: null, count: out.length, error: null };
    if (s.one) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  };
  const b = {
    select(_c, o) { if (o?.head) s.head = true; return b; },
    insert(v) { s.op = 'insert'; s.value = v; return b; },
    update(v) { s.op = 'update'; s.value = v; return b; },
    delete() { s.op = 'delete'; return b; },
    eq(k, v) { s.filters.push(x => x[k] === v); return b; },
    gte(k, v) { s.filters.push(x => x[k] >= v); return b; },
    lt(k, v) { s.filters.push(x => x[k] < v); return b; },
    ilike(k, p) { const re = likeToRe(p); s.filters.push(x => re.test(x[k])); return b; },
    maybeSingle() { s.one = true; return b; },
    single() { s.one = true; return b; },
    then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
globalThis.__createClient = () => ({
  from: table,
  auth: { admin: { listUsers: async () => {
    db.calls.push('listUsers');
    if (db.fail?.listUsers) return { data: null, error: { message: 'falla simulada' } };
    return { data: { users: db.authUsers }, error: null };
  } } },
});
globalThis.Deno = { env: { get: k => (k === 'SERVICE_ROLE_KEY' ? 'clave-simulada' : 'x') }, serve: h => { globalThis.__handler = h; } };
globalThis.fetch = async u => { throw new Error('fetch inesperado: ' + u); };

// ---- Datos ficticios ----
const PLAN = { key: 'mp_trial_plan_crossfit', value: 'plan-prueba' };
const form = (extra = {}) => ({ full_name: 'Lucia Prueba', email: 'lucia@example.test', phone: '1100000000', program: 'crossfit', ...extra });
const trialPending = (email, minutes = 60, extra = {}) => ({ id: 'previo', full_name: 'Viejo', email, phone: null, program: 'crossfit', is_trial: true, created_at: ago(minutes * MIN), ...extra });
const LINK = 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=plan-prueba';
const isGeneric = { generic: true };

const cases = [
  { name: 'Mail nuevo: crea el pending de prueba y devuelve id y link', body: form(),
    expect: { ok: true, link: LINK, trialPendings: 1 }, check: d => d.pending_subscriptions[0].is_trial === true && d.pending_subscriptions[0].email === 'lucia@example.test' },
  { name: 'Mail con mayúsculas y espacios: se guarda normalizado', body: form({ email: '  LUCIA@Example.TEST ' }),
    expect: { ok: true, trialPendings: 1 }, check: d => d.pending_subscriptions[0].email === 'lucia@example.test' },
  { name: 'Alias con +: se acepta', body: form({ email: 'lucia+prueba@example.test' }), expect: { ok: true, trialPendings: 1 } },
  { name: 'Guarda los UTM y recorta a 100 caracteres', body: form({ utm_source: 'instagram', utm_campaign: 'x'.repeat(150) }),
    expect: { ok: true }, check: d => d.pending_subscriptions[0].utm_source === 'instagram' && d.pending_subscriptions[0].utm_campaign.length === 100 },
  { name: 'Plan guardado como dirección: se extrae el id', config: [{ ...PLAN, value: 'https://x/checkout?preapproval_plan_id=plan-prueba' }], body: form(), expect: { ok: true, link: LINK } },
  { name: 'No toma campos de más: el formulario no elige id ni contacto', body: form({ id: 'mio', contacted_at: 'x', is_trial: false, created_at: '2000-01-01' }),
    expect: { ok: true, trialPendings: 1 }, check: d => d.pending_subscriptions[0].id !== 'mio' && !d.pending_subscriptions[0].contacted_at && d.pending_subscriptions[0].created_at !== '2000-01-01' },

  { name: 'Tiene perfil', profiles: ['lucia@example.test'], body: form(), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Tiene perfil con otra mayúscula', profiles: ['LUCIA@Example.test'], body: form(), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Tiene perfil y escribe en mayúsculas', profiles: ['lucia@example.test'], body: form({ email: 'LUCIA@EXAMPLE.TEST' }), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Tiene cuenta en Auth sin perfil', authUsers: ['Lucia@example.test'], body: form(), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Comodín en el mail: a_b no coincide con el perfil axb', profiles: ['axb@example.test'], body: form({ email: 'a_b@example.test' }), expect: { ok: true, trialPendings: 1 } },
  { name: 'Otro programa', body: form({ program: 'hybrid' }), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Sin programa', body: form({ program: undefined }), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Mail inválido', body: form({ email: 'lucia@' }), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Mail que no es texto', body: form({ email: { $ne: 1 } }), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Nombre vacío', body: form({ full_name: ' ' }), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Nombre demasiado largo', body: form({ full_name: 'x'.repeat(101) }), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Teléfono demasiado largo', body: form({ phone: '1'.repeat(31) }), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Cuerpo que no es JSON', raw: 'hola', expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Método GET', method: 'GET', expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Falta el plan en site_config', config: [], body: form(), expect: { ...isGeneric, trialPendings: 0 } },
  { name: 'Plan con formato inválido', config: [{ ...PLAN, value: '#' }], body: form(), expect: { ...isGeneric, trialPendings: 0 } },

  // Opción A: el pending sin usar se reusa y renueva su fecha.
  { name: 'Reintento: reusa el pending y renueva la fecha y los datos', pendings: [trialPending('lucia@example.test', 300)], body: form(),
    expect: { ok: true, pendingId: 'previo', trialPendings: 1 }, check: d => d.pending_subscriptions[0].created_at > ago(MIN) && d.pending_subscriptions[0].full_name === 'Lucia Prueba' },
  { name: 'Reintento con otra mayúscula: reusa', pendings: [trialPending('LUCIA@example.test')], body: form(), expect: { ok: true, pendingId: 'previo', trialPendings: 1 } },
  { name: 'Pending normal del mismo mail: no lo toca y crea el de prueba', pendings: [trialPending('lucia@example.test', 5, { id: 'normal', is_trial: false, full_name: 'Pago' })], body: form(),
    expect: { ok: true, trialPendings: 1 }, check: d => d.pending_subscriptions.find(p => p.id === 'normal').full_name === 'Pago' },
  { name: 'Doble clic: el índice único rechaza y se reusa el otro', raceOnce: true, body: form(), expect: { ok: true, pendingId: 'ganador', trialPendings: 1 } },
  { name: 'Falla al renovar', pendings: [trialPending('lucia@example.test')], fail: { 'pending_subscriptions:update': true }, body: form(), expect: isGeneric },

  // Límites
  { name: 'Quinto intento de la IP: pasa', attempts: 4, body: form(), expect: { ok: true, attemptsAfter: 5 } },
  { name: 'Sexto intento de la IP: rechazado', attempts: 5, body: form(), expect: { ...isGeneric, trialPendings: 0, attemptsAfter: 5 } },
  { name: 'Otra IP no comparte el límite', attempts: 5, ip: '203.0.113.9', body: form(), expect: { ok: true } },
  { name: 'Intentos de hace más de una hora no cuentan', attempts: 5, attemptsAge: 2 * 60 * MIN, body: form(), expect: { ok: true } },
  { name: 'Los datos inválidos también cuentan como intento', body: form({ email: 'mal' }), expect: { ...isGeneric, attemptsAfter: 1 } },
  { name: 'Borra intentos de más de 7 días', attempts: 2, attemptsAge: 8 * 24 * 60 * MIN, body: form(), expect: { ok: true, attemptsAfter: 1 } },
  { name: 'Límite total: el pending 31 de la hora se rechaza', pendings: Array.from({ length: 30 }, (_, i) => trialPending(`p${i}@example.test`, 5, { id: 'p' + i })), body: form(), expect: { ...isGeneric, trialPendings: 30 } },
  { name: 'Límite total: el reintento de un pending propio pasa igual', pendings: Array.from({ length: 30 }, (_, i) => trialPending(i ? `p${i}@example.test` : 'lucia@example.test', 5, { id: 'p' + i })), body: form(), expect: { ok: true, pendingId: 'p0', trialPendings: 30 } },

  // Si algo falla, nunca se da por elegible.
  ...[
    ['Falla leer intentos', 'trial_attempts:select'], ['Falla guardar el intento', 'trial_attempts:insert'], ['Falla leer el plan', 'site_config:select'],
    ['Falla leer perfiles', 'profiles:select'], ['Falla leer Auth', 'listUsers'], ['Falla leer pendings', 'pending_subscriptions:select'],
    ['Falla crear el pending', 'pending_subscriptions:insert'],
  ].map(([name, f]) => ({ name, fail: { [f]: true }, body: form(), expect: { ...isGeneric, trialPendings: 0 } })),
];

// ---- Cargar el código real ----
const tmp = mkdtempSync(path.join(tmpdir(), 'st-sim-'));
const log = console.log;
let failed = 0;
try {
  const code = readFileSync(source, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__createClient');
  const ts = path.join(tmp, 'index.ts'), js = path.join(tmp, 'index.mjs');
  writeFileSync(ts, code);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['-y', 'esbuild@0.24.0', ts, '--loader:.ts=ts', '--format=esm', '--log-level=warning', '--outfile=' + js], { stdio: 'inherit', shell: process.platform === 'win32' });
  let logs = [];
  console.log = console.warn = console.error = (...a) => { logs.push(a.join(' ')); };
  await import(pathToFileURL(js).href);

  const send = (c, ip) => globalThis.__handler(new Request('http://sim/', {
    method: c.method || 'POST',
    headers: { 'x-forwarded-for': ip + ', 10.0.0.1' },
    body: (c.method || 'POST') === 'GET' ? undefined : (c.raw ?? JSON.stringify(c.body)),
  }));
  // El hash de la IP lo calcula la función: se obtiene con un pedido previo sobre una base vacía.
  const hashOf = async ip => {
    db = { trial_attempts: [], pending_subscriptions: [], profiles: [], site_config: [], authUsers: [], calls: [] };
    await send({ raw: 'x' }, ip);
    return db.trial_attempts[0].ip_hash;
  };
  const IP = '198.51.100.7';
  const mine = await hashOf(IP);

  for (const c of cases) {
    db = {
      trial_attempts: Array.from({ length: c.attempts || 0 }, () => ({ ip_hash: mine, created_at: ago(c.attemptsAge ?? 10 * MIN) })),
      pending_subscriptions: (c.pendings || []).map(p => ({ ...p })),
      profiles: (c.profiles || []).map((email, i) => ({ id: 'u' + i, email })),
      site_config: c.config ?? [PLAN],
      authUsers: (c.authUsers || []).map((email, i) => ({ id: 'a' + i, email })),
      calls: [], fail: c.fail, raceOnce: c.raceOnce,
    };
    logs = [];
    const r = await send(c, c.ip || IP);
    const text = await r.text();
    const body = JSON.parse(text);
    const trial = db.pending_subscriptions.filter(p => p.is_trial).length;
    const diffs = [];
    const e = c.expect;
    if (r.status !== 200) diffs.push('status ' + r.status);
    if (e.generic && text !== GENERIC) diffs.push('no es la respuesta genérica: ' + text);
    if (e.ok && !(body.ok === true && body.pending_id && body.init_point)) diffs.push('esperaba ok: ' + text);
    if (e.link && body.init_point !== e.link) diffs.push('link: ' + body.init_point);
    if (e.pendingId && body.pending_id !== e.pendingId) diffs.push('pending: ' + body.pending_id);
    if (e.trialPendings !== undefined && trial !== e.trialPendings) diffs.push(`pendings de prueba: esperado ${e.trialPendings}, obtenido ${trial}`);
    if (e.attemptsAfter !== undefined && db.trial_attempts.length !== e.attemptsAfter) diffs.push(`intentos: esperado ${e.attemptsAfter}, obtenido ${db.trial_attempts.length}`);
    if (c.check && !c.check(db)) diffs.push('no cumple la verificación del caso');
    if (logs.some(l => /@/.test(l))) diffs.push('el log contiene un mail');
    if (JSON.stringify(db.trial_attempts).includes(c.ip || IP)) diffs.push('la IP quedó sin hash');
    if (diffs.length) { failed++; log(`FALLA  ${c.name}`); diffs.forEach(d => log('         ' + d)); }
    else log(`ok     ${c.name}`);
  }
  log(`\n${cases.length - failed} de ${cases.length} casos OK`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
