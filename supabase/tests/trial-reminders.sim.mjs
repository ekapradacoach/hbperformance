// ============================================================================
// Etapa 6: simulación de trial-reminders (mail del día 6). Sin red ni base: Supabase y Resend simulados.
// Correr desde la raíz del repo, antes de cada deploy de trial-reminders:
//   node supabase/tests/trial-reminders.sim.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] || path.join(here, '..', 'functions', 'trial-reminders', 'index.ts');
const SECRET = 'secreto-simulado';
const H = 3600e3;
const at = ms => new Date(Date.now() + ms).toISOString();

let db, mails, resendFails;
const clone = x => JSON.parse(JSON.stringify(x));
function table(name) {
  const s = { filters: [], op: 'select', limit: null, returning: false };
  const run = () => {
    const rows = db[name];
    const match = x => s.filters.every(f => f(x));
    if (s.op === 'update') {
      if (db.failUpdate) return { data: null, error: { message: 'falla' } };
      const hit = rows.filter(match); hit.forEach(x => Object.assign(x, clone(s.value)));
      return { data: s.returning ? clone(hit.map(h => ({ id: h.id }))) : null, error: null };
    }
    if (db.failRead === name) return { data: null, error: { message: 'falla' } };
    let out = rows.filter(match);
    if (s.limit) out = out.slice(0, s.limit);
    return { data: clone(out), error: null };
  };
  const b = {
    select() { if (s.op !== 'select') s.returning = true; return b; }, update(v) { s.op = 'update'; s.value = v; return b; },
    eq(k, v) { s.filters.push(x => x[k] === v); return b; }, is(k, v) { s.filters.push(x => (x[k] ?? null) === v); return b; },
    in(k, v) { s.filters.push(x => v.includes(x[k])); return b; },
    gt(k, v) { s.filters.push(x => x[k] > v); return b; }, lte(k, v) { s.filters.push(x => x[k] <= v); return b; },
    limit(n) { s.limit = n; return b; }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
globalThis.__createClient = () => ({ from: table });
globalThis.Deno = { env: { get: k => (k === 'CRON_SECRET' ? db.secret : k === 'RESEND_API_KEY' ? db.resendKey : 'x') }, serve: h => { globalThis.__handler = h; } };
globalThis.fetch = async (url, opts = {}) => {
  const b = JSON.parse(opts.body);
  mails.push(b);
  return resendFails ? { ok: false, status: 500 } : { ok: true, status: 200 };
};

const prof = (id, extra = {}) => ({ id, full_name: 'Lucia Prueba', email: id + '@example.test', program: 'crossfit', trial_status: 'in_trial', trial_ends_at: at(20 * H), trial_reminder_sent_at: null, ...extra });
const CONFIG = [{ key: 'price_crossfit_ars', value: '45000' }, { key: 'price_hybrid_ars', value: '45000' }, { key: 'price_corredores_ars', value: '40000' }];
const OK = { 'x-cron-secret': SECRET };

const cases = [
  { name: 'Sin secreto: 401 y no manda nada', profiles: [prof('a')], headers: {}, expect: (r, d) => r.status === 401 && mails.length === 0 && !d.profiles[0].trial_reminder_sent_at },
  { name: 'Secreto equivocado: 401', profiles: [prof('a')], headers: { 'x-cron-secret': 'otro' }, expect: r => r.status === 401 && mails.length === 0 },
  { name: 'CRON_SECRET sin configurar: 401 aunque el header venga vacío', profiles: [prof('a')], secret: '', headers: { 'x-cron-secret': '' }, expect: r => r.status === 401 && mails.length === 0 },
  { name: 'Termina en 20 horas: manda un mail y lo marca', profiles: [prof('a')], expect: (r, d) => r.status === 200 && mails.length === 1 && mails[0].to === 'a@example.test' && !!d.profiles[0].trial_reminder_sent_at
      && /\$45\.000/.test(mails[0].html) && /Cancelar suscripción/.test(mails[0].html) && /Suscripciones/.test(mails[0].html) && mails[0].subject === 'Tu semana gratis está por terminar' },
  { name: 'Dos corridas: el mail sale una sola vez', profiles: [prof('a')], twice: true, expect: () => mails.length === 1 },
  { name: 'Termina en 40 horas: todavía no', profiles: [prof('a', { trial_ends_at: at(40 * H) })], expect: () => mails.length === 0 },
  { name: 'Ya terminó: no manda', profiles: [prof('a', { trial_ends_at: at(-H) })], expect: () => mails.length === 0 },
  { name: 'Prueba de 1 día (termina en 10 horas): manda', profiles: [prof('a', { trial_ends_at: at(10 * H) })], expect: () => mails.length === 1 },
  { name: 'Ya convertida, cancelada o con cobro rechazado: no manda', profiles: [prof('a', { trial_status: 'converted' }), prof('b', { trial_status: 'cancelled' }), prof('c', { trial_status: 'charge_rejected' })], expect: () => mails.length === 0 },
  { name: 'Alumno sin prueba: no manda', profiles: [prof('a', { trial_status: null, trial_ends_at: null })], expect: () => mails.length === 0 },
  { name: 'Ya avisado: no repite', profiles: [prof('a', { trial_reminder_sent_at: at(-H) })], expect: () => mails.length === 0 },
  { name: 'Precio por programa: Corredores $40.000', profiles: [prof('a', { program: 'corredores' })], expect: () => mails.length === 1 && /\$40\.000/.test(mails[0].html) && /Fuerza para Corredores/.test(mails[0].html) },
  { name: 'Sin precio del programa: no manda y sigue con los demás', profiles: [prof('a', { program: 'otro' }), prof('b')], expect: (r, d) => mails.length === 1 && mails[0].to === 'b@example.test' && !d.profiles[0].trial_reminder_sent_at },
  { name: 'Resend falla: desmarca para poder reintentar', profiles: [prof('a')], resendFails: true, expect: (r, d) => mails.length === 1 && !d.profiles[0].trial_reminder_sent_at && r.body.failed === 1 },
  { name: 'No se pueden leer las pruebas: 500 sin mails', profiles: [prof('a')], failRead: 'profiles', expect: r => r.status === 500 && mails.length === 0 },
  { name: 'No se pueden leer los precios: 500 sin mails', profiles: [prof('a')], failRead: 'site_config', expect: r => r.status === 500 && mails.length === 0 },
  { name: 'Falla la marca: no manda (no arriesga duplicados)', profiles: [prof('a')], failUpdate: true, expect: () => mails.length === 0 },
  { name: 'Sin RESEND_API_KEY: 500 sin tocar nada', profiles: [prof('a')], resendKey: '', expect: (r, d) => r.status === 500 && mails.length === 0 && !d.profiles[0].trial_reminder_sent_at },
  { name: 'Nombre con HTML: va escapado', profiles: [prof('a', { full_name: '<b>Lu</b> Prueba' })], expect: () => mails.length === 1 && !mails[0].html.includes('<b>Lu</b>') && mails[0].html.includes('&lt;b&gt;Lu') },
  { name: 'Método GET: 401', profiles: [prof('a')], method: 'GET', expect: r => r.status === 401 && mails.length === 0 },
];

const tmp = mkdtempSync(path.join(tmpdir(), 'tr-sim-'));
const log = console.log;
let failed = 0, logs = [];
try {
  const code = readFileSync(source, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__createClient');
  const ts = path.join(tmp, 'index.ts'), js = path.join(tmp, 'index.mjs');
  writeFileSync(ts, code);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['-y', 'esbuild@0.24.0', ts, '--loader:.ts=ts', '--format=esm', '--log-level=warning', '--outfile=' + js], { stdio: 'inherit', shell: process.platform === 'win32' });
  await import(pathToFileURL(js).href);
  console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
  for (const c of cases) {
    db = { profiles: clone(c.profiles), site_config: CONFIG, secret: c.secret ?? SECRET, resendKey: c.resendKey ?? 're_x', failRead: c.failRead, failUpdate: c.failUpdate };
    mails = []; resendFails = !!c.resendFails; logs = [];
    const call = async () => {
      const r = await globalThis.__handler(new Request('http://sim/', { method: c.method || 'POST', headers: c.headers ?? OK, body: c.method === 'GET' ? undefined : '{}' }));
      return { status: r.status, body: await r.json() };
    };
    let r = await call();
    if (c.twice) r = await call();
    let ok = false;
    try { ok = !!c.expect(r, db); } catch (_) {}
    if (logs.some(l => /@/.test(l))) { ok = false; log('         el log contiene un mail'); }
    if (!ok) { failed++; log(`FALLA  ${c.name}\n         ${JSON.stringify(r)} mails ${mails.length}`); }
    else log(`ok     ${c.name}`);
  }
  log(`\n${cases.length - failed} de ${cases.length} casos OK`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
