// ============================================================================
// Simulación: todo cobro aprobado de MP termina en `payments`, una sola vez.
// Corre el código REAL de process-payment con MP y Supabase en memoria (datos ficticios, @example.test).
// A diferencia de process-payment.sim.mjs, acá `mp_payment_id` es ÚNICO como en la base real
// y cada caso puede mandar varios avisos seguidos.
//
// Correr desde la raíz del repo, ANTES de cada deploy de process-payment:
//   node supabase/tests/process-payment-pagos.sim.mjs
// Opcional, contra otra versión del archivo:
//   node supabase/tests/process-payment-pagos.sim.mjs ruta/a/index.ts
//
// Demuestra la lógica de la función, NO cómo se comporta MP en realidad.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] || path.join(here, '..', 'functions', 'process-payment', 'index.ts');
const today = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);

let db, mp, calls;
function table(name) {
  const s = { filters: [], op: 'select', one: false, limit: null };
  const run = () => {
    const rows = db[name] || (db[name] = []);
    const match = x => s.filters.every(f => f(x));
    if (s.op === 'upsert') {
      if (db.failUpsert) return { data: null, error: { message: 'falla simulada' } };
      const key = s.opts?.onConflict;
      if (key && rows.some(x => x[key] === s.value[key])) {
        if (s.opts.ignoreDuplicates) return { data: [], error: null };
        return { data: null, error: { message: 'duplicate key' } };
      }
      rows.push({ ...s.value }); return { data: [{ id: rows.length }], error: null };
    }
    if (s.op === 'insert') {
      if (name === 'mp_webhook_log' && db.failLog) return { data: null, error: { message: 'tabla inexistente (simulado)' } };
      rows.push({ ...s.value }); return { data: null, error: null };
    }
    if (s.op === 'update') { rows.filter(match).forEach(x => Object.assign(x, s.value)); return { data: null, error: null }; }
    if (s.op === 'delete') { db[name] = rows.filter(x => !match(x)); return { data: null, error: null }; }
    let out = rows.filter(match);
    if (s.limit) out = out.slice(0, s.limit);
    if (s.one) return out.length > 1 ? { data: null, error: { message: 'multiple rows' } } : { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  };
  const b = {
    select() { return b; },
    insert(v) { s.op = 'insert'; s.value = v; return b; },
    update(v) { s.op = 'update'; s.value = v; return b; },
    upsert(v, o) { s.op = 'upsert'; s.value = v; s.opts = o; return b; },
    delete() { s.op = 'delete'; return b; },
    eq(k, v) { s.filters.push(x => x[k] === v); return b; },
    in(k, v) { s.filters.push(x => v.includes(x[k])); return b; },
    gte(k, v) { s.filters.push(x => x[k] >= v); return b; },
    order() { return b; },
    limit(n) { s.limit = n; return b; },
    maybeSingle() { s.one = true; return b; },
    then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
globalThis.__createClient = () => ({
  from: table,
  auth: { admin: { inviteUserByEmail: async e => { calls.push('invita'); return { data: { user: { id: 'new-' + String(e).split('@')[0] } }, error: null }; } } },
});
globalThis.Deno = { env: { get: () => 'x' }, serve: h => { globalThis.__handler = h; } };

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  let m;
  if ((m = u.match(/\/authorized_payments\/(.+)$/))) {
    if (mp.invoiceHttp) return res({}, mp.invoiceHttp);
    return res(mp.invoices[m[1]]);
  }
  if ((m = u.match(/\/v1\/payments\/(.+)$/))) {
    if (mp.paymentHttp) return res({}, mp.paymentHttp);
    if (mp.onPaymentFetch) { const f = mp.onPaymentFetch; mp.onPaymentFetch = null; f(); }
    return res(mp.payments[m[1]]);
  }
  if ((m = u.match(/\/preapproval\/(.+)$/))) {
    if (opts.method === 'PUT') { calls.push('MP-cancela'); return res({}); }
    return res({ id: m[1], status: mp.subStatus || 'authorized', preapproval_plan_id: mp.plan || 'plan-h', external_reference: null, payer_email: '' });
  }
  if (u.includes('resend')) { calls.push('mail'); return res({}); }
  throw new Error('fetch inesperado: ' + u);
};

const NET = 40000;
const payment = (id, email) => ({ id, payer: email ? { email } : undefined, transaction_amount: 45000, transaction_details: { net_received_amount: NET }, date_approved: new Date().toISOString() });
const charge = (sub, email, invoice = {}) => ({
  invoices: { i1: { preapproval_id: sub, status: 'processed', payment: { id: 'pay1', status: 'approved' }, ...invoice } },
  payments: { pay1: payment('pay1', email) },
});
const profile = (name, extra = {}) => ({ id: 'u-' + name, full_name: name, email: name + '@example.test', role: 'athlete', program: 'hybrid', subscription_status: 'active', mp_subscription_id: 'sub-' + name, subscription_start: '2020-01-06', ...extra });
const pending = (name, minutes = 3) => ({ id: 'p-' + name, full_name: name, email: name + '@example.test', phone: null, program: 'hybrid', is_trial: false, created_at: new Date(Date.now() - minutes * 6e4).toISOString() });
const old = { athlete_id: 'u-ana', mp_payment_id: 'pay0', type: 'renovacion_automatica', method: 'mp', amount: 45000, net_amount: NET, paid_at: '2020-02-06', program: 'hybrid' };
const INV = { type: 'subscription_authorized_payment', data: { id: 'i1' } };
const PRE = id => ({ type: 'subscription_preapproval', data: { id } });

// steps: avisos en orden. antes(): cambia el estado antes de ese aviso. http/status: respuesta esperada de ESE aviso.
// expect.payments: filas [mp_payment_id, athlete_id, type, net] (sin contar la previa `old`).
const cases = [
  { name: 'Renovación normal', profiles: [profile('ana')], prior: [old], mp: charge('sub-ana'),
    steps: [{ event: INV, status: 'renewal' }], expect: { payments: [['pay1', 'u-ana', 'renovacion_automatica', NET]], log: ['registrado'] } },
  { name: 'Aviso REPETIDO de la renovación: no duplica', profiles: [profile('ana')], prior: [old], mp: charge('sub-ana'),
    steps: [{ event: INV, status: 'renewal' }, { event: INV, status: 'renewal' }, { event: INV, status: 'renewal' }], expect: { payments: [['pay1', 'u-ana', 'renovacion_automatica', NET]], log: ['registrado', 'ya_estaba', 'ya_estaba'] } },
  { name: 'Alta por cobro aprobado + aviso repetido: un pago, una invitación', profiles: [], pendings: [pending('lucia')], mp: charge('sub-new', 'lucia@example.test'),
    steps: [{ event: INV }, { event: INV, status: 'renewal' }], expect: { payments: [['pay1', 'new-lucia', 'alta_nueva', NET]], calls: ['invita'] } },
  { name: 'Alta por preapproval, después el cobro: queda como alta_nueva', profiles: [], pendings: [pending('lucia')], mp: charge('sub-new'),
    steps: [{ event: PRE('sub-new') }, { event: INV, status: 'renewal' }], expect: { payments: [['pay1', 'new-lucia', 'alta_nueva', NET]], calls: ['invita'], log: ['saltado', 'registrado'] } },
  { name: 'Alta por preapproval, el cobro llega 2 veces, preapproval repetido en el medio', profiles: [], pendings: [pending('lucia')], mp: charge('sub-new'),
    steps: [{ event: PRE('sub-new') }, { event: INV, status: 'renewal' }, { event: PRE('sub-new'), status: 'already_provisioned' }, { event: INV, status: 'renewal' }], expect: { payments: [['pay1', 'new-lucia', 'alta_nueva', NET]], calls: ['invita'] } },
  { name: 'Avisos cruzados: el perfil aparece mientras se procesa el cobro', profiles: [], pendings: [pending('lucia')], mp: charge('sub-lucia'),
    steps: [{ antes: () => { mp.onPaymentFetch = () => { db.profiles.push(profile('lucia', { subscription_start: today })); db.pending_subscriptions = []; }; }, event: INV, status: 'already_provisioned' }], expect: { payments: [['pay1', 'u-lucia', 'alta_nueva', NET]] } },
  { name: 'Avisos cruzados repetidos: no duplica', profiles: [], pendings: [pending('lucia')], mp: charge('sub-lucia'),
    steps: [{ antes: () => { mp.onPaymentFetch = () => { db.profiles.push(profile('lucia', { subscription_start: today })); db.pending_subscriptions = []; }; }, event: INV, status: 'already_provisioned' }, { event: INV, status: 'renewal' }], expect: { payments: [['pay1', 'u-lucia', 'alta_nueva', NET]] } },
  { name: 'Suscripción distinta a la guardada, mail del pagador = perfil: registra y no revincula', profiles: [profile('ana')], prior: [old], mp: charge('sub-otra', 'ana@example.test'),
    steps: [{ event: INV, status: 'already_provisioned' }, { event: INV, status: 'already_provisioned' }], expect: { payments: [['pay1', 'u-ana', 'renovacion_automatica', NET]], sub: { ana: 'sub-ana' }, calls: [] } },
  { name: 'Sin perfil ni pending: alta manual, no asigna a nadie', profiles: [profile('ana')], mp: charge('sub-otra', 'x@example.test'),
    steps: [{ event: INV, status: 'manual_required' }], expect: { payments: [], calls: [], log: ['cobro_sin_registrar'] } },
  { name: 'Suscripción en dos perfiles: no adivina', profiles: [profile('ana'), profile('otra', { mp_subscription_id: 'sub-ana' })], mp: charge('sub-ana'),
    steps: [{ event: INV, status: 'already_provisioned' }], expect: { payments: [], calls: [], log: ['cobro_sin_registrar'] } },
  { name: 'Falla /v1/payments en renovación: 500 y el reintento registra', profiles: [profile('ana')], prior: [old], mp: { ...charge('sub-ana'), paymentHttp: 500 },
    steps: [{ event: INV, http: 500 }, { antes: () => { mp.paymentHttp = 0; }, event: INV, status: 'renewal' }], expect: { payments: [['pay1', 'u-ana', 'renovacion_automatica', NET]] } },
  { name: 'Falla el guardado en renovación: 500 y el reintento registra', profiles: [profile('ana')], prior: [old], mp: charge('sub-ana'), failUpsert: true,
    steps: [{ event: INV, http: 500 }, { antes: () => { db.failUpsert = false; }, event: INV, status: 'renewal' }], expect: { payments: [['pay1', 'u-ana', 'renovacion_automatica', NET]], log: ['error', 'registrado'] } },
  { name: 'Falla el guardado en el alta: 500, el reintento registra sin reinvitar', profiles: [], pendings: [pending('lucia')], mp: charge('sub-new', 'lucia@example.test'), failUpsert: true,
    steps: [{ event: INV, http: 500 }, { antes: () => { db.failUpsert = false; }, event: INV, status: 'renewal' }], expect: { payments: [['pay1', 'new-lucia', 'alta_nueva', NET]], calls: ['invita'] } },
  { name: 'Falla la consulta de la cuota en MP: 502 para reintentar', profiles: [profile('ana')], mp: { ...charge('sub-ana'), invoiceHttp: 500 },
    steps: [{ event: INV, http: 502 }], expect: { payments: [] } },
  { name: 'Cuota inexistente en MP (404): sin reintentos', profiles: [profile('ana')], mp: { ...charge('sub-ana'), invoiceHttp: 404 },
    steps: [{ event: INV, http: 200 }], expect: { payments: [] } },
  { name: 'Cobro en proceso: pide reintento y registra cuando se aprueba', profiles: [profile('ana')], prior: [old], mp: charge('sub-ana', undefined, { status: 'scheduled', payment: { id: 'pay1', status: 'in_process' } }),
    steps: [{ event: INV, http: 503 }, { antes: () => { mp.invoices.i1 = { preapproval_id: 'sub-ana', status: 'processed', payment: { id: 'pay1', status: 'approved' } }; }, event: INV, status: 'renewal' }], expect: { payments: [['pay1', 'u-ana', 'renovacion_automatica', NET]] } },
  { name: 'Aprobado con cuota aún en recycling: registra y la gracia sigue igual que antes', profiles: [profile('ana')], prior: [old], mp: charge('sub-ana', undefined, { status: 'recycling', retry_attempt: 1 }),
    steps: [{ event: INV, status: 'payment_failed_flagged' }, { event: INV, status: 'payment_failed_already_flagged' }], expect: { payments: [['pay1', 'u-ana', 'renovacion_automatica', NET]], flagged: { ana: true } } },
  { name: 'Cuota en recycling con pago en proceso: la gracia se marca igual que antes', profiles: [profile('ana')], prior: [old], mp: charge('sub-ana', undefined, { status: 'recycling', retry_attempt: 1, payment: { id: 'pay1', status: 'in_process' } }),
    steps: [{ event: INV, status: 'payment_failed_flagged' }], expect: { payments: [], flagged: { ana: true } } },
  { name: 'Cobro rechazado: sin pago y con gracia', profiles: [profile('ana')], prior: [old], mp: charge('sub-ana', undefined, { status: 'recycling', retry_attempt: 1, payment: { id: 'pay1', status: 'rejected' } }),
    steps: [{ event: INV, status: 'payment_failed_flagged' }], expect: { payments: [], flagged: { ana: true }, log: ['saltado'] } },
  { name: 'Plan desconocido (prueba técnica): 422 y no suma a payments', profiles: [profile('personal')], mp: { ...charge('sub-x', 'personal@example.test'), plan: 'plan-x' },
    steps: [{ event: INV, http: 422 }], expect: { payments: [], sub: { personal: 'sub-personal' } } },
  { name: 'Cuota procesada sin estado del pago: no guarda y queda como cobro_sin_registrar en el registro', profiles: [profile('ana')], prior: [old], mp: charge('sub-ana', undefined, { payment: { id: 'pay1' } }),
    steps: [{ event: INV, status: 'already_provisioned' }], expect: { payments: [], log: ['cobro_sin_registrar'] } },
  { name: 'Falla el guardado del registro: la respuesta a MP y el pago no cambian', profiles: [profile('ana')], prior: [old], mp: charge('sub-ana'), failLog: true,
    steps: [{ event: INV, status: 'renewal', http: 200 }], expect: { payments: [['pay1', 'u-ana', 'renovacion_automatica', NET]], log: [] } },
  { name: 'Suscripción cancelada sin perfil: no asigna', profiles: [], mp: { ...charge('sub-x', 'x@example.test'), subStatus: 'cancelled' },
    steps: [{ event: INV, status: 'cancelled' }], expect: { payments: [] } },
];

const tmp = mkdtempSync(path.join(tmpdir(), 'pp-pagos-'));
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
    const prior = c.prior || [];
    db = { profiles: c.profiles.map(p => ({ ...p })), pending_subscriptions: (c.pendings || []).map(p => ({ ...p })), payments: prior.map(p => ({ ...p })), site_config: [{ key: 'mp_plan_hybrid', value: 'plan-h' }], failUpsert: !!c.failUpsert, failLog: !!c.failLog };
    mp = { invoices: {}, payments: {}, ...structuredClone(c.mp) };
    calls = [];
    const diffs = [];
    for (const [i, st] of c.steps.entries()) {
      if (st.antes) st.antes();
      const r = await globalThis.__handler(new Request('http://sim/', { method: 'POST', body: JSON.stringify(st.event) }));
      const body = await r.json();
      if (st.http !== undefined && r.status !== st.http) diffs.push(`aviso ${i + 1}: http esperado ${st.http}, obtenido ${r.status}`);
      if (st.status !== undefined && body.status !== st.status) diffs.push(`aviso ${i + 1}: status esperado ${st.status}, obtenido ${body.status} (http ${r.status})`);
    }
    const got = db.payments.filter(p => p.mp_payment_id !== 'pay0').map(p => [p.mp_payment_id, p.athlete_id, p.type, p.net_amount]);
    if (JSON.stringify(got) !== JSON.stringify(c.expect.payments)) diffs.push(`payments: esperado ${JSON.stringify(c.expect.payments)}, obtenido ${JSON.stringify(got)}`);
    const realCalls = calls.filter(x => x !== 'mail');
    if (c.expect.calls && JSON.stringify(realCalls) !== JSON.stringify(c.expect.calls)) diffs.push(`llamadas: esperado ${JSON.stringify(c.expect.calls)}, obtenido ${JSON.stringify(realCalls)}`);
    for (const [n, s] of Object.entries(c.expect.sub || {})) {
      const got2 = db.profiles.find(p => p.id === 'u-' + n)?.mp_subscription_id;
      if (got2 !== s) diffs.push(`suscripción de ${n}: esperado ${s}, obtenido ${got2}`);
    }
    for (const [n, f] of Object.entries(c.expect.flagged || {})) {
      const got3 = !!db.profiles.find(p => p.id === 'u-' + n)?.payment_failed_at;
      if (got3 !== f) diffs.push(`gracia de ${n}: esperado ${f}, obtenido ${got3}`);
    }
    const logRows = db.mp_webhook_log || [];
    if (c.expect.log) {
      const gotLog = logRows.map(r => r.result);
      if (JSON.stringify(gotLog) !== JSON.stringify(c.expect.log)) diffs.push(`registro: esperado ${JSON.stringify(c.expect.log)}, obtenido ${JSON.stringify(gotLog)}`);
    }
    // El registro nunca guarda mails (los casos usan @example.test en perfiles, pendings y pagadores).
    if (logRows.some(r => JSON.stringify(r).includes('@'))) diffs.push('registro: contiene un mail');
    if (logRows.length && logRows.some(r => r.payment_id && r.result === 'registrado' && !db.payments.some(p => p.mp_payment_id === r.payment_id))) diffs.push('registro: dice registrado y el pago no está');
    if (diffs.length) { failed++; log(`FALLA  ${c.name}`); diffs.forEach(d => log('         ' + d)); }
    else log(`ok     ${c.name}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
log(`\n${cases.length - failed} de ${cases.length} casos OK`);
process.exit(failed ? 1 : 0);
