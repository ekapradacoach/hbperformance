// ============================================================================
// Etapa 6: simulación DIFERENCIAL de process-payment + casos de la semana de prueba.
// No usa la red ni la base: MP, Auth, Resend y Supabase están simulados en memoria. Datos ficticios (@example.test).
//
// Correr desde la raíz del repo, ANTES de cada deploy de process-payment:
//   node supabase/tests/process-payment-etapa6.sim.mjs
// Opcional: node supabase/tests/process-payment-etapa6.sim.mjs ruta/nueva/index.ts ruta/vieja/index.ts
//
// Parte 1 (diferencial): corre los MISMOS avisos contra la versión deployada antes de la etapa 6 (git 76c477a) y
//   contra la nueva, con perfiles que NO están en prueba (sin trial_status, converted, cancelled) y con fallas de la
//   base. Respuesta, base final, pagos, llamadas a MP, invitaciones y mails tienen que ser IDÉNTICOS.
// Parte 2: casos de la prueba (in_trial / charge_rejected) contra la versión nueva.
// Sale con código 1 si algo falla. Demuestra la lógica, NO cómo se comporta MP en real.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const newSource = process.argv[2] || path.join(repo, 'supabase', 'functions', 'process-payment', 'index.ts');
const OLD_REF = '76c477a';

// ---- Reloj fijo: las dos versiones ven la misma hora (las fechas guardadas se pueden comparar) ----
const RealDate = Date;
const FIXED = RealDate.parse('2026-11-12T15:00:00.000Z');
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
};
const DAY = 864e5;
const iso = ms => new RealDate(FIXED + ms).toISOString();
const arDay = ms => new RealDate(FIXED + ms - 3 * 36e5).toISOString().slice(0, 10);

// ---- Supabase en memoria ----
let db, mp, calls;
const clone = x => JSON.parse(JSON.stringify(x));
function table(name) {
  const s = { filters: [], op: 'select', limit: null, order: null, one: false, returning: false };
  const run = () => {
    const rows = db[name] || (db[name] = []);
    const match = x => s.filters.every(f => f(x));
    const isWrite = ['insert', 'update', 'upsert', 'delete'].includes(s.op);
    if (isWrite && db.failWrite === name) return { data: null, error: { message: 'escritura rechazada (simulada)' } };
    if (s.op === 'insert') { rows.push(clone(s.value)); return { data: null, error: null }; }
    if (s.op === 'upsert') {
      const key = s.opts?.onConflict;
      const old = key ? rows.find(r => r[key] === s.value[key]) : null;
      if (old) { if (!s.opts?.ignoreDuplicates) Object.assign(old, clone(s.value)); } else rows.push(clone(s.value));
      return { data: null, error: null };
    }
    if (s.op === 'update') { const hit = rows.filter(match); hit.forEach(x => Object.assign(x, clone(s.value))); return { data: s.returning ? clone(hit) : null, error: null }; }
    if (s.op === 'delete') { db[name] = rows.filter(x => !match(x)); return { data: null, error: null }; }
    if (db.failOn === name) return { data: null, error: { message: 'falla simulada' } };
    let out = rows.filter(match);
    if (s.order) out = [...out].sort((a, b) => (a[s.order] < b[s.order] ? 1 : -1));
    if (s.limit) out = out.slice(0, s.limit);
    if (s.one) return out.length > 1 ? { data: null, error: { message: 'multiple rows' } } : { data: clone(out[0] ?? null), error: null };
    return { data: clone(out), error: null };
  };
  const b = {
    select() { if (s.op !== 'select') s.returning = true; return b; },
    insert(v) { s.op = 'insert'; s.value = v; return b; },
    update(v) { s.op = 'update'; s.value = v; return b; },
    upsert(v, o) { s.op = 'upsert'; s.value = v; s.opts = o; return b; },
    delete() { s.op = 'delete'; return b; },
    eq(k, v) { s.filters.push(x => x[k] === v); return b; },
    in(k, v) { s.filters.push(x => v.includes(x[k])); return b; },
    is(k, v) { s.filters.push(x => (x[k] ?? null) === v); return b; },
    gte(k, v) { s.filters.push(x => x[k] >= v); return b; },
    order(k) { s.order = k; return b; },
    limit(n) { s.limit = n; return b; },
    maybeSingle() { s.one = true; return b; },
    then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
const user = e => String(e).split('@')[0].toLowerCase();
globalThis.__createClient = () => ({
  from: table,
  auth: { admin: {
    inviteUserByEmail: async e => {
      calls.push('invita:' + user(e));
      if (db.authUsers.includes('new-' + user(e))) return { data: null, error: { status: 422, code: 'email_exists', message: 'already registered' } };
      db.authUsers.push('new-' + user(e));
      return { data: { user: { id: 'new-' + user(e) } }, error: null };
    },
    deleteUser: async id => { calls.push('borra-auth:' + id); return { error: null }; },
    listUsers: async () => ({ data: { users: [] }, error: null }),
    generateLink: async ({ email }) => { calls.push('mail-ingreso:' + user(email)); return { data: { properties: { action_link: 'https://sim/link' } }, error: null }; },
  } },
});
globalThis.Deno = { env: { get: k => (k === 'SUPABASE_URL' ? 'https://sim.supabase' : 'x') }, serve: h => { globalThis.__handler = h; } };

// ---- Mercado Pago, confirm-trial y Resend simulados ----
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  let m;
  if ((m = u.match(/\/authorized_payments\/(.+)$/))) return mp.invoices[m[1]] ? res(mp.invoices[m[1]]) : res({}, 404);
  if ((m = u.match(/\/v1\/payments\/(.+)$/))) return mp.payments[m[1]] ? res(mp.payments[m[1]]) : res({}, 404);
  if ((m = u.match(/\/preapproval\/(.+)$/))) {
    if (opts.method === 'PUT') { calls.push('MP-cancela:' + m[1]); return mp.putFails ? res({ message: 'falla' }, 500) : res({}); }
    return res({ id: m[1], status: mp.subStatus || 'authorized', preapproval_plan_id: mp.plan || 'plan-h', external_reference: null, payer_email: '' });
  }
  if (u.includes('/functions/v1/confirm-trial')) { calls.push('confirm-trial:' + opts.body); return res({ ok: true, status: 'provisioned' }); }
  if (u.includes('resend')) { const b = JSON.parse(opts.body); calls.push('mail:' + user(b.to) + ':' + b.subject); return res({}); }
  throw new Error('fetch inesperado: ' + u);
};

// ---- Datos ficticios ----
const profile = (name, extra = {}) => ({ id: 'u-' + name, full_name: name, email: name + '@example.test', role: 'athlete', program: 'hybrid', subscription_status: 'active', subscription_start: arDay(-7 * DAY), subscription_end: null, mp_subscription_id: 'sub-' + name, access_from: null, trial_status: null, trial_started_at: null, trial_ends_at: null, trial_resolved_at: null, payer_id: '777', ...extra });
const inTrial = (name, extra = {}) => profile(name, { program: 'crossfit', trial_status: 'in_trial', trial_started_at: iso(-7 * DAY), trial_ends_at: iso(-60 * 6e4), ...extra });
const pending = (name, minutes, extra = {}) => ({ id: 'p-' + name, full_name: name, email: name + '@example.test', phone: null, program: 'hybrid', is_trial: false, created_at: iso(-minutes * 6e4), ...extra });
const preapprovalEvent = id => ({ type: 'subscription_preapproval', data: { id } });
const invoiceEvent = { type: 'subscription_authorized_payment', data: { id: 'i1' } };
const PAY = id => ({ id, payer: { email: 'pagador@example.test' }, transaction_amount: 45000, transaction_details: { net_received_amount: 41405.99 }, date_approved: iso(-5 * 6e4) });
const inv = (sub, kind, attempt = 1) => {
  const base = { preapproval_id: sub, retry_attempt: attempt };
  if (kind === 'approved') return { invoices: { i1: { ...base, status: 'processed', payment: { id: 'pay1', status: 'approved' } } }, payments: { pay1: PAY('pay1') } };
  if (kind === 'approvedRecycling') return { invoices: { i1: { ...base, status: 'recycling', payment: { id: 'pay1', status: 'approved' } } }, payments: { pay1: PAY('pay1') } };
  if (kind === 'rejected') return { invoices: { i1: { ...base, status: 'recycling', payment: { id: 'pay9', status: 'rejected' } } }, payments: {} };
  if (kind === 'inProcess') return { invoices: { i1: { ...base, status: 'scheduled', payment: { id: 'pay1', status: 'in_process' } } }, payments: {} };
  if (kind === 'scheduled') return { invoices: { i1: { ...base, status: 'scheduled' } }, payments: {} };
  throw new Error(kind);
};
const CONFIG = [{ key: 'mp_plan_hybrid', value: 'plan-h' }, { key: 'mp_plan_crossfit', value: 'plan-c' }, { key: 'mp_trial_plan_crossfit', value: 'plan-t' }];

function fresh(c) {
  db = { profiles: clone(c.profiles || []), pending_subscriptions: clone(c.pendings || []), payments: clone(c.payments || []), trial_reviews: clone(c.reviews || []), site_config: CONFIG, authUsers: [] };
  if (c.failOn) db.failOn = c.failOn;
  if (c.failWrite) db.failWrite = c.failWrite;
  mp = { invoices: {}, payments: {}, ...clone(c.mp || {}) };
  calls = [];
}
async function send(handler, c, event = c.event) {
  const r = await handler(new Request('http://sim/', { method: 'POST', body: JSON.stringify(event) }));
  const text = await r.text();
  return { http: r.status, body: text };
}
const snapshot = () => clone({ profiles: db.profiles, pendings: db.pending_subscriptions, payments: db.payments, reviews: db.trial_reviews, authUsers: db.authUsers, calls });

// ---- Parte 1: escenarios para la diferencial (nadie en prueba) ----
const NON_TRIAL_PROFILES = {
  'sin prueba': () => [profile('ana')],
  'convertido': () => [profile('ana', { program: 'crossfit', trial_status: 'converted', trial_started_at: iso(-40 * DAY), trial_ends_at: iso(-33 * DAY), trial_resolved_at: iso(-33 * DAY) })],
  'prueba cancelada': () => [profile('ana', { program: 'crossfit', subscription_status: 'cancelled', subscription_end: arDay(2 * DAY), trial_status: 'cancelled', trial_started_at: iso(-5 * DAY), trial_ends_at: iso(2 * DAY), trial_resolved_at: iso(-DAY) })],
  'en gracia': () => [profile('ana', { payment_failed_at: iso(-2 * DAY), payment_grace_until: iso(13 * DAY), payment_failed_attempt: 1 })],
  'cancelada vencida': () => [profile('ana', { subscription_status: 'cancelled', subscription_end: arDay(-5 * DAY) })],
  'sin perfil, con pending': () => [],
};
const EVENTS = {
  'preapproval authorized': { event: preapprovalEvent('sub-ana') },
  'preapproval cancelled': { event: preapprovalEvent('sub-ana'), mp: { subStatus: 'cancelled' } },
  'cobro aprobado': { event: invoiceEvent, mp: inv('sub-ana', 'approved') },
  'cobro aprobado en recycling': { event: invoiceEvent, mp: inv('sub-ana', 'approvedRecycling') },
  'cobro rechazado, intento 1': { event: invoiceEvent, mp: inv('sub-ana', 'rejected', 1) },
  'cobro rechazado, intento 2': { event: invoiceEvent, mp: inv('sub-ana', 'rejected', 2) },
  'cobro en proceso': { event: invoiceEvent, mp: inv('sub-ana', 'inProcess') },
  'cuota programada': { event: invoiceEvent, mp: inv('sub-ana', 'scheduled') },
};
const PLANS = { 'plan normal': 'plan-h', 'plan de prueba': 'plan-t' };
const FAILS = { 'sin fallas': {}, 'falla leer profiles': { failOn: 'profiles' }, 'falla escribir profiles': { failWrite: 'profiles' }, 'falla escribir payments': { failWrite: 'payments' } };

const diffCases = [];
for (const [pn, pf] of Object.entries(NON_TRIAL_PROFILES))
  for (const [en, ev] of Object.entries(EVENTS))
    for (const [ln, plan] of Object.entries(PLANS))
      for (const [fn, fail] of Object.entries(FAILS))
        diffCases.push({ name: `${pn} · ${en} · ${ln} · ${fn}`, profiles: pf(), pendings: [pending('ana', 3)], event: ev.event, mp: { ...(ev.mp || {}), plan }, ...fail });
// Un aviso dos veces seguidas (MP reenvía)
for (const [pn, pf] of Object.entries(NON_TRIAL_PROFILES))
  for (const en of ['cobro aprobado', 'cobro rechazado, intento 1', 'preapproval cancelled'])
    diffCases.push({ name: `${pn} · ${en} · reenviado`, profiles: pf(), pendings: [pending('ana', 3)], event: EVENTS[en].event, mp: { ...(EVENTS[en].mp || {}), plan: 'plan-h' }, twice: true });

// ---- Parte 2: casos de la semana de prueba (versión nueva) ----
const T = 'sub-luz';
const trialCases = [
  { name: 'Primer cobro aprobado: converted + alta_nueva, sigue activa', profiles: [inTrial('luz')], mp: { ...inv(T, 'approved'), plan: 'plan-t' }, event: invoiceEvent,
    expect: d => d.http === 200 && d.status === 'trial_converted' && d.p.trial_status === 'converted' && d.p.trial_resolved_at === iso(0) && d.p.subscription_status === 'active'
      && d.payments.length === 1 && d.payments[0].type === 'alta_nueva' && d.payments[0].mp_payment_id === 'pay1' && d.payments[0].amount === 45000 && d.calls.length === 0 },
  { name: 'Aprobado con cuota en recycling: también converted', profiles: [inTrial('luz')], mp: { ...inv(T, 'approvedRecycling'), plan: 'plan-t' }, event: invoiceEvent,
    expect: d => d.status === 'trial_converted' && d.p.trial_status === 'converted' && d.payments.length === 1 && d.payments[0].type === 'alta_nueva' },
  { name: 'Aprobado dos veces (MP reenvía): un solo pago', profiles: [inTrial('luz')], mp: { ...inv(T, 'approved'), plan: 'plan-t' }, event: invoiceEvent, twice: true,
    expect: d => d.p.trial_status === 'converted' && d.payments.length === 1 && d.payments[0].type === 'alta_nueva' },
  { name: 'Aprobado y falla guardar el pago: 500, sigue en prueba; el reintento convierte', profiles: [inTrial('luz')], mp: { ...inv(T, 'approved'), plan: 'plan-t' }, event: invoiceEvent, failWrite: 'payments', retryClean: true,
    expect: d => d.first.http === 500 && d.first.p.trial_status === 'in_trial' && d.status === 'trial_converted' && d.p.trial_status === 'converted' && d.payments.length === 1 },
  { name: 'Aprobado y falla marcar la conversión: 500; el reintento no duplica el pago', profiles: [inTrial('luz')], mp: { ...inv(T, 'approved'), plan: 'plan-t' }, event: invoiceEvent, failWrite: 'profiles', retryClean: true,
    expect: d => d.first.http === 500 && d.p.trial_status === 'converted' && d.payments.length === 1 },
  { name: 'El cobro siguiente de un convertido es renovación normal', profiles: [inTrial('luz', { trial_status: 'converted', trial_resolved_at: iso(-30 * DAY) })], payments: [{ athlete_id: 'u-luz', mp_payment_id: 'pay0', type: 'alta_nueva' }], mp: { ...inv(T, 'approved'), plan: 'plan-t' }, event: invoiceEvent,
    expect: d => d.status === 'renewal' && d.payments.length === 2 && d.payments[1].type === 'renovacion_automatica' },
  { name: 'Primer cobro rechazado: corte ya, charge_rejected, cancela en MP, sin mail ni gracia', profiles: [inTrial('luz')], mp: { ...inv(T, 'rejected'), plan: 'plan-t' }, event: invoiceEvent,
    expect: d => d.status === 'trial_charge_rejected' && d.p.subscription_status === 'cancelled' && d.p.subscription_end === arDay(-DAY) && d.p.trial_status === 'charge_rejected'
      && d.p.trial_resolved_at === iso(0) && !d.p.payment_failed_at && !d.p.payment_grace_until && d.calls.join() === 'MP-cancela:' + T && d.payments.length === 0 },
  { name: 'Rechazado y MP no cancela: corte igual, 200 y log para revisar', profiles: [inTrial('luz')], mp: { ...inv(T, 'rejected'), plan: 'plan-t', putFails: true }, event: invoiceEvent,
    expect: d => d.http === 200 && d.p.trial_status === 'charge_rejected' && d.p.subscription_status === 'cancelled' && d.logs.some(l => l.includes('REVISAR PRUEBA')) },
  { name: 'Rechazado y falla guardar el corte: 500, sin cancelar en MP', profiles: [inTrial('luz')], mp: { ...inv(T, 'rejected'), plan: 'plan-t' }, event: invoiceEvent, failWrite: 'profiles',
    expect: d => d.http === 500 && d.p.trial_status === 'in_trial' && d.calls.length === 0 },
  { name: 'Otro rechazo después del corte: reintenta cancelar en MP, sin mail ni cambios', profiles: [inTrial('luz', { subscription_status: 'cancelled', subscription_end: arDay(-DAY), trial_status: 'charge_rejected', trial_resolved_at: iso(-DAY) })], mp: { ...inv(T, 'rejected', 2), plan: 'plan-t' }, event: invoiceEvent,
    expect: d => d.status === 'trial_charge_rejected' && d.p.trial_status === 'charge_rejected' && d.p.subscription_end === arDay(-DAY) && d.calls.join() === 'MP-cancela:' + T && !d.p.payment_failed_at },
  { name: 'Cobro aprobado después del corte: registra el pago, no reactiva, log para revisar', profiles: [inTrial('luz', { subscription_status: 'cancelled', subscription_end: arDay(-DAY), trial_status: 'charge_rejected', trial_resolved_at: iso(-DAY) })], mp: { ...inv(T, 'approved'), plan: 'plan-t' }, event: invoiceEvent,
    expect: d => d.status === 'trial_paid_after_cut' && d.p.subscription_status === 'cancelled' && d.p.trial_status === 'charge_rejected' && d.payments.length === 1 && d.logs.some(l => l.includes('REVISAR PRUEBA')) },
  { name: 'Cancelada en MP durante la prueba: acceso hasta el día de fin', profiles: [inTrial('luz', { trial_ends_at: iso(3 * DAY) })], mp: { plan: 'plan-t', subStatus: 'cancelled' }, event: preapprovalEvent(T),
    expect: d => d.status === 'trial_cancelled' && d.p.subscription_status === 'cancelled' && d.p.subscription_end === arDay(3 * DAY) && d.p.trial_status === 'cancelled' && d.p.trial_resolved_at === iso(0) && d.calls.length === 0 },
  { name: 'Fin de la prueba de madrugada (hora AR): el día de fin es el de Argentina', profiles: [inTrial('luz', { trial_ends_at: '2026-11-15T02:30:00.000Z' })], mp: { plan: 'plan-t', subStatus: 'cancelled' }, event: preapprovalEvent(T),
    expect: d => d.p.subscription_end === '2026-11-14' },
  { name: 'Cancelada desde el perfil y después el aviso de MP: flujo normal, no pisa la fecha', profiles: [inTrial('luz', { subscription_status: 'cancelled', subscription_end: arDay(3 * DAY), trial_status: 'cancelled', trial_ends_at: iso(3 * DAY), trial_resolved_at: iso(-60e3) })], mp: { plan: 'plan-t', subStatus: 'cancelled' }, event: preapprovalEvent(T),
    expect: d => d.status === 'cancelled' && d.p.subscription_end === arDay(3 * DAY) && d.p.trial_status === 'cancelled' },
  { name: 'Cancelación y falla guardar: 500 para que MP reintente', profiles: [inTrial('luz')], mp: { plan: 'plan-t', subStatus: 'cancelled' }, event: preapprovalEvent(T), failWrite: 'profiles',
    expect: d => d.http === 500 && d.p.trial_status === 'in_trial' },
  { name: 'Prueba vencida hace horas sin cobro: el aviso de la suscripción no la corta', profiles: [inTrial('luz', { trial_ends_at: iso(-5 * 3600e3) })], mp: { plan: 'plan-t' }, event: preapprovalEvent(T),
    expect: d => d.status === 'already_provisioned' && d.p.trial_status === 'in_trial' && d.p.subscription_status === 'active' && d.calls.length === 0 },
  { name: 'Cobro en proceso en prueba: 503 como siempre, sin cambios', profiles: [inTrial('luz')], mp: { ...inv(T, 'inProcess'), plan: 'plan-t' }, event: invoiceEvent,
    expect: d => d.http === 503 && d.p.trial_status === 'in_trial' },
  { name: 'Cuota programada en prueba: flujo normal, sin cambios', profiles: [inTrial('luz')], mp: { ...inv(T, 'scheduled'), plan: 'plan-t' }, event: invoiceEvent,
    expect: d => d.status === 'already_provisioned' && d.p.trial_status === 'in_trial' && d.calls.length === 0 },
  { name: 'No se puede leer el perfil de prueba: sigue el flujo normal y lo loguea', profiles: [inTrial('luz')], mp: { ...inv(T, 'approved'), plan: 'plan-t' }, event: invoiceEvent, failOn: 'profiles',
    expect: d => d.p.trial_status === 'in_trial' && d.logs.some(l => l.includes('REVISAR PRUEBA: no se pudo leer')) },
  { name: 'Suscripción de prueba en dos perfiles: no adivina, flujo normal', profiles: [inTrial('luz'), inTrial('sol', { mp_subscription_id: T })], mp: { ...inv(T, 'rejected'), plan: 'plan-t' }, event: invoiceEvent,
    expect: d => d.db.profiles.every(p => p.trial_status === 'in_trial') && !d.calls.includes('MP-cancela:' + T) },
  { name: 'Un alumno normal en el mismo aviso de cobro rechazado sigue con su gracia', profiles: [profile('ana'), inTrial('luz')], mp: inv('sub-ana', 'rejected'), event: invoiceEvent,
    expect: d => d.status === 'payment_failed_flagged' && d.db.profiles.find(p => p.id === 'u-ana').payment_failed_at && d.db.profiles.find(p => p.id === 'u-luz').trial_status === 'in_trial' },
];

// ---- Cargar las dos versiones del código real ----
const tmp = mkdtempSync(path.join(tmpdir(), 'pp6-sim-'));
const log = console.log;
let failed = 0, logs = [];
async function load(code, tag) {
  const ts = path.join(tmp, tag + '.ts'), js = path.join(tmp, tag + '.mjs');
  writeFileSync(ts, code.replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__createClient'));
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['-y', 'esbuild@0.24.0', ts, '--loader:.ts=ts', '--format=esm', '--log-level=warning', '--outfile=' + js], { stdio: 'inherit', shell: process.platform === 'win32' });
  await import(pathToFileURL(js).href);
  return globalThis.__handler;
}
try {
  const oldCode = process.argv[3]
    ? readFileSync(process.argv[3], 'utf8')
    : execFileSync('git', ['show', `${OLD_REF}:supabase/functions/process-payment/index.ts`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 24 });
  const oldH = await load(oldCode, 'vieja');
  const newH = await load(readFileSync(newSource, 'utf8'), 'nueva');
  console.log = console.warn = console.error = (...a) => { logs.push(a.join(' ')); };

  // Parte 1
  let diffFails = 0;
  for (const c of diffCases) {
    const out = {};
    for (const [tag, h] of [['vieja', oldH], ['nueva', newH]]) {
      fresh(c);
      let r = await send(h, c);
      if (c.twice) { db.failOn = null; db.failWrite = null; r = await send(h, c); }
      out[tag] = JSON.stringify({ r, s: snapshot() });
    }
    if (out.vieja !== out.nueva) {
      diffFails++; failed++;
      log(`FALLA  [diferencial] ${c.name}\n         vieja: ${out.vieja.slice(0, 400)}\n         nueva: ${out.nueva.slice(0, 400)}`);
    }
  }
  log(`Diferencial: ${diffCases.length - diffFails} de ${diffCases.length} escenarios idénticos a ${OLD_REF}`);

  // Parte 2
  let tFails = 0;
  for (const c of trialCases) {
    fresh(c); logs = [];
    let first = null;
    let r = await send(newH, c);
    if (c.twice) r = await send(newH, c);
    if (c.retryClean) {
      first = { http: r.http, p: clone(db.profiles[0]) };
      db.failOn = null; db.failWrite = null;
      r = await send(newH, c);
    }
    let status;
    try { status = JSON.parse(r.body).status; } catch (_) { status = undefined; }
    const d = { http: r.http, status, p: db.profiles[0], payments: db.payments, calls, logs, db, first };
    let ok = false;
    try { ok = !!c.expect(d); } catch (_) { ok = false; }
    // Los logs nuevos de la prueba no llevan mails (los de antes no se tocan).
    if (logs.some(l => /prueba/i.test(l) && /@/.test(l) && !l.startsWith('MP Webhook'))) { ok = false; log('         un log de la prueba contiene un mail'); }
    if (!ok) { tFails++; failed++; log(`FALLA  [prueba] ${c.name}\n         http ${r.http} ${r.body}\n         perfil ${JSON.stringify(db.profiles[0])}\n         pagos ${JSON.stringify(db.payments)} llamadas ${JSON.stringify(calls)}`); }
    else log(`ok     [prueba] ${c.name}`);
  }
  log(`Prueba: ${trialCases.length - tFails} de ${trialCases.length} casos OK`);
  log(`\n${failed === 0 ? 'TODO OK' : failed + ' FALLAS'}`);
} finally {
  globalThis.Date = RealDate;
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
