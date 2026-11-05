// ============================================================================
// Etapa 6: simulación de cancel-subscription (cancelar desde el perfil del portal).
// Diferencial: los perfiles que NO están en prueba dan exactamente lo mismo que la versión del repo antes de la
// etapa 6 (git 4bde149). Casos de la prueba: acceso hasta el día de fin y trial_status = cancelled.
// No usa la red ni la base. Correr desde la raíz del repo:
//   node supabase/tests/cancel-subscription-etapa6.sim.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const newSource = process.argv[2] || path.join(repo, 'supabase', 'functions', 'cancel-subscription', 'index.ts');
const OLD_REF = '4bde149';

const RealDate = Date;
const FIXED = RealDate.parse('2026-11-12T15:00:00.000Z');
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
};
const DAY = 864e5;
const iso = ms => new RealDate(FIXED + ms).toISOString();

let db, mp, calls;
const clone = x => JSON.parse(JSON.stringify(x));
function table(name) {
  const s = { filters: [], op: 'select', one: false };
  const run = () => {
    const rows = db[name];
    const match = x => s.filters.every(f => f(x));
    if (s.op === 'update') {
      if (db.failWrite) return { data: null, error: { message: 'falla simulada' } };
      rows.filter(match).forEach(x => Object.assign(x, clone(s.value))); return { data: null, error: null };
    }
    const out = rows.filter(match);
    return s.one ? { data: clone(out[0] ?? null), error: null } : { data: clone(out), error: null };
  };
  const b = {
    select() { return b; }, update(v) { s.op = 'update'; s.value = v; return b; },
    eq(k, v) { s.filters.push(x => x[k] === v); return b; }, maybeSingle() { s.one = true; return b; },
    then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
globalThis.__createClient = () => ({
  from: table,
  auth: { getUser: async t => (t === 'tok-ana' ? { data: { user: { id: 'u-ana' } }, error: null } : { data: null, error: { message: 'jwt' } }) },
});
globalThis.Deno = { env: { get: () => 'x' }, serve: h => { globalThis.__handler = h; } };
globalThis.fetch = async (url, opts = {}) => {
  const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (opts.method === 'PUT') { calls.push('MP-cancela'); return mp.putFails ? res({ message: 'no' }, 400) : res({ next_payment_date: mp.next }); }
  return res({ status: 'authorized', next_payment_date: mp.next, auto_recurring: { frequency: 1, frequency_type: 'months' } });
};

const base = { id: 'u-ana', mp_subscription_id: 'sub-ana', subscription_start: '2026-10-05', subscription_status: 'active', program: 'crossfit', subscription_end: null,
  trial_status: null, trial_started_at: null, trial_ends_at: null, trial_resolved_at: null };
const NEXT = '2026-12-05T10:00:00.000-03:00';

const diffCases = [
  { name: 'Alumno normal', profile: { ...base } },
  { name: 'Alumno sin next_payment_date en MP', profile: { ...base }, mp: { next: null } },
  { name: 'Prueba ya convertida', profile: { ...base, trial_status: 'converted', trial_started_at: iso(-40 * DAY), trial_ends_at: iso(-33 * DAY), trial_resolved_at: iso(-33 * DAY) } },
  { name: 'Sin suscripción de MP', profile: { ...base, mp_subscription_id: null } },
  { name: 'MP no cancela', profile: { ...base }, mp: { putFails: true } },
  { name: 'Falla guardar', profile: { ...base }, failWrite: true },
  { name: 'Token inválido', profile: { ...base }, token: 'otro' },
];
const trialCases = [
  { name: 'En prueba: acceso hasta el día de fin (hora AR) y trial_status cancelled', profile: { ...base, trial_status: 'in_trial', trial_started_at: iso(-3 * DAY), trial_ends_at: '2026-11-16T02:30:00.000Z' }, mp: { next: '2026-11-17T10:00:00.000-03:00' },
    expect: (r, p) => r.ok && r.subscription_end === '2026-11-15' && p.subscription_end === '2026-11-15' && p.subscription_status === 'cancelled' && p.trial_status === 'cancelled' && p.trial_resolved_at === iso(0) && calls.join() === 'MP-cancela' },
  { name: 'En prueba y MP no cancela: no toca nada', profile: { ...base, trial_status: 'in_trial', trial_started_at: iso(-3 * DAY), trial_ends_at: iso(4 * DAY) }, mp: { putFails: true },
    expect: (r, p) => !r.ok && p.trial_status === 'in_trial' && p.subscription_status === 'active' },
  { name: 'En prueba y falla guardar: avisa, sigue in_trial', profile: { ...base, trial_status: 'in_trial', trial_started_at: iso(-3 * DAY), trial_ends_at: iso(4 * DAY) }, failWrite: true,
    expect: (r, p) => !r.ok && p.trial_status === 'in_trial' },
];

const tmp = mkdtempSync(path.join(tmpdir(), 'cs6-sim-'));
const log = console.log;
let failed = 0;
async function load(code, tag) {
  const ts = path.join(tmp, tag + '.ts'), js = path.join(tmp, tag + '.mjs');
  writeFileSync(ts, code.replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__createClient'));
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['-y', 'esbuild@0.24.0', ts, '--loader:.ts=ts', '--format=esm', '--log-level=warning', '--outfile=' + js], { stdio: 'inherit', shell: process.platform === 'win32' });
  await import(pathToFileURL(js).href);
  return globalThis.__handler;
}
const fresh = c => { db = { profiles: [clone(c.profile)], failWrite: c.failWrite }; mp = { next: NEXT, ...(c.mp || {}) }; calls = []; };
const send = async (h, c) => {
  const r = await h(new Request('http://sim/', { method: 'POST', headers: { Authorization: 'Bearer ' + (c.token || 'tok-ana') } }));
  return { status: r.status, body: await r.json() };
};
try {
  const oldCode = execFileSync('git', ['show', `${OLD_REF}:supabase/functions/cancel-subscription/index.ts`], { cwd: repo, encoding: 'utf8' });
  const oldH = await load(oldCode, 'vieja');
  const newH = await load(readFileSync(newSource, 'utf8'), 'nueva');
  console.log = console.warn = console.error = () => {};
  for (const c of diffCases) {
    const out = {};
    for (const [tag, h] of [['vieja', oldH], ['nueva', newH]]) { fresh(c); const r = await send(h, c); out[tag] = JSON.stringify({ r, p: db.profiles[0], calls }); }
    if (out.vieja !== out.nueva) { failed++; log(`FALLA  [diferencial] ${c.name}\n         vieja ${out.vieja}\n         nueva ${out.nueva}`); }
    else log(`ok     [diferencial] ${c.name}`);
  }
  for (const c of trialCases) {
    fresh(c);
    const r = await send(newH, c);
    let ok = false;
    try { ok = !!c.expect(r.body, db.profiles[0]); } catch (_) {}
    if (!ok) { failed++; log(`FALLA  [prueba] ${c.name}\n         ${JSON.stringify(r)} ${JSON.stringify(db.profiles[0])}`); }
    else log(`ok     [prueba] ${c.name}`);
  }
  const total = diffCases.length + trialCases.length;
  log(`\n${total - failed} de ${total} casos OK`);
} finally {
  globalThis.Date = RealDate;
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
