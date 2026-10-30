// ============================================================================
// Simulación de avisos de Mercado Pago contra el código REAL de process-payment.
// No usa la red ni la base: MP y Supabase están simulados en memoria. Datos ficticios (@example.test).
//
// Correr desde la raíz del repo, ANTES de cada deploy de process-payment:
//   node supabase/tests/process-payment.sim.mjs
// Opcional, contra otra versión del archivo:
//   node supabase/tests/process-payment.sim.mjs ruta/a/index.ts
//
// Sale con código 1 si algún caso falla. Demuestra la lógica de la función, NO cómo se comporta MP en realidad.
// Los casos "CONOCIDO" fijan problemas abiertos (fallback por recencia): si se arreglan, hay que actualizarlos.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] || path.join(here, '..', 'functions', 'process-payment', 'index.ts');

const DAY = 864e5, now = Date.now();
const iso = ms => new Date(now + ms).toISOString();
const date = d => new Date(now + d * DAY - 3 * 36e5).toISOString().slice(0, 10);
const monday = (() => { const a = new Date(now - 3 * 36e5); a.setUTCDate(a.getUTCDate() - (a.getUTCDay() + 6) % 7); return a.toISOString().slice(0, 10); })();

// ---- Supabase en memoria ----
let db, mp, calls;
function table(name) {
  const s = { filters: [], op: 'select', limit: null, order: null, one: false };
  const run = () => {
    const rows = db[name] || (db[name] = []);
    const match = x => s.filters.every(f => f(x));
    if (s.op === 'insert') { rows.push({ ...s.value }); return { data: null, error: null }; }
    if (s.op === 'upsert') { rows.push({ ...s.value }); return { data: null, error: null }; }
    if (s.op === 'update') { rows.filter(match).forEach(x => Object.assign(x, s.value)); return { data: null, error: null }; }
    if (s.op === 'delete') { db[name] = rows.filter(x => !match(x)); return { data: null, error: null }; }
    if (db.failOn === name) return { data: null, error: { message: 'falla simulada' } };
    let out = rows.filter(match);
    if (s.order) out = [...out].sort((a, b) => (a[s.order] < b[s.order] ? 1 : -1));
    if (s.limit) out = out.slice(0, s.limit);
    if (s.one) return out.length > 1 ? { data: null, error: { message: 'multiple rows' } } : { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  };
  const b = {
    select() { return b; },
    insert(v) { s.op = 'insert'; s.value = v; return b; },
    update(v) { s.op = 'update'; s.value = v; return b; },
    upsert(v) { s.op = 'upsert'; s.value = v; return b; },
    delete() { s.op = 'delete'; return b; },
    eq(k, v) { s.filters.push(x => x[k] === v); return b; },
    in(k, v) { s.filters.push(x => v.includes(x[k])); return b; },
    gte(k, v) { s.filters.push(x => x[k] >= v); return b; },
    order(k) { s.order = k; return b; },
    limit(n) { s.limit = n; return b; },
    maybeSingle() { s.one = true; return b; },
    then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
globalThis.__createClient = () => ({
  from: table,
  auth: { admin: { inviteUserByEmail: async e => { calls.push('invita:' + user(e)); return { data: { user: { id: 'new-' + user(e) } }, error: null }; } } },
});
globalThis.Deno = { env: { get: () => 'x' }, serve: h => { globalThis.__handler = h; } };

// ---- Mercado Pago simulado ----
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), res = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  let m;
  if ((m = u.match(/\/authorized_payments\/(.+)$/))) return res(mp.invoices[m[1]]);
  if ((m = u.match(/\/v1\/payments\/(.+)$/))) return res(mp.payments[m[1]]);
  if ((m = u.match(/\/preapproval\/(.+)$/))) {
    if (opts.method === 'PUT') { calls.push('MP-cancela:' + m[1]); return res({}); }
    return res({ id: m[1], status: 'authorized', preapproval_plan_id: 'plan-h', external_reference: null, payer_email: '' });
  }
  if (u.includes('resend')) return res({});
  throw new Error('fetch inesperado: ' + u);
};

// ---- Datos ficticios ----
const user = e => String(e).split('@')[0].toLowerCase();
const pending = (name, minutes) => ({ id: 'p-' + name, full_name: name, email: name + '@example.test', phone: null, program: 'hybrid', created_at: iso(-minutes * 6e4) });
const profile = (name, extra = {}) => ({ id: 'u-' + name, full_name: name, email: name + '@example.test', role: 'athlete', program: 'hybrid', subscription_status: 'active', mp_subscription_id: 'sub-' + name, access_from: null, ...extra });
const preapprovalEvent = id => ({ type: 'subscription_preapproval', data: { id } });
const invoiceEvent = { type: 'subscription_authorized_payment', data: { id: 'i1' } };
const approved = (sub, payerEmail) => ({
  invoices: { i1: { preapproval_id: sub, status: 'processed', payment: { id: 'pay1', status: 'approved' } } },
  payments: { pay1: { id: 'pay1', payer: payerEmail ? { email: payerEmail } : undefined, transaction_amount: 45000, date_approved: iso(0) } },
});
const OLD = '2020-01-06';

// status: respuesta · profiles: { nombre: [estado, suscripción, access_from] } · pendings · calls: llamadas externas
const cases = [
  { name: 'Ana/Lucía: aviso de sub vinculada + pending reciente ajeno', profiles: [profile('ana')], pendings: [pending('lucia', 5)], event: preapprovalEvent('sub-ana'),
    expect: { status: 'already_provisioned', profiles: { ana: ['active', 'sub-ana', null] }, pendings: ['lucia'], calls: [] } },
  { name: 'Ana/Lucía: igual, por cuota programada (sin cobro)', profiles: [profile('ana')], pendings: [pending('lucia', 5)], mp: { invoices: { i1: { preapproval_id: 'sub-ana', status: 'scheduled' } } }, event: invoiceEvent,
    expect: { status: 'already_provisioned', profiles: { ana: ['active', 'sub-ana', null] }, pendings: ['lucia'], calls: [] } },
  { name: 'Sub vinculada a dos perfiles: no crea un tercero', profiles: [profile('ana'), profile('otra', { mp_subscription_id: 'sub-ana' })], pendings: [pending('lucia', 5)], event: preapprovalEvent('sub-ana'),
    expect: { status: 'already_provisioned', profiles: { ana: ['active', 'sub-ana', null], otra: ['active', 'sub-ana', null] }, pendings: ['lucia'], calls: [] } },
  { name: 'Falla la consulta de vinculación: 500 para que MP reintente', failOn: 'profiles', profiles: [profile('ana')], pendings: [pending('lucia', 5)], event: preapprovalEvent('sub-ana'),
    expect: { httpStatus: 500, profiles: { ana: ['active', 'sub-ana', null] }, pendings: ['lucia'], calls: [] } },
  { name: 'Renovación aprobada + pending ajeno', profiles: [profile('ana')], pendings: [pending('lucia', 5)], mp: approved('sub-ana'), event: invoiceEvent,
    expect: { status: 'renewal', profiles: { ana: ['active', 'sub-ana', null] }, pendings: ['lucia'], calls: [] } },
  { name: 'Primer cobro fallido', profiles: [profile('ana')], pendings: [], mp: { invoices: { i1: { preapproval_id: 'sub-ana', status: 'recycling', retry_attempt: 1, payment: { status: 'rejected' } } } }, event: invoiceEvent,
    expect: { status: 'payment_failed_flagged', profiles: { ana: ['active', 'sub-ana', null] }, pendings: [], calls: [] } },
  { name: 'Alta nueva: aviso sin email, un solo pending', profiles: [], pendings: [pending('lucia', 3)], event: preapprovalEvent('sub-new'),
    expect: { profiles: { lucia: ['active', 'sub-new', monday] }, pendings: [], calls: ['invita:lucia'] } },
  { name: 'Alta nueva: cobro aprobado con email (distinta mayúscula)', profiles: [], pendings: [pending('lucia', 3)], mp: approved('sub-new', 'LUCIA@example.test'), event: invoiceEvent,
    expect: { profiles: { lucia: ['active', 'sub-new', monday] }, pendings: [], calls: ['invita:lucia'] } },
  { name: 'Reactivación: cancelada sin días pagos', profiles: [profile('ana', { subscription_status: 'cancelled', subscription_end: date(-5) })], pendings: [pending('ana', 3)], event: preapprovalEvent('sub-nueva'),
    expect: { profiles: { ana: ['active', 'sub-nueva', monday] }, pendings: [], calls: ['MP-cancela:sub-ana'] } },
  { name: 'Reactivación: cortada por cobro fallido', profiles: [profile('ana', { payment_grace_until: iso(-DAY), access_from: OLD })], pendings: [pending('ana', 3)], event: preapprovalEvent('sub-nueva'),
    expect: { profiles: { ana: ['active', 'sub-nueva', monday] }, pendings: [], calls: ['MP-cancela:sub-ana'] } },
  { name: 'Activa que se re-suscribe: conserva access_from', profiles: [profile('ana', { access_from: OLD })], pendings: [pending('ana', 3)], event: preapprovalEvent('sub-nueva'),
    expect: { profiles: { ana: ['active', 'sub-nueva', OLD] }, pendings: [], calls: ['MP-cancela:sub-ana'] } },
  { name: 'Cancelada con días pagos: conserva access_from', profiles: [profile('ana', { subscription_status: 'cancelled', subscription_end: date(5), access_from: OLD })], pendings: [pending('ana', 3)], event: preapprovalEvent('sub-nueva'),
    expect: { profiles: { ana: ['active', 'sub-nueva', OLD] }, pendings: [], calls: ['MP-cancela:sub-ana'] } },
  { name: 'Baja en admin, sub vieja viva + pending propio: no reactiva con la sub vieja', profiles: [profile('ana', { subscription_status: 'cancelled', subscription_end: date(-5) })], pendings: [pending('ana', 3)], event: preapprovalEvent('sub-ana'),
    expect: { status: 'already_provisioned', profiles: { ana: ['cancelled', 'sub-ana', null] }, pendings: ['ana'], calls: [] } },
  { name: 'Dos pendings de personas distintas, sin email: alta manual', profiles: [], pendings: [pending('lucia', 3), pending('sofia', 4)], event: preapprovalEvent('sub-new'),
    expect: { status: 'manual_required', profiles: {}, pendings: ['lucia', 'sofia'], calls: [] } },
  { name: 'Dos pendings, cobro con email de una: alta correcta', profiles: [], pendings: [pending('lucia', 3), pending('sofia', 4)], mp: approved('sub-new', 'sofia@example.test'), event: invoiceEvent,
    expect: { profiles: { sofia: ['active', 'sub-new', monday] }, pendings: ['lucia'], calls: ['invita:sofia'] } },
  { name: 'CONOCIDO: pending propio viejo, Lucía única reciente: se cruza', profiles: [], pendings: [pending('compradora', 30), pending('lucia', 2)], event: preapprovalEvent('sub-compradora'),
    expect: { profiles: { lucia: ['active', 'sub-compradora', monday] }, pendings: ['compradora'], calls: ['invita:lucia'] } },
  { name: 'CONOCIDO: mail de MP distinto al form, Lucía única reciente: se cruza', profiles: [], pendings: [pending('lucia', 2)], mp: approved('sub-x', 'otro@example.test'), event: invoiceEvent,
    expect: { profiles: { lucia: ['active', 'sub-x', monday] }, pendings: [], calls: ['invita:lucia'] } },
  { name: 'CONOCIDO: la cruzada paga la suya: se cancela la sub ajena', profiles: [profile('lucia', { mp_subscription_id: 'sub-compradora', access_from: OLD })], pendings: [pending('lucia', 1)], event: preapprovalEvent('sub-lucia'),
    expect: { profiles: { lucia: ['active', 'sub-lucia', OLD] }, pendings: [], calls: ['MP-cancela:sub-compradora'] } },
];

// ---- Cargar el código real (reemplazando solo el import de la librería) ----
const tmp = mkdtempSync(path.join(tmpdir(), 'pp-sim-'));
const log = console.log;
let failed = 0;
try {
  const code = readFileSync(source, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__createClient');
  const ts = path.join(tmp, 'index.ts'), js = path.join(tmp, 'index.mjs');
  writeFileSync(ts, code);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['-y', 'esbuild@0.24.0', ts, '--loader:.ts=ts', '--format=esm', '--log-level=warning', '--outfile=' + js], { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log = console.warn = console.error = () => {};
  await import(pathToFileURL(js).href);

  for (const c of cases) {
    db = { profiles: c.profiles.map(p => ({ ...p })), pending_subscriptions: c.pendings.map(p => ({ ...p })), payments: [], site_config: [{ key: 'mp_plan_hybrid', value: 'plan-h' }] };
    mp = { invoices: {}, payments: {}, ...c.mp };
    calls = [];
    // Simula un error de la base en todas las lecturas de esa tabla durante este caso
    if (c.failOn) db.failOn = c.failOn;
    const r = await globalThis.__handler(new Request('http://sim/', { method: 'POST', body: JSON.stringify(c.event) }));
    const body = await r.json();
    const got = {
      httpStatus: r.status, status: body.status,
      profiles: Object.fromEntries(db.profiles.map(p => [user(p.email), [p.subscription_status, p.mp_subscription_id, p.access_from ?? null]])),
      pendings: db.pending_subscriptions.map(p => user(p.email)).sort(),
      calls,
    };
    const diffs = Object.entries(c.expect).filter(([k, v]) => JSON.stringify(got[k]) !== JSON.stringify(v))
      .map(([k, v]) => `${k}: esperado ${JSON.stringify(v)}, obtenido ${JSON.stringify(got[k])}`);
    if (diffs.length) { failed++; log(`FALLA  ${c.name}`); diffs.forEach(d => log('         ' + d)); }
    else log(`ok     ${c.name}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
log(`\n${cases.length - failed} de ${cases.length} casos OK`);
process.exit(failed ? 1 : 0);
