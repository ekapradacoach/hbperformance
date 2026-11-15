// ============================================================================
// Simulación de admin-cancel-subscription ("Dar de baja" del admin que también cancela en MP).
// Corre el código REAL contra MP, Auth y Supabase simulados en memoria. Datos ficticios. Sin red ni base.
// Correr desde la raíz del repo, ANTES del deploy:
//   node supabase/tests/admin-cancel-subscription.sim.mjs
// Opcional, contra otra versión: node supabase/tests/admin-cancel-subscription.sim.mjs ruta/a/index.ts
// Sale con código 1 si algún caso falla. Demuestra la lógica, NO cómo se comporta MP en real.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] || path.join(here, '..', 'functions', 'admin-cancel-subscription', 'index.ts');

let db, mp, calls, logs = [];
const clone = x => JSON.parse(JSON.stringify(x));
function table(name) {
  const s = { filters: [], op: 'select', one: false, returning: false };
  const run = () => {
    const rows = db[name] || [];
    const match = x => s.filters.every(f => f(x));
    if (s.op === 'update') {
      if (db.failWrite) return { data: null, error: { message: 'falla simulada' } };
      const hit = rows.filter(match);
      if (db.rlsZero) return { data: [], error: null };
      hit.forEach(x => Object.assign(x, clone(s.value)));
      return { data: s.returning ? clone(hit) : null, error: null };
    }
    if (db.failRead) return { data: null, error: { message: 'falla simulada' } };
    const out = rows.filter(match);
    return s.one ? { data: clone(out[0] ?? null), error: null } : { data: clone(out), error: null };
  };
  const b = {
    select() { if (s.op !== 'select') s.returning = true; return b; },
    update(v) { s.op = 'update'; s.value = v; return b; },
    eq(k, v) { s.filters.push(x => x[k] === v); return b; },
    maybeSingle() { s.one = true; return b; },
    then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
const TOKENS = { 'tok-admin': 'u-admin', 'tok-ana': 'u-ana' };
globalThis.__createClient = () => ({
  from: table,
  auth: { getUser: async t => (TOKENS[t] ? { data: { user: { id: TOKENS[t] } }, error: null } : { data: { user: null }, error: { message: 'jwt' } }) },
});
globalThis.Deno = { env: { get: k => (k === 'MP_ACCESS_TOKEN' && mp.noToken ? undefined : 'x') }, serve: h => { globalThis.__handler = h; } };
globalThis.fetch = async (url, opts = {}) => {
  const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const m = String(url).match(/\/preapproval\/(.+)$/);
  if (!m) throw new Error('fetch inesperado: ' + url);
  if (opts.method === 'PUT') {
    calls.push('MP-cancela:' + decodeURIComponent(m[1]));
    if (mp.putFails) return res({ message: 'Cannot cancel' }, 400);
    mp.status = 'cancelled';
    return res({ status: 'cancelled' });
  }
  calls.push('MP-consulta:' + decodeURIComponent(m[1]));
  if (mp.getFails) return res({ message: 'not found' }, 404);
  return res({ id: decodeURIComponent(m[1]), status: mp.status, next_payment_date: '2026-12-05T10:00:00.000-04:00' });
};

const athlete = (name, extra = {}) => ({ id: 'u-' + name, role: 'athlete', full_name: name, email: name + '@example.test', subscription_status: 'active', subscription_end: null, mp_subscription_id: 'sub-' + name, trial_status: null, ...extra });
const ADMIN = { id: 'u-admin', role: 'admin', full_name: 'admin', email: 'admin@example.test' };
const p = (d, id) => d.db.profiles.find(x => x.id === id);
const untouched = d => p(d, 'u-ana').subscription_status === 'active' && p(d, 'u-ana').subscription_end === null;

const cases = [
  { name: 'Admin, suscripción activa: cancela en MP y después guarda la baja con la fecha elegida', profiles: [ADMIN, athlete('ana')],
    expect: d => d.http === 200 && d.body.ok && d.body.mp === 'cancelled' && p(d, 'u-ana').subscription_status === 'cancelled' && p(d, 'u-ana').subscription_end === '2026-11-30'
      && d.calls.join() === 'MP-consulta:sub-ana,MP-cancela:sub-ana' },
  { name: 'Ya cancelada en MP: no vuelve a cancelar, guarda la baja', profiles: [ADMIN, athlete('ana')], mp: { status: 'cancelled' },
    expect: d => d.http === 200 && d.body.mp === 'already_cancelled' && p(d, 'u-ana').subscription_status === 'cancelled' && !d.calls.some(c => c.startsWith('MP-cancela')) },
  { name: 'Suscripción pausada: también se cancela', profiles: [ADMIN, athlete('ana')], mp: { status: 'paused' },
    expect: d => d.body.mp === 'cancelled' && d.calls.includes('MP-cancela:sub-ana') },
  { name: 'MP no cancela: 502 y el perfil no se toca', profiles: [ADMIN, athlete('ana')], mp: { putFails: true },
    expect: d => d.http === 502 && !d.body.ok && /No se cambió nada/.test(d.body.error) && untouched(d) },
  { name: 'MP no responde la consulta: 502, sin cancelar ni tocar el perfil', profiles: [ADMIN, athlete('ana')], mp: { getFails: true },
    expect: d => d.http === 502 && untouched(d) && !d.calls.some(c => c.startsWith('MP-cancela')) },
  { name: 'MP canceló pero falla guardar: 500 con mp_cancelled; el reintento guarda sin volver a cancelar', profiles: [ADMIN, athlete('ana')], failWrite: true, retry: true,
    expect: d => d.first.http === 500 && d.first.body.mp_cancelled === true && d.http === 200 && d.body.mp === 'already_cancelled'
      && p(d, 'u-ana').subscription_status === 'cancelled' && d.calls.filter(c => c.startsWith('MP-cancela')).length === 1 },
  { name: 'Guardado sin filas (permiso): 500 con mp_cancelled', profiles: [ADMIN, athlete('ana')], rlsZero: true,
    expect: d => d.http === 500 && d.body.mp_cancelled === true },
  { name: 'Repetida: la segunda no vuelve a cancelar y deja la misma baja', profiles: [ADMIN, athlete('ana')], twice: true,
    expect: d => d.http === 200 && d.calls.filter(c => c.startsWith('MP-cancela')).length === 1 && p(d, 'u-ana').subscription_end === '2026-11-30' },
  { name: 'Ya cancelada en el perfil con otra fecha: la fecha elegida la reemplaza', profiles: [ADMIN, athlete('ana', { subscription_status: 'cancelled', subscription_end: '2026-12-05' })], mp: { status: 'cancelled' },
    expect: d => d.http === 200 && p(d, 'u-ana').subscription_end === '2026-11-30' },
  { name: 'Sin suscripción de MP (alumno manual): 400, nada cambia, sin llamar a MP', profiles: [ADMIN, athlete('ana', { mp_subscription_id: null })],
    expect: d => d.http === 400 && untouched(d) && d.calls.length === 0 },
  { name: 'Semana de prueba en curso: 409 (se resuelve en Pruebas), sin llamar a MP', profiles: [ADMIN, athlete('ana', { trial_status: 'in_trial' })],
    expect: d => d.http === 409 && untouched(d) && d.calls.length === 0 },
  { name: 'Prueba ya convertida: se puede dar de baja', profiles: [ADMIN, athlete('ana', { trial_status: 'converted' })],
    expect: d => d.http === 200 && p(d, 'u-ana').subscription_status === 'cancelled' },
  { name: 'Quien llama es alumno: 403, sin llamar a MP', profiles: [ADMIN, athlete('ana')], token: 'tok-ana',
    expect: d => d.http === 403 && untouched(d) && d.calls.length === 0 },
  { name: 'Sin token: 401', profiles: [ADMIN, athlete('ana')], token: '',
    expect: d => d.http === 401 && untouched(d) && d.calls.length === 0 },
  { name: 'Token inválido: 401', profiles: [ADMIN, athlete('ana')], token: 'tok-falso',
    expect: d => d.http === 401 && untouched(d) && d.calls.length === 0 },
  { name: 'Alumno que no existe: 404', profiles: [ADMIN, athlete('ana')], body: { athlete_id: 'u-nadie', subscription_end: '2026-11-30' },
    expect: d => d.http === 404 && d.calls.length === 0 },
  { name: 'El id es de un admin: 404, sin llamar a MP', profiles: [ADMIN, { ...athlete('otro'), role: 'admin' }], body: { athlete_id: 'u-otro', subscription_end: '2026-11-30' },
    expect: d => d.http === 404 && d.calls.length === 0 },
  { name: 'Fecha inválida: 400, sin llamar a MP', profiles: [ADMIN, athlete('ana')], body: { athlete_id: 'u-ana', subscription_end: '30/11/2026' },
    expect: d => d.http === 400 && d.calls.length === 0 && untouched(d) },
  { name: 'Fecha sin ceros (2026-12-1): 400', profiles: [ADMIN, athlete('ana')], body: { athlete_id: 'u-ana', subscription_end: '2026-12-1' },
    expect: d => d.http === 400 && d.calls.length === 0 && untouched(d) },
  { name: 'Fecha con hora: 400', profiles: [ADMIN, athlete('ana')], body: { athlete_id: 'u-ana', subscription_end: '2026-11-30 10:00' },
    expect: d => d.http === 400 && d.calls.length === 0 && untouched(d) },
  { name: 'Fecha con año extendido (+002026-11-30, válida para Date): 400', profiles: [ADMIN, athlete('ana')], body: { athlete_id: 'u-ana', subscription_end: '+002026-11-30' },
    expect: d => d.http === 400 && d.calls.length === 0 && untouched(d) },
  { name: 'Falta la fecha: 400', profiles: [ADMIN, athlete('ana')], body: { athlete_id: 'u-ana' },
    expect: d => d.http === 400 && d.calls.length === 0 },
  { name: 'Falla leer perfiles: 500, sin llamar a MP', profiles: [ADMIN, athlete('ana')], failRead: true,
    expect: d => d.http === 500 && d.calls.length === 0 },
  { name: 'Otro alumno no se toca', profiles: [ADMIN, athlete('ana'), athlete('beto')],
    expect: d => p(d, 'u-beto').subscription_status === 'active' && p(d, 'u-beto').subscription_end === null && !d.calls.some(c => c.includes('sub-beto')) },
  { name: 'Sin MP_ACCESS_TOKEN: 500, nada cambia', profiles: [ADMIN, athlete('ana')], mp: { noToken: true },
    expect: d => d.http === 500 && untouched(d) && d.calls.length === 0 },
];

const tmp = mkdtempSync(path.join(tmpdir(), 'acs-sim-'));
const log = console.log;
let failed = 0;
try {
  const code = readFileSync(source, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__createClient');
  const ts = path.join(tmp, 'index.ts'), js = path.join(tmp, 'index.mjs');
  writeFileSync(ts, code);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['-y', 'esbuild@0.24.0', ts, '--loader:.ts=ts', '--format=esm', '--log-level=warning', '--outfile=' + js], { stdio: 'inherit', shell: process.platform === 'win32' });
  await import(pathToFileURL(js).href);
  console.log = console.warn = console.error = (...a) => { logs.push(a.join(' ')); };

  for (const c of cases) {
    db = { profiles: clone(c.profiles), failWrite: !!c.failWrite, failRead: !!c.failRead, rlsZero: !!c.rlsZero };
    mp = { status: 'authorized', ...clone(c.mp || {}) };
    calls = []; logs = [];
    const send = async () => {
      const headers = { 'Content-Type': 'application/json' };
      const tok = c.token === undefined ? 'tok-admin' : c.token;
      if (tok) headers.Authorization = 'Bearer ' + tok;
      const r = await globalThis.__handler(new Request('http://sim/', { method: 'POST', headers, body: JSON.stringify(c.body || { athlete_id: 'u-ana', subscription_end: '2026-11-30' }) }));
      return { http: r.status, body: await r.json() };
    };
    let r = await send(), first = null;
    if (c.twice) r = await send();
    if (c.retry) { first = r; db.failWrite = false; r = await send(); }
    const d = { ...r, first, db, calls, logs };
    let ok = false;
    try { ok = !!c.expect(d); } catch (_) { ok = false; }
    if (logs.some(l => /@/.test(l))) { ok = false; log('         un log contiene un mail'); }
    if (!ok) { failed++; log(`FALLA  ${c.name}\n         http ${r.http} ${JSON.stringify(r.body)}\n         perfiles ${JSON.stringify(db.profiles.map(x => [x.id, x.subscription_status, x.subscription_end]))} llamadas ${JSON.stringify(calls)}`); }
    else log(`ok     ${c.name}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
log(`\n${cases.length - failed} de ${cases.length} casos OK`);
process.exit(failed ? 1 : 0);
