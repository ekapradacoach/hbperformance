// ============================================================================
// Etapa 7: simulación de trial-admin (acciones del admin sobre un caso de la prueba).
// Sin red ni base: MP, Auth y Supabase simulados en memoria. Datos ficticios (@example.test).
// Correr desde la raíz del repo, antes de cada deploy de trial-admin:
//   node supabase/tests/trial-admin.sim.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] || path.join(here, '..', 'functions', 'trial-admin', 'index.ts');
const MIN = 6e4, DAY = 864e5;
const at = ms => new Date(Date.now() + ms).toISOString();
const PID = '11111111-1111-4111-8111-111111111111';

let db, mp, calls;
const clone = x => JSON.parse(JSON.stringify(x));
const likeToRe = p => new RegExp('^' + p.replace(/\\(.)|[%_]|[.*+?^${}()|[\]\\]/g, (m, esc) => (esc ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : m === '%' ? '.*' : m === '_' ? '.' : '\\' + m)) + '$', 'i');
function table(name) {
  const s = { filters: [], op: 'select', one: false, limit: null, returning: false };
  const run = () => {
    const rows = db[name] || (db[name] = []);
    const match = x => s.filters.every(f => f(x));
    const write = ['insert', 'update', 'upsert', 'delete'].includes(s.op);
    if (write && db.fail?.[name + ':' + s.op]) return { data: null, error: { message: 'falla simulada' } };
    if (s.op === 'insert') { rows.push(clone(s.value)); return { data: null, error: null }; }
    if (s.op === 'upsert') {
      const key = s.opts?.onConflict;
      const old = rows.find(r => r[key] === s.value[key]);
      if (old) { if (!s.opts?.ignoreDuplicates) Object.assign(old, clone(s.value)); } else rows.push(clone(s.value));
      return { data: null, error: null };
    }
    if (s.op === 'update') { const hit = rows.filter(match); hit.forEach(x => Object.assign(x, clone(s.value))); return { data: s.returning ? clone(hit) : null, error: null }; }
    if (s.op === 'delete') { db[name] = rows.filter(x => !match(x)); return { data: null, error: null }; }
    if (db.fail?.[name + ':select']) return { data: null, error: { message: 'falla simulada' } };
    let out = rows.filter(match);
    if (s.limit) out = out.slice(0, s.limit);
    if (s.one) return { data: clone(out[0] ?? null), error: null };
    return { data: clone(out), error: null };
  };
  const b = {
    select() { if (s.op !== 'select') s.returning = true; return b; },
    insert(v) { s.op = 'insert'; s.value = v; return b; }, update(v) { s.op = 'update'; s.value = v; return b; },
    upsert(v, o) { s.op = 'upsert'; s.value = v; s.opts = o; return b; }, delete() { s.op = 'delete'; return b; },
    eq(k, v) { s.filters.push(x => x[k] === v); return b; }, is(k, v) { s.filters.push(x => (x[k] ?? null) === v); return b; },
    in(k, v) { s.filters.push(x => v.includes(x[k])); return b; },
    ilike(k, p) { const re = likeToRe(p); s.filters.push(x => re.test(x[k])); return b; },
    limit(n) { s.limit = n; return b; }, maybeSingle() { s.one = true; return b; },
    then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
globalThis.__createClient = () => ({
  from: table,
  rpc: async (fn, a) => {
    const p = db.pending_subscriptions.find(x => x.id === a.p_pending_id && x.is_trial);
    if (!p || (p.trial_claimed_at && p.trial_claimed_by !== a.p_preapproval_id)) return { data: false, error: null };
    p.trial_claimed_at = at(0); p.trial_claimed_by = a.p_preapproval_id;
    return { data: true, error: null };
  },
  auth: {
    getUser: async jwt => (db.jwts[jwt] ? { data: { user: { id: db.jwts[jwt] } }, error: null } : { data: { user: null }, error: { message: 'jwt' } }),
    admin: {
      listUsers: async () => ({ data: { users: db.authUsers.map((email, i) => ({ id: 'a' + i, email })) }, error: null }),
      inviteUserByEmail: async e => { calls.push('invita:' + e); if (db.fail?.invite) return { data: null, error: { message: 'falla' } }; return { data: { user: { id: 'new-' + calls.length } }, error: null }; },
      deleteUser: async id => { calls.push('borra-auth:' + id); return { error: null }; },
    },
  },
});
globalThis.Deno = { env: { get: () => 'x' }, serve: h => { globalThis.__handler = h; } };
globalThis.fetch = async (u, opts = {}) => {
  const url = new URL(String(u));
  const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (url.pathname === '/authorized_payments/search') {
    if (mp.invoicesFail) return res({}, 500);
    return res({ results: (mp.invoices || []).map(i => ({ preapproval_id: url.searchParams.get('preapproval_id'), ...i })) });
  }
  const pm = url.pathname.match(/^\/v1\/payments\/(.+)$/);
  if (pm) return mp.payments?.[pm[1]] ? res(mp.payments[pm[1]]) : res({}, 404);
  const m = url.pathname.match(/^\/preapproval\/(.+)$/);
  if (m) {
    if (opts.method === 'PUT') { calls.push('MP-cancela:' + m[1]); return mp.putFails ? res({}, 500) : res({}); }
    if (mp.subStatusCode) return res({}, mp.subStatusCode);
    return res({ id: m[1], status: 'authorized', preapproval_plan_id: 'plan-t', payer_id: 777, date_created: at(-5 * MIN), next_payment_date: at(7 * DAY), ...mp.sub });
  }
  throw new Error('fetch inesperado: ' + u);
};

const CONFIG = [{ key: 'mp_trial_plan_crossfit', value: 'plan-t' }, { key: 'price_crossfit_ars', value: '45000' }];
const PAY = { id: 9001, status: 'approved', transaction_amount: 45000, transaction_details: { net_received_amount: 41405.99 }, date_approved: at(-4 * MIN) };
const paidMp = (extra = {}) => ({ sub: { next_payment_date: at(30 * DAY) }, invoices: [{ id: 'c1', status: 'processed', payment: { id: 9001, status: 'approved' } }], payments: { 9001: PAY }, ...extra });
const pend = (extra = {}) => ({ id: PID, full_name: 'Lucia Prueba', email: 'lucia@example.test', phone: '1100000000', program: 'crossfit', is_trial: true, created_at: at(-200 * MIN), ...extra });
const review = (extra = {}) => ({ preapproval_id: 'sub-1', program: 'crossfit', reason: 'sin_identificar', email: 'lucia@example.test', resolved_at: null, ...extra });
const ADMIN = 'jwt-admin', ATHLETE = 'jwt-alumno';
const req = (body, jwt = ADMIN) => ({ body, jwt });

const cases = [
  // Acceso
  { name: 'Sin sesión: 401', call: req({ action: 'inspect', preapproval_id: 'sub-1' }, null), expect: r => r.status === 401 && calls.length === 0 },
  { name: 'Token inválido: 401 y no consulta MP', call: req({ action: 'inspect', preapproval_id: 'sub-1' }, 'jwt-falso'), expect: r => r.status === 401 && db.mpCalls === 0 },
  { name: 'Alumno: 403 y no consulta MP', call: req({ action: 'inspect', preapproval_id: 'sub-1' }, ATHLETE), expect: r => r.status === 403 && db.mpCalls === 0 },
  { name: 'Id inválido: 400', call: req({ action: 'inspect', preapproval_id: '../x' }), expect: r => r.status === 400 },
  { name: 'Acción desconocida: 400', call: req({ action: 'borrar', preapproval_id: 'sub-1' }), expect: r => r.status === 400 },
  // inspect
  { name: 'inspect: muestra MP, modo prueba, caso y pendings', pendings: [pend()], reviews: [review()], call: req({ action: 'inspect', preapproval_id: 'sub-1' }),
    expect: r => r.status === 200 && r.body.mp.mode === 'prueba' && r.body.mp.program === 'crossfit' && !r.body.mp.linked && r.body.pendings.length === 1 && r.body.review.reason === 'sin_identificar' && db.profiles.length === 0 },
  { name: 'inspect: alta paga con cobro aprobado y payer ya usado', pendings: [pend()], profiles: [{ id: 'u9', email: 'otra@example.test', payer_id: '777' }], mp: paidMp(), call: req({ action: 'inspect', preapproval_id: 'sub-1' }),
    expect: r => r.body.mp.mode === 'paga' && r.body.mp.charge.approved_amount === 45000 && r.body.mp.payer_used === true && r.body.mp.price === 45000 },
  { name: 'inspect: MP no encuentra la suscripción: 404', mp: { subStatusCode: 404 }, call: req({ action: 'inspect', preapproval_id: 'sub-1' }), expect: r => r.status === 404 },
  // provision: prueba
  { name: 'Alta de prueba con el pending elegido (ventana vencida, se permite)', pendings: [pend()], reviews: [review({ reason: 'fuera_de_ventana' })], call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }),
    expect: r => r.body.ok && r.body.mode === 'prueba' && db.profiles.length === 1 && db.profiles[0].trial_status === 'in_trial' && db.profiles[0].email === 'lucia@example.test'
      && db.profiles[0].mp_subscription_id === 'sub-1' && db.pending_subscriptions.length === 0 && !!db.trial_reviews[0].resolved_at && db.trial_reviews[0].resolved_by === 'admin-1' && calls.filter(c => c.startsWith('invita')).length === 1 },
  { name: 'Alta de prueba con payer repetido (se permite)', pendings: [pend()], profiles: [{ id: 'u9', email: 'otra@example.test', payer_id: '777' }], call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }),
    expect: r => r.body.ok && r.body.mode === 'prueba' && db.profiles.length === 2 },
  { name: 'Alta con datos escritos por el admin (mail distinto al formulario)', reviews: [review({ reason: 'mail_no_coincide' })], call: req({ action: 'provision', preapproval_id: 'sub-1', full_name: 'Sofia Otra', email: ' SOFIA@example.test ', phone: '11 2222' }),
    expect: r => r.body.ok && db.profiles[0].email === 'sofia@example.test' && db.profiles[0].full_name === 'Sofia Otra' && db.profiles[0].trial_status === 'in_trial' },
  // provision: paga
  { name: 'Alta paga: perfil sin prueba + cobro alta_nueva', pendings: [pend()], mp: paidMp(), call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }),
    expect: r => r.body.ok && r.body.mode === 'paga' && !db.profiles[0].trial_status && !db.profiles[0].trial_ends_at && db.payments.length === 1 && db.payments[0].type === 'alta_nueva' && db.payments[0].mp_payment_id === '9001' && db.payments[0].athlete_id === db.profiles[0].id },
  { name: 'Corredores: alta paga a $40.000 con su plan', pendings: [pend({ program: 'corredores' })],
    config: [...CONFIG, { key: 'mp_trial_plan_corredores', value: 'plan-tc' }, { key: 'price_corredores_ars', value: '40000' }],
    mp: paidMp({ sub: { preapproval_plan_id: 'plan-tc', next_payment_date: at(30 * DAY) }, payments: { 9001: { ...PAY, transaction_amount: 40000 } } }),
    call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }),
    expect: r => r.body.ok && r.body.mode === 'paga' && db.profiles[0].program === 'corredores' && db.payments[0].amount === 40000 },
  { name: 'Hybrid: alta de prueba sin variante', pendings: [pend({ program: 'hybrid' })],
    config: [...CONFIG, { key: 'mp_trial_plan_hybrid', value: 'plan-th' }, { key: 'price_hybrid_ars', value: '45000' }],
    mp: { sub: { preapproval_plan_id: 'plan-th' } }, call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }),
    expect: r => r.body.ok && r.body.mode === 'prueba' && db.profiles[0].program === 'hybrid' && db.profiles[0].hybrid_variant == null },
  { name: 'Alta paga y falla registrar el cobro: alta hecha con aviso', pendings: [pend()], mp: paidMp(), fail: { 'payments:upsert': true }, call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }),
    expect: r => r.body.ok && /cargalo a mano/.test(r.body.warning || '') && db.profiles.length === 1 },
  // provision: reglas fijas
  { name: 'Mail con perfil: no da el alta (reactivación)', pendings: [pend()], profiles: [{ id: 'u1', email: 'Lucia@example.test', subscription_status: 'cancelled' }], call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }),
    expect: r => r.status === 409 && db.profiles.length === 1 && db.profiles[0].subscription_status === 'cancelled' && calls.length === 0 },
  { name: 'Mail con cuenta en Auth: no da el alta', pendings: [pend()], authUsers: ['lucia@example.test'], call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Suscripción ya vinculada: no', pendings: [pend()], profiles: [{ id: 'u1', email: 'otra@example.test', mp_subscription_id: 'sub-1' }], call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 1 },
  { name: 'Suscripción cancelada en MP: no', pendings: [pend()], mp: { sub: { status: 'cancelled' } }, call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Otro plan con datos escritos: no', mp: { sub: { preapproval_plan_id: 'plan-pago' } }, call: req({ action: 'provision', preapproval_id: 'sub-1', full_name: 'Sofia Otra', email: 'sofia@example.test' }), expect: r => r.status === 409 && db.profiles.length === 0 && calls.length === 0 },
  { name: 'Otro plan: no', pendings: [pend()], mp: { sub: { preapproval_plan_id: 'plan-pago' } }, call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Plazo dudoso: no', pendings: [pend()], mp: { sub: { next_payment_date: at(14 * DAY) } }, call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Prueba con cobro en MP: no', pendings: [pend()], mp: { invoices: [{ id: 'c', status: 'processed', payment: { id: 9001, status: 'approved' } }], payments: { 9001: PAY } }, call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Sin prueba y sin cobro aprobado: no', pendings: [pend()], mp: paidMp({ invoices: [] }), call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Sin prueba y cobro devuelto: no', pendings: [pend()], mp: paidMp({ payments: { 9001: { ...PAY, status: 'refunded' } } }), call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Sin prueba y monto distinto: no', pendings: [pend()], mp: paidMp({ payments: { 9001: { ...PAY, transaction_amount: 100 } } }), call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Sin payer_id: no', pendings: [pend()], mp: { sub: { payer_id: null } }, call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Pending de otro programa: no', pendings: [pend({ program: 'hybrid' })], call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Pending normal (no de prueba): no', pendings: [pend({ is_trial: false })], call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 },
  { name: 'Pending reservado por otra suscripción: no', pendings: [pend({ trial_claimed_at: at(-MIN), trial_claimed_by: 'sub-otra' })], call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 0 && calls.length === 0 },
  { name: 'Datos escritos sin nombre: 400', call: req({ action: 'provision', preapproval_id: 'sub-1', email: 'x@example.test' }), expect: r => r.status === 400 && db.profiles.length === 0 },
  { name: 'Falla la invitación: libera la reserva', pendings: [pend()], fail: { invite: true }, call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 502 && db.profiles.length === 0 && !db.pending_subscriptions[0].trial_claimed_at },
  { name: 'Falla guardar el perfil: borra el usuario nuevo y libera', pendings: [pend()], fail: { 'profiles:insert': true }, call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 500 && calls.some(c => c.startsWith('borra-auth')) && !db.pending_subscriptions[0].trial_claimed_at },
  { name: 'Dos altas seguidas: la segunda no (ya vinculada), una sola invitación', pendings: [pend()], twice: true, call: req({ action: 'provision', preapproval_id: 'sub-1', pending_id: PID }), expect: r => r.status === 409 && db.profiles.length === 1 && calls.filter(c => c.startsWith('invita')).length === 1 },
  // cancel
  { name: 'Cancelar en MP: sin vincular y del plan de prueba', reviews: [review()], call: req({ action: 'cancel', preapproval_id: 'sub-1', note: 'era un error' }),
    expect: r => r.body.ok && calls.join() === 'MP-cancela:sub-1' && !!db.trial_reviews[0].resolved_at && db.trial_reviews[0].review_note === 'era un error' },
  { name: 'Cancelar una vinculada: no (es de un alumno)', profiles: [{ id: 'u1', email: 'a@example.test', mp_subscription_id: 'sub-1' }], call: req({ action: 'cancel', preapproval_id: 'sub-1' }), expect: r => r.status === 409 && calls.length === 0 },
  { name: 'Cancelar otro plan: no', mp: { sub: { preapproval_plan_id: 'plan-pago' } }, call: req({ action: 'cancel', preapproval_id: 'sub-1' }), expect: r => r.status === 409 && calls.length === 0 },
  { name: 'Cancelar y MP falla: 502, el caso sigue abierto', reviews: [review()], mp: { putFails: true }, call: req({ action: 'cancel', preapproval_id: 'sub-1' }), expect: r => r.status === 502 && !db.trial_reviews[0].resolved_at },
  { name: 'Cancelar una ya cancelada: cierra el caso sin llamar a MP', reviews: [review()], mp: { sub: { status: 'cancelled' } }, call: req({ action: 'cancel', preapproval_id: 'sub-1' }), expect: r => r.body.ok && r.body.already && calls.length === 0 && !!db.trial_reviews[0].resolved_at },
  // resolve
  { name: 'Resolver con nota', reviews: [review()], call: req({ action: 'resolve', preapproval_id: 'sub-1', note: 'lo resolví por WhatsApp' }),
    expect: r => r.body.ok && !!db.trial_reviews[0].resolved_at && db.trial_reviews[0].review_note === 'lo resolví por WhatsApp' && db.trial_reviews[0].resolved_by === 'admin-1' && db.mpCalls === 0 },
  { name: 'Resolver sin nota: 400', reviews: [review()], call: req({ action: 'resolve', preapproval_id: 'sub-1' }), expect: r => r.status === 400 && !db.trial_reviews[0].resolved_at },
  { name: 'Resolver uno ya resuelto: 409, no lo pisa', reviews: [review({ resolved_at: '2026-01-01', review_note: 'vieja' })], call: req({ action: 'resolve', preapproval_id: 'sub-1', note: 'nueva' }), expect: r => r.status === 409 && db.trial_reviews[0].review_note === 'vieja' },
];

const tmp = mkdtempSync(path.join(tmpdir(), 'ta-sim-'));
const log = console.log;
let failed = 0, logs = [];
try {
  const code = readFileSync(source, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__createClient');
  const ts = path.join(tmp, 'index.ts'), js = path.join(tmp, 'index.mjs');
  writeFileSync(ts, code);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['-y', 'esbuild@0.24.0', ts, '--loader:.ts=ts', '--format=esm', '--log-level=warning', '--outfile=' + js], { stdio: 'inherit', shell: process.platform === 'win32' });
  await import(pathToFileURL(js).href);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => { db.mpCalls++; return realFetch(u, o); };
  console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
  for (const c of cases) {
    db = { profiles: [{ id: 'admin-1', email: 'coach@example.test', role: 'admin' }, { id: 'alumno-1', email: 'al@example.test', role: 'athlete' }, ...clone(c.profiles || [])],
      pending_subscriptions: clone(c.pendings || []), trial_reviews: clone(c.reviews || []), payments: [], site_config: c.config || CONFIG,
      authUsers: ['coach@example.test', 'al@example.test', ...(c.authUsers || [])], jwts: { [ADMIN]: 'admin-1', [ATHLETE]: 'alumno-1' }, fail: c.fail, mpCalls: 0 };
    mp = { ...clone(c.mp || {}) };
    calls = []; logs = [];
    const send = async () => {
      const r = await globalThis.__handler(new Request('http://sim/', { method: 'POST', headers: c.call.jwt ? { Authorization: 'Bearer ' + c.call.jwt } : {}, body: JSON.stringify(c.call.body) }));
      return { status: r.status, body: await r.json() };
    };
    let r = await send();
    if (c.twice) r = await send();
    // Los perfiles fijos (admin y alumno) no cuentan en las verificaciones
    const real = db.profiles;
    db.profiles = real.filter(p => p.id !== 'admin-1' && p.id !== 'alumno-1');
    let ok = false;
    try { ok = !!c.expect(r); } catch (_) {}
    if (logs.some(l => /@/.test(l))) { ok = false; log('         el log contiene un mail'); }
    if (!ok) { failed++; log(`FALLA  ${c.name}\n         ${JSON.stringify(r)}\n         perfiles ${JSON.stringify(db.profiles)} llamadas ${JSON.stringify(calls)}`); }
    else log(`ok     ${c.name}`);
  }
  log(`\n${cases.length - failed} de ${cases.length} casos OK`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
