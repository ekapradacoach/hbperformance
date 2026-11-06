// ============================================================================
// Etapa 7: simulación de trial-alerts (aviso diario al admin). Sin red ni base. Datos ficticios.
// Correr desde la raíz del repo, antes de cada deploy de trial-alerts:
//   node supabase/tests/trial-alerts.sim.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] || path.join(here, '..', 'functions', 'trial-alerts', 'index.ts');
const SECRET = 'secreto-simulado', TO = 'avisos@example.test';
const MIN = 6e4, H = 3600e3, DAY = 864e5;
const at = ms => new Date(Date.now() + ms).toISOString();
const arDay = ms => new Date(Date.now() + ms - 3 * H).toISOString().slice(0, 10);

let db, mails, resendFails;
const clone = x => JSON.parse(JSON.stringify(x));
function table(name) {
  const s = { filters: [] };
  const run = () => {
    if (db.failRead === name) return { data: null, error: { message: 'falla' } };
    return { data: clone(db[name].filter(x => s.filters.every(f => f(x)))), error: null };
  };
  const b = {
    select() { return b; }, eq(k, v) { s.filters.push(x => x[k] === v); return b; },
    is(k, v) { s.filters.push(x => (x[k] ?? null) === v); return b; }, in(k, v) { s.filters.push(x => v.includes(x[k])); return b; },
    lte(k, v) { s.filters.push(x => x[k] != null && x[k] <= v); return b; },
    then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
globalThis.__createClient = () => ({ from: table });
globalThis.Deno = { env: { get: k => (k === 'CRON_SECRET' ? db.secret : k === 'ALERT_EMAIL' ? db.to : k === 'RESEND_API_KEY' ? 're_x' : 'x') }, serve: h => { globalThis.__handler = h; } };
globalThis.fetch = async (u, opts = {}) => { mails.push(JSON.parse(opts.body)); return resendFails ? { ok: false, status: 500 } : { ok: true, status: 200 }; };

const rev = (extra = {}) => ({ preapproval_id: 'sub-' + Math.random(), reason: 'sin_identificar', created_at: at(-2 * H), resolved_at: null, ...extra });
const prof = (extra = {}) => ({ id: 'u' + Math.random(), full_name: 'Lucia Prueba', email: 'lucia@example.test', trial_status: 'in_trial', trial_ends_at: at(2 * DAY), trial_resolved_at: null, ...extra });
const OK = { 'x-cron-secret': SECRET };

const cases = [
  { name: 'Sin secreto: 401', headers: {}, expect: r => r.status === 401 && !mails.length },
  { name: 'Secreto equivocado: 401', headers: { 'x-cron-secret': 'otro' }, expect: r => r.status === 401 && !mails.length },
  { name: 'CRON_SECRET vacío: 401', secret: '', headers: { 'x-cron-secret': '' }, expect: r => r.status === 401 && !mails.length },
  { name: 'Sin ALERT_EMAIL: 500 sin mails', to: '', reviews: [rev()], expect: r => r.status === 500 && !mails.length },
  { name: 'Nada para revisar: no manda', reviews: [rev({ resolved_at: at(-H) })], profiles: [prof()], expect: r => r.status === 200 && r.body.sent === false && !mails.length },
  { name: 'Caso recién creado (10 minutos): todavía no', reviews: [rev({ created_at: at(-10 * MIN) })], expect: r => r.body.sent === false && !mails.length },
  { name: 'Un caso abierto: manda un mail a ALERT_EMAIL', reviews: [rev()], expect: r => r.body.sent === true && r.body.casos === 1 && mails.length === 1 && mails[0].to === TO && /1<\/strong> caso/.test(mails[0].html) },
  { name: 'Prueba vencida hace 2 días sin cobro: cuenta', profiles: [prof({ trial_ends_at: at(-2 * DAY) })], expect: r => r.body.vencidas === 1 && mails.length === 1 },
  { name: 'Prueba vencida hace 3 horas: todavía no', profiles: [prof({ trial_ends_at: at(-3 * H) })], expect: r => r.body.vencidas === 0 && !mails.length },
  { name: 'Pagó después del corte: cuenta', profiles: [prof({ id: 'u-cut', trial_status: 'charge_rejected', trial_resolved_at: at(-2 * DAY) })], payments: [{ athlete_id: 'u-cut', paid_at: arDay(0) }], expect: r => r.body.pagos_despues_del_corte === 1 && mails.length === 1 },
  { name: 'Corte sin pagos posteriores: no cuenta', profiles: [prof({ id: 'u-cut', trial_status: 'charge_rejected', trial_resolved_at: at(-DAY) })], payments: [{ athlete_id: 'u-cut', paid_at: arDay(-10 * DAY) }], expect: r => r.body.pagos_despues_del_corte === 0 && !mails.length },
  { name: 'El mail no lleva datos de alumnos', reviews: [rev({ email: 'lucia@example.test' })], profiles: [prof({ trial_ends_at: at(-2 * DAY) })], expect: () => mails.length === 1 && !/lucia|Lucia|sub-/.test(JSON.stringify(mails[0])) },
  { name: 'Resend falla: 502', reviews: [rev()], resendFails: true, expect: r => r.status === 502 },
  { name: 'No se pueden leer los casos: 500 sin mails', reviews: [rev()], failRead: 'trial_reviews', expect: r => r.status === 500 && !mails.length },
  { name: 'Método GET: 401', method: 'GET', reviews: [rev()], expect: r => r.status === 401 && !mails.length },
];

const tmp = mkdtempSync(path.join(tmpdir(), 'tal-sim-'));
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
    db = { trial_reviews: clone(c.reviews || []), profiles: clone(c.profiles || []), payments: clone(c.payments || []), secret: c.secret ?? SECRET, to: c.to ?? TO, failRead: c.failRead };
    mails = []; resendFails = !!c.resendFails; logs = [];
    const r = await globalThis.__handler(new Request('http://sim/', { method: c.method || 'POST', headers: c.headers ?? OK, body: c.method === 'GET' ? undefined : '{}' }));
    const out = { status: r.status, body: await r.json() };
    let ok = false;
    try { ok = !!c.expect(out); } catch (_) {}
    if (logs.some(l => /@/.test(l))) { ok = false; log('         el log contiene un mail'); }
    if (!ok) { failed++; log(`FALLA  ${c.name}\n         ${JSON.stringify(out)} mails ${mails.length}`); }
    else log(`ok     ${c.name}`);
  }
  log(`\n${cases.length - failed} de ${cases.length} casos OK`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
