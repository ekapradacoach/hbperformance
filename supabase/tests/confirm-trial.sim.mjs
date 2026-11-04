// ============================================================================
// Simulación de pedidos contra el código REAL de confirm-trial.
// No usa la red ni la base: MP, Auth y Supabase están simulados en memoria. Datos ficticios (@example.test).
//
// Correr desde la raíz del repo, ANTES de cada deploy de confirm-trial:
//   node supabase/tests/confirm-trial.sim.mjs
//
// Sale con código 1 si algún caso falla. Demuestra la lógica de la función, NO cómo se comportan MP o Supabase en real.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] || path.join(here, '..', 'functions', 'confirm-trial', 'index.ts');
const KEY = 'clave-simulada';
const MIN = 6e4, DAY = 864e5;
const at = ms => new Date(Date.now() + ms).toISOString();
const PID = '11111111-1111-4111-8111-111111111111', PID2 = '22222222-2222-4222-8222-222222222222';
const GENERIC = '{"ok":false,"error":"No pudimos confirmar tu prueba, escribinos"}';
const RETRY = '{"ok":false,"error":"No pudimos confirmar tu prueba, escribinos","retry":true}';

// ---- Supabase y Auth en memoria ----
let db, mp;
const likeToRe = p => new RegExp('^' + p.replace(/\\(.)|[%_]|[.*+?^${}()|[\]\\]/g, (m, esc) => (esc ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : m === '%' ? '.*' : m === '_' ? '.' : '\\' + m)) + '$', 'i');
function table(name) {
  const s = { filters: [], op: 'select' };
  const run = () => {
    if (db.fail?.[name + ':' + s.op]) return { data: null, count: null, error: { message: 'falla simulada' } };
    const rows = db[name] || (db[name] = []);
    const match = x => s.filters.every(f => f(x));
    if (s.op === 'insert') { rows.push({ id: name + '-' + rows.length, created_at: at(0), ...s.value }); return { data: null, error: null }; }
    if (s.op === 'upsert') {
      const old = rows.find(r => r.preapproval_id === s.value.preapproval_id);
      if (old) Object.assign(old, s.value); else rows.push({ ...s.value });
      return { data: null, error: null };
    }
    if (s.op === 'update') { rows.filter(match).forEach(x => Object.assign(x, s.value)); return { data: null, error: null }; }
    if (s.op === 'delete') { db[name] = rows.filter(x => !match(x)); return { data: null, error: null }; }
    let out = rows.filter(match);
    if (s.limit) out = out.slice(0, s.limit);
    if (s.head) return { data: null, count: out.length, error: null };
    if (s.one) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  };
  const b = {
    select(_c, o) { if (o?.head) s.head = true; return b; },
    insert(v) { s.op = 'insert'; s.value = v; return b; },
    update(v) { s.op = 'update'; s.value = v; return b; },
    upsert(v) { s.op = 'upsert'; s.value = v; return b; },
    delete() { s.op = 'delete'; return b; },
    eq(k, v) { s.filters.push(x => x[k] === v); return b; },
    is(k, v) { s.filters.push(x => (x[k] ?? null) === v); return b; },
    in(k, v) { s.filters.push(x => v.includes(x[k])); return b; },
    gte(k, v) { s.filters.push(x => x[k] >= v); return b; },
    lte(k, v) { s.filters.push(x => x[k] <= v); return b; },
    ilike(k, p) { const re = likeToRe(p); s.filters.push(x => re.test(x[k])); return b; },
    limit(n) { s.limit = n; return b; },
    maybeSingle() { s.one = true; return b; },
    then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
  };
  return b;
}
globalThis.__createClient = () => ({
  from: table,
  rpc: async (fn, a) => {
    if (fn !== 'reservar_pending_prueba') throw new Error('rpc inesperada: ' + fn);
    if (db.fail?.rpc) return { data: null, error: { message: 'falla simulada' } };
    const p = db.pending_subscriptions.find(x => x.id === a.p_pending_id && x.is_trial);
    if (!p || p.trial_claimed_at) return { data: false, error: null };
    p.trial_claimed_at = at(0); p.trial_claimed_by = a.p_preapproval_id;
    return { data: true, error: null };
  },
  auth: { admin: {
    listUsers: async () => (db.fail?.listUsers ? { data: null, error: { message: 'falla simulada' } } : { data: { users: db.authUsers }, error: null }),
    inviteUserByEmail: async e => {
      db.invites.push(e);
      if (db.fail?.invite === 'exists') return { data: null, error: { status: 422, code: 'email_exists', message: 'existe' } };
      if (db.fail?.invite) return { data: null, error: { status: 500, message: 'falla simulada' } };
      return { data: { user: { id: 'new-' + db.invites.length } }, error: null };
    },
    deleteUser: async id => { db.deleted.push(id); return { error: null }; },
  } },
});
globalThis.Deno = { env: { get: k => (k === 'SERVICE_ROLE_KEY' ? KEY : 'x') }, serve: h => { globalThis.__handler = h; } };

// ---- Mercado Pago simulado ----
globalThis.fetch = async u => {
  const url = new URL(String(u));
  const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  db.mpCalls.push(url.pathname);
  if (url.pathname === '/preapproval/search') {
    if (mp.searchFails) return res({}, 500);
    return res({ results: mp.search?.[url.searchParams.get('payer_email')] ?? [] });
  }
  const m = url.pathname.match(/^\/preapproval\/(.+)$/);
  if (m) {
    if (mp.subStatusCode) return res({}, mp.subStatusCode);
    return res({ id: m[1], status: 'authorized', preapproval_plan_id: 'plan-t', payer_id: 777, date_created: at(-5 * MIN), next_payment_date: at(7 * DAY), ...mp.sub });
  }
  throw new Error('fetch inesperado: ' + u);
};

// ---- Datos ficticios ----
const pend = (extra = {}) => ({ id: PID, full_name: 'Lucia Prueba', email: 'lucia@example.test', phone: '1100000000', program: 'crossfit', is_trial: true, created_at: at(-10 * MIN), ...extra });
const CONFIG = [{ key: 'mp_trial_plan_crossfit', value: 'plan-t' }, { key: 'mp_plan_crossfit', value: 'plan-pago' }];
const byId = { preapproval_id: 'sub-1', pending_id: PID };
const byMail = { preapproval_id: 'sub-1', email: ' LUCIA@example.test ' };
const hook = { preapproval_id: 'sub-1' };
const foundOne = { 'lucia@example.test': [{ id: 'sub-1', status: 'authorized' }] };
const provisioned = { publicText: '{"ok":true}', profiles: 1, pendings: 0, invites: 1 };
const noAlta = (reason, extra = {}) => ({ publicText: GENERIC, profiles: 0, invites: 0, review: reason, ...extra });
const retry = { publicText: RETRY, profiles: 0, invites: 0, noReview: true };

const cases = [
  // Altas
  { name: 'Regreso con id: da el alta completa', pendings: [pend()], body: byId, expect: provisioned,
    check: d => { const p = d.profiles[0]; return p.trial_status === 'in_trial' && p.payer_id === '777' && p.mp_subscription_id === 'sub-1' && p.program === 'crossfit' && p.subscription_status === 'active' && p.trial_ends_at > p.trial_started_at && p.id === 'new-1' && p.email === 'lucia@example.test' && /^\d{4}-\d\d-\d\d$/.test(p.access_from); } },
  { name: 'La fecha de fin es la de MP', pendings: [pend()], mp: { sub: { next_payment_date: '2099-01-02T03:04:05.000-03:00' } }, body: byId, expect: provisioned, check: d => d.profiles[0].trial_ends_at === '2099-01-02T06:04:05.000Z' },
  { name: 'Regreso con mail: da el alta', pendings: [pend()], body: byMail, expect: provisioned },
  { name: 'Webhook: un pending coincide en la búsqueda, da el alta', internal: true, pendings: [pend()], mp: { search: foundOne }, body: hook, expect: { internalStatus: 'provisioned', httpStatus: 200, profiles: 1, pendings: 0, invites: 1 } },
  { name: 'Cierra el caso abierto al dar el alta', pendings: [pend()], reviews: [{ preapproval_id: 'sub-1', reason: 'sin_identificar' }], body: byId, expect: provisioned, check: d => !!d.trial_reviews[0].resolved_at },
  { name: 'Ya vinculada: responde bien, sin otra invitación', profiles: [{ id: 'u1', email: 'lucia@example.test', mp_subscription_id: 'sub-1' }], body: byId, expect: { publicText: '{"ok":true}', profiles: 1, invites: 0 } },
  { name: 'Ventana justa de casi 2 horas: pasa', pendings: [pend({ created_at: at(-124 * MIN) })], body: byId, expect: provisioned },

  // Regreso y webhook a la vez, y reintentos
  { name: 'Otro pedido tiene la reserva: pide reintento, sin invitar', pendings: [pend({ trial_claimed_at: at(-MIN), trial_claimed_by: 'sub-1' })], body: byId, expect: { publicText: RETRY, profiles: 0, invites: 0, pendings: 1 } },
  { name: 'Reserva ocupada en webhook: 503 para que MP reintente', internal: true, pendings: [pend({ trial_claimed_at: at(-MIN) })], mp: { search: foundOne }, body: hook, expect: { httpStatus: 503, profiles: 0, invites: 0 } },
  { name: 'Dos pedidos seguidos: una sola invitación', pendings: [pend()], body: byId, twice: true, expect: { publicText: '{"ok":true}', profiles: 1, pendings: 0, invites: 1 } },
  { name: 'Regreso y después aviso del webhook: una sola invitación', pendings: [pend()], mp: { search: foundOne }, body: byId, thenInternal: hook, expect: { internalStatus: 'already_linked', profiles: 1, invites: 1 } },
  { name: 'Falla la reserva: no invita', pendings: [pend()], fail: { rpc: true }, body: byId, expect: { ...retry, pendings: 1 } },

  // Verificaciones: sin alta y con el caso guardado
  { name: 'Pending inexistente', body: byId, expect: noAlta('pending_no_encontrado') },
  { name: 'Pending normal (no de prueba) no sirve', pendings: [pend({ is_trial: false })], body: byId, expect: noAlta('pending_no_encontrado', { pendings: 1 }) },
  { name: 'Mail sin pending: no guarda el mail escrito', pendings: [pend()], body: { preapproval_id: 'sub-1', email: 'otra@example.test' }, expect: noAlta('mail_no_coincide', { pendings: 1 }), check: d => !d.trial_reviews[0].email },
  { name: 'Comodín: a_b no toma el pending de axb', pendings: [pend({ email: 'axb@example.test' })], body: { preapproval_id: 'sub-1', email: 'a_b@example.test' }, expect: noAlta('mail_no_coincide', { pendings: 1 }) },
  { name: 'Otro programa', pendings: [pend({ program: 'hybrid' })], body: byId, expect: noAlta('otro_programa', { pendings: 1 }) },
  { name: 'Suscripción anterior al pending', pendings: [pend({ created_at: at(-MIN) })], body: byId, expect: noAlta('fuera_de_ventana', { pendings: 1 }) },
  { name: 'Suscripción más de 2 horas después del pending', pendings: [pend({ created_at: at(-126 * MIN) })], body: byId, expect: noAlta('fuera_de_ventana', { pendings: 1 }) },
  { name: 'Sin payer_id', pendings: [pend()], mp: { sub: { payer_id: null } }, body: byId, expect: noAlta('sin_payer_id', { pendings: 1 }) },
  { name: 'payer_id ya usado', pendings: [pend()], profiles: [{ id: 'u1', email: 'otra@example.test', payer_id: '777' }], body: byId, expect: { ...noAlta('payer_repetido', { pendings: 1 }), profiles: 1 } },
  { name: 'Ya tiene perfil: no lo toca ni lo reactiva', pendings: [pend()], profiles: [{ id: 'u1', email: 'LUCIA@example.test', subscription_status: 'cancelled', mp_subscription_id: 'sub-vieja' }], body: byId, expect: { ...noAlta('ya_tiene_cuenta', { pendings: 1 }), profiles: 1 },
    check: d => d.profiles[0].subscription_status === 'cancelled' && d.profiles[0].mp_subscription_id === 'sub-vieja' && !d.mpCalls.some(c => c.includes('sub-vieja')) },
  { name: 'Cuenta en Auth sin perfil', pendings: [pend()], authUsers: ['Lucia@example.test'], body: byId, expect: noAlta('ya_tiene_cuenta', { pendings: 1 }) },
  { name: 'La invitación dice que el mail existe', pendings: [pend()], fail: { invite: 'exists' }, body: byId, expect: { ...noAlta('ya_tiene_cuenta', { pendings: 1 }), invites: 1 }, check: d => !d.pending_subscriptions[0].trial_claimed_at },
  { name: 'Sin fecha de fin', pendings: [pend()], mp: { sub: { next_payment_date: null } }, body: byId, expect: noAlta('sin_fecha_de_fin', { pendings: 1 }) },
  { name: 'Fecha de fin vencida', pendings: [pend()], mp: { sub: { next_payment_date: at(-MIN) } }, body: byId, expect: noAlta('sin_fecha_de_fin', { pendings: 1 }) },
  { name: 'Sin fecha de creación', pendings: [pend()], mp: { sub: { date_created: null } }, body: byId, expect: noAlta('sin_fecha_de_creacion', { pendings: 1 }) },
  { name: 'Estado pausado', pendings: [pend()], mp: { sub: { status: 'paused' } }, body: byId, expect: noAlta('estado_paused', { pendings: 1 }) },
  { name: 'Segunda suscripción: el pending ya se usó', body: { preapproval_id: 'sub-2', pending_id: PID }, profiles: [{ id: 'u1', email: 'lucia@example.test', mp_subscription_id: 'sub-1', payer_id: '777' }], expect: { ...noAlta('pending_no_encontrado'), profiles: 1 } },

  // Sin caso guardado: nada para revisar
  { name: 'Plan pago: no es de prueba', pendings: [pend()], mp: { sub: { preapproval_plan_id: 'plan-pago' } }, body: byId, expect: { publicText: GENERIC, profiles: 0, invites: 0, noReview: true, pendings: 1 } },
  { name: 'Plan desconocido', pendings: [pend()], mp: { sub: { preapproval_plan_id: 'plan-x' } }, body: byId, expect: { publicText: GENERIC, profiles: 0, invites: 0, noReview: true } },
  { name: 'Suscripción inexistente en MP', pendings: [pend()], mp: { subStatusCode: 404 }, body: byId, expect: { publicText: GENERIC, profiles: 0, noReview: true } },
  { name: 'Suscripción todavía sin autorizar: pide reintento', pendings: [pend()], mp: { sub: { status: 'pending' } }, body: byId, expect: { ...retry, pendings: 1 } },
  { name: 'Cancelada sin alta: cierra el caso', pendings: [pend()], reviews: [{ preapproval_id: 'sub-1', reason: 'sin_identificar' }], mp: { sub: { status: 'cancelled' } }, body: byId, expect: { publicText: GENERIC, profiles: 0, invites: 0 }, check: d => !!d.trial_reviews[0].resolved_at },

  // Webhook: identificación por búsqueda
  { name: 'Webhook: la búsqueda no encuentra nada (MP con otro mail)', internal: true, pendings: [pend()], mp: { search: {} }, body: hook, expect: { internalStatus: 'sin_identificar', httpStatus: 200, profiles: 0, invites: 0, review: 'sin_identificar', pendings: 1 } },
  { name: 'Webhook: nunca toma por recencia al único pending', internal: true, pendings: [pend({ created_at: at(-6 * MIN) })], mp: { search: { 'lucia@example.test': [{ id: 'otra', status: 'authorized' }] } }, body: hook, expect: { internalStatus: 'sin_identificar', profiles: 0, invites: 0 } },
  { name: 'Webhook: dos pendings coinciden', internal: true, pendings: [pend(), pend({ id: PID2, email: 'sofia@example.test' })], mp: { search: { 'lucia@example.test': [{ id: 'sub-1', status: 'authorized' }], 'sofia@example.test': [{ id: 'sub-1', status: 'authorized' }] } }, body: hook, expect: { internalStatus: 'varios_pendings', profiles: 0, invites: 0, pendings: 2 } },
  { name: 'Webhook: el mail tiene dos suscripciones vivas', internal: true, pendings: [pend()], mp: { search: { 'lucia@example.test': [{ id: 'sub-1', status: 'authorized' }, { id: 'sub-2', status: 'authorized' }] } }, body: hook, expect: { internalStatus: 'varias_suscripciones', profiles: 0, invites: 0 } },
  { name: 'Webhook: una suscripción cancelada no molesta', internal: true, pendings: [pend()], mp: { search: { 'lucia@example.test': [{ id: 'sub-1', status: 'authorized' }, { id: 'vieja', status: 'cancelled' }] } }, body: hook, expect: { internalStatus: 'provisioned', profiles: 1 } },
  { name: 'Webhook: ignora un pending fuera de la ventana', internal: true, pendings: [pend({ created_at: at(-126 * MIN) })], mp: { search: foundOne }, body: hook, expect: { internalStatus: 'sin_identificar', profiles: 0 } },
  { name: 'Webhook: ignora un pending normal del mismo mail', internal: true, pendings: [pend({ is_trial: false })], mp: { search: foundOne }, body: hook, expect: { internalStatus: 'sin_identificar', profiles: 0 } },
  { name: 'Webhook: ignora un pending de otro programa', internal: true, pendings: [pend({ program: 'hybrid' })], mp: { search: foundOne }, body: hook, expect: { internalStatus: 'sin_identificar', profiles: 0 } },
  { name: 'Webhook: falla la búsqueda en MP, 503', internal: true, pendings: [pend()], mp: { searchFails: true }, body: hook, expect: { httpStatus: 503, profiles: 0, noReview: true } },
  { name: 'Primer cobro sin vincular: nunca da el alta, anota el cobro', internal: true, pendings: [pend()], mp: { search: foundOne }, body: { ...hook, charge_seen: true }, expect: { internalStatus: 'cobro_sin_vincular', httpStatus: 200, profiles: 0, invites: 0, review: 'cobro_sin_vincular', pendings: 1 }, check: d => !!d.trial_reviews[0]?.charge_seen_at },
  { name: 'Un aviso nuevo no reabre un caso resuelto', internal: true, pendings: [], reviews: [{ preapproval_id: 'sub-1', reason: 'x', resolved_at: '2026-01-01' }], mp: { search: {} }, body: hook, expect: { internalStatus: 'sin_identificar' }, check: d => d.trial_reviews[0].resolved_at === '2026-01-01' },

  // El público no puede hacerse pasar por el webhook
  { name: 'Clave equivocada: charge_seen no cuenta y sin datos se rechaza', pendings: [pend()], headers: { authorization: 'Bearer otra' }, body: { ...hook, charge_seen: true }, expect: { publicText: GENERIC, profiles: 0, noReview: true } },
  { name: 'Clave equivocada con pending_id: es pedido público, no interno', pendings: [pend()], headers: { authorization: 'Bearer otra' }, body: { ...byId, charge_seen: true }, expect: provisioned, check: d => !d.trial_reviews.length },
  { name: 'Clave vacía: charge_seen no cuenta', pendings: [pend()], headers: { authorization: 'Bearer ' }, body: { ...hook, charge_seen: true }, expect: { publicText: GENERIC, profiles: 0, noReview: true }, check: d => d.mpCalls.length === 0 },
  { name: 'Clave correcta: charge_seen sí cuenta', pendings: [pend()], headers: { authorization: 'Bearer ' + KEY }, mp: { search: foundOne }, body: { ...hook, charge_seen: true }, expect: { httpStatus: 200, internalStatus: 'cobro_sin_vincular', profiles: 0, invites: 0, review: 'cobro_sin_vincular' } },
  { name: 'Público sin id ni mail: no dispara la búsqueda', pendings: [pend()], mp: { search: foundOne }, body: hook, expect: { publicText: GENERIC, profiles: 0, noReview: true }, check: d => d.mpCalls.length === 0 },
  { name: 'Interno: ignora el pending_id del cuerpo', internal: true, pendings: [pend()], mp: { search: {} }, body: byId, expect: { internalStatus: 'sin_identificar', profiles: 0 } },

  // Datos inválidos
  { name: 'Id con barra: no llega a MP', body: { preapproval_id: '../x', pending_id: PID }, expect: { publicText: GENERIC, noReview: true }, check: d => d.mpCalls.length === 0 },
  { name: 'pending_id que no es uuid', body: { preapproval_id: 'sub-1', pending_id: 'abc' }, expect: { publicText: GENERIC, noReview: true }, check: d => d.mpCalls.length === 0 },
  { name: 'Mail inválido', body: { preapproval_id: 'sub-1', email: 'x@' }, expect: { publicText: GENERIC, noReview: true }, check: d => d.mpCalls.length === 0 },
  { name: 'Cuerpo que no es JSON', raw: 'hola', expect: { publicText: GENERIC, noReview: true } },
  { name: 'Método GET', method: 'GET', expect: { publicText: GENERIC, noReview: true } },

  // Límites
  { name: 'Mail: el sexto intento se rechaza', pendings: [pend()], priorMail: 5, body: byMail, expect: { publicText: GENERIC, profiles: 0, noReview: true }, check: d => d.mpCalls.length === 0 },
  { name: 'Mail: el quinto intento pasa', pendings: [pend()], priorMail: 4, body: byMail, expect: provisioned },
  { name: 'Con id: el límite de mail no aplica', pendings: [pend()], priorMail: 5, body: byId, expect: provisioned },
  { name: 'Con id: el pedido 21 se rechaza', pendings: [pend()], priorAll: 20, body: byId, expect: { publicText: GENERIC, profiles: 0, noReview: true }, check: d => d.mpCalls.length === 0 },
  { name: 'Interno: sin límite', internal: true, pendings: [pend()], priorAll: 20, mp: { search: foundOne }, body: hook, expect: { internalStatus: 'provisioned' } },
  { name: 'No se puede leer el límite: no pasa', pendings: [pend()], fail: { 'trial_attempts:select': true }, body: byId, expect: { publicText: GENERIC, profiles: 0, noReview: true } },

  // Fallas: nunca hay alta a medias y se puede reintentar
  ...[
    ['Falla leer el plan', 'site_config:select'], ['Falla leer perfiles', 'profiles:select'], ['Falla leer el pending', 'pending_subscriptions:select'], ['Falla leer Auth', 'listUsers'],
  ].map(([name, f]) => ({ name, pendings: [pend()], fail: { [f]: true }, body: byId, expect: { ...retry } })),
  { name: 'MP falla', pendings: [pend()], mp: { subStatusCode: 500 }, body: byId, expect: { ...retry, pendings: 1 } },
  { name: 'Interno, MP falla: 503', internal: true, pendings: [pend()], mp: { subStatusCode: 500 }, body: hook, expect: { httpStatus: 503, profiles: 0 } },
  { name: 'Falla la invitación: libera la reserva', pendings: [pend()], fail: { invite: true }, body: byId, expect: { publicText: RETRY, profiles: 0, pendings: 1, noReview: true }, check: d => !d.pending_subscriptions[0].trial_claimed_at },
  { name: 'Falla guardar el perfil: borra el usuario nuevo y libera; conserva el pending', pendings: [pend()], fail: { 'profiles:insert': true }, body: byId, expect: { publicText: RETRY, profiles: 0, pendings: 1, invites: 1 }, check: d => d.deleted[0] === 'new-1' && !d.pending_subscriptions[0].trial_claimed_at },
  { name: 'Falla guardar el perfil y el reintento da el alta', pendings: [pend()], fail: { 'profiles:insert': true }, clearFailAndRetry: true, body: byId, expect: { publicText: '{"ok":true}', profiles: 1, pendings: 0, invites: 2 } },
  { name: 'Falla guardar el caso: pide reintento, no pierde el aviso', internal: true, pendings: [pend()], mp: { search: {} }, fail: { 'trial_reviews:upsert': true }, body: hook, expect: { httpStatus: 503, profiles: 0 } },
  { name: 'Falla borrar el pending: el alta queda hecha', pendings: [pend()], fail: { 'pending_subscriptions:delete': true }, body: byId, expect: { publicText: '{"ok":true}', profiles: 1, pendings: 1 } },
];

// ---- Cargar el código real ----
const tmp = mkdtempSync(path.join(tmpdir(), 'ct-sim-'));
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

  const IP = '198.51.100.7';
  const send = (c, body = c.body, internal = c.internal) => globalThis.__handler(new Request('http://sim/', {
    method: c.method || 'POST',
    headers: { 'x-forwarded-for': IP, ...(internal ? { authorization: 'Bearer ' + KEY } : {}), ...c.headers },
    body: (c.method || 'POST') === 'GET' ? undefined : (c.raw ?? JSON.stringify(body)),
  }));
  const fresh = (c = {}) => {
    db = {
      trial_attempts: [], pending_subscriptions: (c.pendings || []).map(p => ({ ...p })), profiles: (c.profiles || []).map(p => ({ ...p })),
      site_config: CONFIG, trial_reviews: (c.reviews || []).map(r => ({ ...r })), authUsers: (c.authUsers || []).map((email, i) => ({ id: 'a' + i, email })),
      invites: [], deleted: [], mpCalls: [], fail: c.fail,
    };
    mp = { ...c.mp };
  };
  // El hash lo calcula la función: se obtiene con pedidos previos sobre una base vacía.
  fresh();
  await send({}, { preapproval_id: 'sub-1', pending_id: PID }, false);
  const hashAll = db.trial_attempts[0]?.ip_hash;
  fresh();
  await send({}, { preapproval_id: 'sub-1', email: 'x@example.test' }, false);
  const hashMail = db.trial_attempts.find(a => a.ip_hash !== hashAll)?.ip_hash;

  for (const c of cases) {
    fresh(c);
    for (let i = 0; i < (c.priorAll || 0); i++) db.trial_attempts.push({ ip_hash: hashAll, created_at: at(-MIN) });
    for (let i = 0; i < (c.priorMail || 0); i++) db.trial_attempts.push({ ip_hash: hashMail, created_at: at(-MIN) });
    logs = [];
    let r = await send(c);
    let text = await r.text();
    if (c.twice) { r = await send(c); text = await r.text(); }
    if (c.thenInternal) { r = await send(c, c.thenInternal, true); text = await r.text(); }
    if (c.clearFailAndRetry) { db.fail = null; r = await send(c); text = await r.text(); }
    const diffs = [];
    const e = c.expect;
    const body = JSON.parse(text);
    if (e.publicText !== undefined && text !== e.publicText) diffs.push('respuesta: ' + text);
    if (e.httpStatus !== undefined && r.status !== e.httpStatus) diffs.push('status ' + r.status);
    if (e.httpStatus === undefined && !c.internal && r.status !== 200) diffs.push('status público ' + r.status);
    if (e.internalStatus !== undefined && body.status !== e.internalStatus) diffs.push('estado interno: ' + text);
    if (e.profiles !== undefined && db.profiles.length !== e.profiles) diffs.push(`perfiles: esperado ${e.profiles}, obtenido ${db.profiles.length}`);
    if (e.pendings !== undefined && db.pending_subscriptions.length !== e.pendings) diffs.push(`pendings: esperado ${e.pendings}, obtenido ${db.pending_subscriptions.length}`);
    if (e.invites !== undefined && db.invites.length !== e.invites) diffs.push(`invitaciones: esperado ${e.invites}, obtenido ${db.invites.length}`);
    if (e.review && db.trial_reviews[0]?.reason !== e.review) diffs.push(`caso: esperado ${e.review}, obtenido ${db.trial_reviews[0]?.reason}`);
    if (e.noReview && db.trial_reviews.length) diffs.push('guardó un caso que no debía: ' + db.trial_reviews[0].reason);
    let checked = true;
    try { checked = !c.check || c.check(db); } catch (_) { checked = false; }
    if (!checked) diffs.push('no cumple la verificación del caso');
    if (logs.some(l => /@/.test(l))) diffs.push('el log contiene un mail');
    if (diffs.length) { failed++; log(`FALLA  ${c.name}`); diffs.forEach(d => log('         ' + d)); }
    else log(`ok     ${c.name}`);
  }
  log(`\n${cases.length - failed} de ${cases.length} casos OK`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
