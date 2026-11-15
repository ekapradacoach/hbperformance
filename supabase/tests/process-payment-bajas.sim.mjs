// ============================================================================
// Finanzas, etapa 0a: cancelación de una suscripción desde MP → fecha de fin de acceso (subscription_end).
// Corre avisos de MP contra el código REAL de process-payment. Sin red ni base: MP y Supabase simulados en memoria.
// Datos ficticios (@example.test). Reloj fijo: 2026-11-12 12:00 hora AR.
//
// Correr desde la raíz del repo, ANTES del deploy de process-payment:
//   node supabase/tests/process-payment-bajas.sim.mjs
// Opcional, contra otra versión: node supabase/tests/process-payment-bajas.sim.mjs ruta/a/index.ts
// Sale con código 1 si algún caso falla. Demuestra la lógica, NO cómo se comporta MP en real.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] || path.join(here, '..', 'functions', 'process-payment', 'index.ts');

const RealDate = Date;
const FIXED = RealDate.parse('2026-11-12T15:00:00.000Z');
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
};
const TODAY = '2026-11-12';

// ---- Supabase en memoria ----
let db, mp;
const clone = x => JSON.parse(JSON.stringify(x));
function table(name) {
  const s = { filters: [], op: 'select', limit: null, order: null, asc: false, one: false };
  const run = () => {
    const rows = db[name] || (db[name] = []);
    const match = x => s.filters.every(f => f(x));
    const isWrite = ['insert', 'update', 'upsert', 'delete'].includes(s.op);
    if (isWrite && db.failWrite === name) return { data: null, error: { message: 'escritura rechazada (simulada)' } };
    if (s.op === 'insert' || s.op === 'upsert') { rows.push(clone(s.value)); return { data: null, error: null }; }
    if (s.op === 'update') { rows.filter(match).forEach(x => Object.assign(x, clone(s.value))); return { data: null, error: null }; }
    if (s.op === 'delete') { db[name] = rows.filter(x => !match(x)); return { data: null, error: null }; }
    if (db.failOn === name) return { data: null, error: { message: 'falla simulada' } };
    let out = rows.filter(match);
    if (s.order) out = [...out].sort((a, b) => ((a[s.order] < b[s.order]) === s.asc ? -1 : 1));
    if (s.limit) out = out.slice(0, s.limit);
    if (s.one) return out.length > 1 ? { data: null, error: { message: 'multiple rows' } } : { data: clone(out[0] ?? null), error: null };
    return { data: clone(out), error: null };
  };
  const b = {
    select() { return b; },
    insert(v) { s.op = 'insert'; s.value = v; return b; },
    update(v) { s.op = 'update'; s.value = v; return b; },
    upsert(v) { s.op = 'upsert'; s.value = v; return b; },
    delete() { s.op = 'delete'; return b; },
    eq(k, v) { s.filters.push(x => x[k] === v); return b; },
    in(k, v) { s.filters.push(x => v.includes(x[k])); return b; },
    is(k, v) { s.filters.push(x => (x[k] ?? null) === v); return b; },
    gte(k, v) { s.filters.push(x => x[k] >= v); return b; },
    order(k, o) { s.order = k; s.asc = !!o?.ascending; return b; },
    limit(n) { s.limit = n; return b; },
    maybeSingle() { s.one = true; return b; },
    then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
globalThis.__createClient = () => ({ from: table, auth: { admin: {} } });
globalThis.Deno = { env: { get: () => 'x' }, serve: h => { globalThis.__handler = h; } };

// ---- Mercado Pago simulado: solo la suscripción ----
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const m = u.match(/\/preapproval\/(.+)$/);
  if (m && opts.method !== 'PUT') {
    const sub = { id: m[1], status: 'cancelled', preapproval_plan_id: mp.plan || 'plan-h', external_reference: null, payer_email: '' };
    if (mp.npd !== undefined) sub.next_payment_date = mp.npd;
    return res(sub);
  }
  if (u.includes('resend')) return res({});
  throw new Error('fetch inesperado: ' + u + ' ' + (opts.method || 'GET'));
};

// ---- Datos ficticios ----
const profile = (name, extra = {}) => ({ id: 'u-' + name, full_name: name, email: name + '@example.test', role: 'athlete', program: 'hybrid', subscription_status: 'active', subscription_start: '2026-08-05', subscription_end: null, mp_subscription_id: 'sub-' + name, trial_status: null, ...extra });
const pay = (athlete, paid_at, method = 'mp') => ({ athlete_id: 'u-' + athlete, paid_at, method, amount: 45000 });
const cancelEvent = id => ({ type: 'subscription_preapproval', data: { id } });
const p = (d, name) => d.db.profiles.find(x => x.id === 'u-' + name);

const cases = [
  { name: 'Activa, MP trae next_payment_date: fin = esa fecha', profiles: [profile('ana')], mp: { npd: '2026-12-05T10:00:00.000-04:00' },
    expect: d => d.http === 200 && d.status === 'cancelled' && p(d, 'ana').subscription_status === 'cancelled' && p(d, 'ana').subscription_end === '2026-12-05' && d.logs.some(l => l.includes('Baja desde MP') && l.includes('next_payment_date')) },
  { name: 'Sin next_payment_date: último cobro de MP + 1 mes', profiles: [profile('ana')], payments: [pay('ana', '2026-09-20'), pay('ana', '2026-10-20')], mp: {},
    expect: d => p(d, 'ana').subscription_end === '2026-11-20' && d.logs.some(l => l.includes('ultimo_cobro')) },
  { name: 'Último cobro un 31: no se pasa de mes (31/01 → 28/02)', profiles: [profile('ana')], payments: [pay('ana', '2026-01-31')], mp: { npd: null },
    expect: d => p(d, 'ana').subscription_end === '2026-02-28' },
  { name: 'Solo pagos manuales: no se usan, ciclos desde el inicio', profiles: [profile('ana')], payments: [pay('ana', '2026-11-01', 'manual')], mp: {},
    expect: d => p(d, 'ana').subscription_end === '2026-12-05' && d.logs.some(l => l.includes('ciclos_desde_inicio')) },
  { name: 'Pagos de otro alumno no cuentan', profiles: [profile('ana')], payments: [pay('otra', '2026-11-10')], mp: {},
    expect: d => p(d, 'ana').subscription_end === '2026-12-05' },
  { name: 'Sin fecha de MP, sin cobros ni inicio: hoy (hora AR)', profiles: [profile('ana', { subscription_start: null })], mp: {},
    expect: d => p(d, 'ana').subscription_end === TODAY && d.logs.some(l => l.includes('fuente: hoy')) },
  { name: 'next_payment_date ya pasada: se usa igual (corta el acceso)', profiles: [profile('ana')], mp: { npd: '2026-11-01T10:00:00.000-04:00' },
    expect: d => p(d, 'ana').subscription_end === '2026-11-01' },
  { name: 'Baja ya cargada (perfil o admin): no pisa la fecha', profiles: [profile('ana', { subscription_status: 'cancelled', subscription_end: '2026-11-30' })], mp: { npd: '2026-12-05T10:00:00.000-04:00' },
    expect: d => d.http === 200 && p(d, 'ana').subscription_end === '2026-11-30' && !d.logs.some(l => l.includes('Baja desde MP')) },
  { name: 'Aviso repetido: misma fecha, sin cambios', profiles: [profile('ana')], mp: { npd: '2026-12-05T10:00:00.000-04:00' }, twice: true,
    expect: d => d.http === 200 && p(d, 'ana').subscription_end === '2026-12-05' },
  { name: 'Dos perfiles con la misma suscripción: solo completa el que no tiene fecha', profiles: [profile('ana'), profile('otra', { mp_subscription_id: 'sub-ana', subscription_end: '2026-11-25' })], mp: { npd: '2026-12-05T10:00:00.000-04:00' },
    expect: d => p(d, 'ana').subscription_end === '2026-12-05' && p(d, 'otra').subscription_end === '2026-11-25' && p(d, 'otra').subscription_status === 'cancelled' },
  { name: 'Otro alumno con otra suscripción: no se toca', profiles: [profile('ana'), profile('beto')], mp: { npd: '2026-12-05T10:00:00.000-04:00' },
    expect: d => p(d, 'beto').subscription_status === 'active' && p(d, 'beto').subscription_end === null },
  { name: 'Suscripción sin perfil vinculado: 200, nada cambia', profiles: [profile('beto')], mp: { npd: '2026-12-05T10:00:00.000-04:00' }, sub: 'sub-nadie',
    expect: d => d.http === 200 && d.status === 'cancelled' && p(d, 'beto').subscription_status === 'active' },
  { name: 'Falla leer profiles: 500, perfil igual; el reintento completa', profiles: [profile('ana')], mp: { npd: '2026-12-05T10:00:00.000-04:00' }, failOn: 'profiles', retry: true,
    expect: d => d.first.http === 500 && d.first.p.subscription_status === 'active' && d.first.p.subscription_end === null && d.http === 200 && p(d, 'ana').subscription_end === '2026-12-05' },
  { name: 'Falla guardar profiles: 500; el reintento completa', profiles: [profile('ana')], mp: { npd: '2026-12-05T10:00:00.000-04:00' }, failWrite: 'profiles', retry: true,
    expect: d => d.first.http === 500 && d.first.p.subscription_end === null && d.http === 200 && p(d, 'ana').subscription_status === 'cancelled' && p(d, 'ana').subscription_end === '2026-12-05' },
  { name: 'Falla leer payments (sin next_payment_date): 500 con cancelled; el reintento pone la fecha', profiles: [profile('ana')], payments: [pay('ana', '2026-10-20')], mp: {}, failOn: 'payments', retry: true,
    expect: d => d.first.http === 500 && d.first.p.subscription_status === 'cancelled' && d.first.p.subscription_end === null && d.logs.length >= 0 && p(d, 'ana').subscription_end === '2026-11-20' },
  { name: 'Prueba en curso: sigue el camino de la prueba (fin = día de fin de la prueba)', profiles: [profile('luz', { program: 'crossfit', trial_status: 'in_trial', trial_started_at: '2026-11-08T15:00:00.000Z', trial_ends_at: '2026-11-15T15:00:00.000Z' })], mp: { plan: 'plan-t', npd: '2026-12-05T10:00:00.000-04:00' },
    expect: d => d.status === 'trial_cancelled' && p(d, 'luz').subscription_end === '2026-11-15' && p(d, 'luz').trial_status === 'cancelled' },
];

// ---- Cargar el código real ----
const tmp = mkdtempSync(path.join(tmpdir(), 'ppb-sim-'));
const log = console.log;
let failed = 0, logs = [];
try {
  const code = readFileSync(source, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__createClient');
  const ts = path.join(tmp, 'index.ts'), js = path.join(tmp, 'index.mjs');
  writeFileSync(ts, code);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['-y', 'esbuild@0.24.0', ts, '--loader:.ts=ts', '--format=esm', '--log-level=warning', '--outfile=' + js], { stdio: 'inherit', shell: process.platform === 'win32' });
  await import(pathToFileURL(js).href);
  console.log = console.warn = console.error = (...a) => { logs.push(a.join(' ')); };

  for (const c of cases) {
    db = { profiles: clone(c.profiles), payments: clone(c.payments || []), pending_subscriptions: [], trial_reviews: [], mp_webhook_log: [],
      site_config: [{ key: 'mp_plan_hybrid', value: 'plan-h' }, { key: 'mp_plan_crossfit', value: 'plan-c' }, { key: 'mp_trial_plan_crossfit', value: 'plan-t' }] };
    db.failOn = c.failOn || null; db.failWrite = c.failWrite || null;
    mp = clone(c.mp || {});
    logs = [];
    const event = cancelEvent(c.sub || c.profiles[0].mp_subscription_id);
    const send = async () => {
      const r = await globalThis.__handler(new Request('http://sim/', { method: 'POST', body: JSON.stringify(event) }));
      const body = await r.json().catch(() => ({}));
      return { http: r.status, status: body.status };
    };
    let r = await send(), first = null;
    if (c.twice) r = await send();
    if (c.retry) { first = { http: r.http, p: clone(db.profiles[0]) }; db.failOn = null; db.failWrite = null; r = await send(); }
    const d = { ...r, db, logs, first };
    let ok = false;
    try { ok = !!c.expect(d); } catch (_) { ok = false; }
    if (logs.some(l => /baja/i.test(l) && /@/.test(l))) { ok = false; log('         un log de baja contiene un mail'); }
    if (!ok) { failed++; log(`FALLA  ${c.name}\n         http ${r.http} ${r.status}\n         perfiles ${JSON.stringify(db.profiles.map(x => [x.id, x.subscription_status, x.subscription_end]))}\n         logs ${JSON.stringify(logs.filter(l => /baja|BAJA/.test(l)))}`); }
    else log(`ok     ${c.name}`);
  }
} finally {
  globalThis.Date = RealDate;
  rmSync(tmp, { recursive: true, force: true });
}
log(`\n${cases.length - failed} de ${cases.length} casos OK`);
process.exit(failed ? 1 : 0);
