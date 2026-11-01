// ============================================================================
// Fase 2, etapa 1: ¿se puede identificar a la persona usando un PLAN de Mercado Pago?
// Herramienta manual contra PRODUCCIÓN de MP (cobros reales). No toca Supabase ni process-payment.
//
// Correr desde la raíz del repo, en una terminal de VS Code o PowerShell:
//   node supabase/tests/mp-etapa1.mjs
//
// Candados:
//  · La credencial se pide al iniciar, no se ve y queda solo en memoria.
//  · Opera sobre UN solo plan, creado por este script con nombre, monto y prueba fijos. Al arrancar verifica que
//    siga siendo ese; si no coincide, se cierra.
//  · Todo pasa por mp(), que solo deja salir las llamadas de ALLOWED. Las suscripciones se aceptan únicamente si
//    aparecen en la búsqueda filtrada por ese plan: a una ajena ni se la consulta.
//  · No puede crear otros planes, modificar planes, ni devolver pagos. Lo único que escribe, además del plan,
//    es cancelar una suscripción de ese plan.
// En tu carpeta de usuario se guarda .hb-mp-etapa1-prod.json (sin secretos): plan, cuenta y referencias.
// ============================================================================
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

const API = 'https://api.mercadopago.com';
const STATE_FILE = path.join(homedir(), '.hb-mp-etapa1-prod.json');
const PLAN_NAME = 'PRUEBA TECNICA HB - NO COMPRAR - etapa 1';
const PLAN_AMOUNT = 100; // ARS. MP no documenta un mínimo: si lo rechaza, se muestra el motivo.
const PLAN_TRIAL = { frequency: 1, frequency_type: 'days' };
// Sin hbperformance.fit: el regreso a una página real podría disparar el Pixel.
const BACK_URL = 'https://example.com/regreso-prueba';
const out = console.log;

let token = '';
let state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const hideToken = s => (token ? String(s).split(token).join('[credencial oculta]') : String(s));
const validId = id => /^[A-Za-z0-9_-]{1,80}$/.test(id);
const arDate = v => {
  if (!v) return 'VACÍO';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23' }) + ' (hora AR)';
};

// Lista cerrada de llamadas permitidas. Cualquier otra se corta antes de salir a la red.
const ALLOWED = [
  ['GET', () => /^\/users\/me$/],
  ['POST', () => /^\/preapproval_plan$/],
  ['GET', () => (state.planId ? new RegExp(`^/preapproval_plan/${state.planId}$`) : /$^/)],
  ['GET', () => (state.planId ? new RegExp(`^/preapproval/search\\?preapproval_plan_id=${state.planId}(&|$)`) : /$^/)],
  ['GET', () => /^\/preapproval\/[A-Za-z0-9_-]+$/],
  ['PUT', () => /^\/preapproval\/[A-Za-z0-9_-]+$/],
  ['GET', () => /^\/authorized_payments\/[A-Za-z0-9_-]+$/],
  ['GET', () => /^\/authorized_payments\/search\?preapproval_id=[A-Za-z0-9_-]+$/],
  ['GET', () => /^\/v1\/payments\/[0-9]+$/],
];

async function mp(method, url, body) {
  if (!ALLOWED.some(([m, re]) => m === method && re().test(url))) throw new Error(`Llamada bloqueada por el candado: ${method}`);
  let res;
  try {
    res = await fetch(API + url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return { ok: false, status: 0, data: { message: hideToken(err.message) } };
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: hideToken(text).slice(0, 300) }; }
  return { ok: res.ok, status: res.status, data };
}
const mpError = r => `MP respondió ${r.status}: ${hideToken(r.data?.message || r.data?.error || 'sin detalle')}`;

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || !input.setRawMode) {
      reject(new Error('Esta terminal no permite ocultar lo que escribís. Usá la terminal de VS Code o PowerShell.'));
      return;
    }
    process.stdout.write(prompt);
    let value = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\u0003') { input.setRawMode(false); process.stdout.write('\n'); process.exit(1); }
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false);
          input.removeListener('data', onData);
          input.pause();
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.on('data', onData);
  });
}

async function checkAccount(ask) {
  const me = await mp('GET', '/users/me');
  if (!me.ok) throw new Error('MP no aceptó la credencial. ' + mpError(me));
  if (token.startsWith('TEST-') || (me.data.tags || []).includes('test_user')) throw new Error('Esta credencial es de prueba. Este script es para la de producción.');
  if (state.sellerId && String(state.sellerId) !== String(me.data.id)) throw new Error('Esta credencial es de otra cuenta que la que creó el plan. No se hizo nada.');
  out(`Cuenta: ${me.data.id}${me.data.nickname ? ` (${hideToken(me.data.nickname)})` : ''}`);
  const yes = (await ask('¿Es tu cuenta de TRABAJO? Escribí SI para seguir: ')).trim();
  if (yes !== 'SI') throw new Error('Cancelado. No se hizo nada.');
  state.sellerId = me.data.id;
}

// Verifica que el plan guardado siga siendo el de esta prueba. Si no, no se opera.
async function verifyPlan() {
  if (!state.planId) return;
  if (!validId(state.planId)) throw new Error('El id de plan guardado no es válido. No se hizo nada.');
  const r = await mp('GET', `/preapproval_plan/${state.planId}`);
  if (!r.ok) throw new Error('No se pudo verificar el plan. ' + mpError(r));
  const ar = r.data.auto_recurring || {};
  if (r.data.reason !== PLAN_NAME || Number(ar.transaction_amount) !== PLAN_AMOUNT) throw new Error('El plan guardado no es el plan de prueba técnica. No se hizo nada.');
  out(`Plan de prueba verificado: ${state.planId}`);
  out(`  monto $${ar.transaction_amount} | prueba ${ar.free_trial ? JSON.stringify(ar.free_trial) : 'NINGUNA'} | estado ${r.data.status}`);
}

// Solo las suscripciones que MP devuelve al filtrar por el plan de prueba.
async function planSubscriptions() {
  if (!state.planId) { out('Primero creá el plan (opción 1).'); return null; }
  const r = await mp('GET', `/preapproval/search?preapproval_plan_id=${state.planId}&limit=50`);
  if (!r.ok) { out(mpError(r)); return null; }
  return (r.data.results || []).filter(s => s.preapproval_plan_id === state.planId);
}
async function ownSubscription(id) {
  if (!validId(id)) { out('Id inválido. No se hizo nada.'); return null; }
  const list = await planSubscriptions();
  if (!list) return null;
  if (!list.some(s => s.id === id)) { out('Esa suscripción NO es del plan de prueba. No se hizo nada.'); return null; }
  const r = await mp('GET', `/preapproval/${id}`);
  if (!r.ok) { out(mpError(r)); return null; }
  if (r.data.preapproval_plan_id !== state.planId) { out('Esa suscripción NO es del plan de prueba. No se hizo nada.'); return null; }
  return r.data;
}

async function createPlan(ask) {
  if (state.planId) { out(`Ya existe el plan ${state.planId}. Este script no crea otro.`); return; }
  out(`Se va a crear: "${PLAN_NAME}", $${PLAN_AMOUNT} por mes, 1 día gratis.`);
  if ((await ask('Escribí CREAR para confirmar: ')).trim() !== 'CREAR') { out('No se creó nada.'); return; }
  const r = await mp('POST', '/preapproval_plan', {
    reason: PLAN_NAME,
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: PLAN_AMOUNT, currency_id: 'ARS', free_trial: PLAN_TRIAL },
    back_url: BACK_URL,
  });
  if (!r.ok) { out(mpError(r)); return; }
  if (!validId(String(r.data.id))) { out('MP devolvió un id inesperado. No se guardó.'); return; }
  state = { ...state, planId: r.data.id, initPoint: r.data.init_point, refs: {} };
  save();
  out(`Plan creado: ${r.data.id}`);
  out(`free_trial que devolvió MP: ${r.data.auto_recurring?.free_trial ? JSON.stringify(r.data.auto_recurring.free_trial) : 'NINGUNO'}`);
}

function showLink() {
  if (!state.initPoint) { out('Primero creá el plan (opción 1).'); return; }
  const n = Object.keys(state.refs).length + 1;
  const ref = `ETAPA1-${n}-${randomBytes(4).toString('hex')}`; // nunca un programa válido: process-payment lo ignora
  state.refs[ref] = n;
  save();
  const sep = state.initPoint.includes('?') ? '&' : '?';
  out(`\nReferencia de esta prueba: ${ref}`);
  out('Abrí este link en una ventana de incógnito y pagá con tu MP PERSONAL:\n');
  out(`${state.initPoint}${sep}external_reference=${ref}\n`);
}

function printSubscription(s) {
  const n = state.refs?.[s.external_reference];
  const ar = s.auto_recurring || {};
  const charged = s.summarized?.charged_quantity;
  out(`\nSuscripción ${s.id}`);
  out(`  estado:              ${s.status}`);
  out(`  creada:              ${arDate(s.date_created)}`);
  out(`  external_reference:  ${s.external_reference || 'VACÍO'}${n ? ` (coincide con el link ${n})` : ''}`);
  out(`  payer_email:         ${s.payer_email ? 'PRESENTE' : 'VACÍO'}`);
  out(`  payer_id:            ${s.payer_id || 'VACÍO'}`);
  out(`  ${charged ? 'próximo cobro:      ' : 'PRIMER COBRO:       '} ${arDate(s.next_payment_date)}`);
  out(`  free_trial:          ${ar.free_trial ? JSON.stringify(ar.free_trial) : 'VACÍO'}`);
  out(`  cobros hechos:       ${charged ?? 's/d'}`);
}

async function review() {
  const list = await planSubscriptions();
  if (!list) return;
  out(`\n[${arDate(new Date())}] Suscripciones del plan de prueba: ${list.length}`);
  for (const item of list) {
    const full = await mp('GET', `/preapproval/${item.id}`);
    printSubscription(full.ok && full.data.preapproval_plan_id === state.planId ? full.data : item);
  }
}

async function searchByEmail(ask) {
  if (!state.planId) { out('Primero creá el plan (opción 1).'); return; }
  const email = (await ask('Mail a buscar (no se guarda): ')).trim();
  const r = await mp('GET', `/preapproval/search?preapproval_plan_id=${state.planId}&payer_email=${encodeURIComponent(email)}&limit=50`);
  if (!r.ok) { out(mpError(r)); return; }
  const list = (r.data.results || []).filter(s => s.preapproval_plan_id === state.planId);
  out(`Encontradas con ese mail en el plan de prueba: ${list.length}`);
  list.forEach(s => out(`  ${s.id} (${s.status})`));
}

async function analyzeReturnUrl(ask) {
  const raw = (await ask('Pegá la dirección completa de la página de regreso: ')).trim();
  let url;
  try { url = new URL(raw); } catch { out('No parece una dirección válida.'); return; }
  const params = [...url.searchParams.keys()];
  out(`Datos que trajo: ${params.length ? params.join(', ') : 'NINGUNO'}`);
  const id = url.searchParams.get('preapproval_id');
  if (!id) { out('preapproval_id: NO vino.'); return; }
  out(`preapproval_id: ${id}`);
  const s = await ownSubscription(id);
  if (s) printSubscription(s);
}

function printInvoice(inv) {
  out(`\nCuota ${inv.id}`);
  out(`  suscripción:         ${inv.preapproval_id}`);
  out(`  estado de la cuota:  ${inv.status || 's/d'}`);
  out(`  monto:               ${inv.transaction_amount ?? 's/d'}`);
  out(`  fecha de cobro:      ${arDate(inv.debit_date)}`);
  out(`  reintento:           ${inv.retry_attempt ?? 's/d'}`);
  out(`  external_reference:  ${inv.external_reference || 'VACÍO'}`);
  out(`  id del pago:         ${inv.payment?.id || 'VACÍO'}`);
  out(`  estado del pago:     ${inv.payment?.status || 'VACÍO'}${inv.payment?.status_detail ? ` (${inv.payment.status_detail})` : ''}`);
}
async function printPayment(inv) {
  if (!inv.payment?.id) return;
  const p = await mp('GET', `/v1/payments/${inv.payment.id}`);
  if (!p.ok) { out('  ' + mpError(p)); return; }
  out(`  pago: bruto ${p.data.transaction_amount ?? 's/d'} | neto ${p.data.transaction_details?.net_received_amount ?? 's/d'} | aprobado ${arDate(p.data.date_approved)}`);
  out(`  pago: mail del pagador ${p.data.payer?.email ? 'PRESENTE' : 'VACÍO'} | external_reference ${p.data.external_reference || 'VACÍO'} | devuelto ${p.data.transaction_amount_refunded ?? 0}`);
}

async function charges(ask) {
  const list = await planSubscriptions();
  if (!list) return;
  let found = 0;
  for (const s of list) {
    // Búsqueda por suscripción: no está documentada; si MP no la acepta, sirve el id de cuota de los logs.
    const r = await mp('GET', `/authorized_payments/search?preapproval_id=${s.id}`);
    for (const inv of (r.ok ? r.data.results || [] : []).filter(i => String(i.preapproval_id) === String(s.id))) {
      found++;
      printInvoice(inv);
      await printPayment(inv);
    }
  }
  if (found) return;
  out('MP no listó cuotas. Podés buscar el id en los logs de process-payment (aviso subscription_authorized_payment).');
  const id = (await ask('Id de la cuota (Enter para volver): ')).trim();
  if (!id) return;
  if (!validId(id)) { out('Id inválido. No se hizo nada.'); return; }
  const inv = await mp('GET', `/authorized_payments/${id}`);
  if (!inv.ok) { out(mpError(inv)); return; }
  if (!list.some(s => String(s.id) === String(inv.data.preapproval_id))) { out('Esa cuota NO es del plan de prueba. No se muestra nada.'); return; }
  printInvoice(inv.data);
  await printPayment(inv.data);
}

async function cancelSubscription(ask) {
  const id = (await ask('Id de la suscripción a cancelar: ')).trim();
  const before = await ownSubscription(id);
  if (!before) return;
  out('\nANTES de cancelar:'); printSubscription(before);
  if ((await ask('\nEscribí CANCELAR para confirmar: ')).trim() !== 'CANCELAR') { out('No se canceló.'); return; }
  const put = await mp('PUT', `/preapproval/${id}`, { status: 'cancelled' });
  if (!put.ok) { out(mpError(put)); return; }
  const after = await mp('GET', `/preapproval/${id}`);
  out('\nDESPUÉS de cancelar:'); printSubscription(after.ok ? after.data : put.data);
}

const MENU = `
=== Etapa 1: PRODUCCIÓN, plan de prueba técnica ===
1. Crear el plan de prueba      Crea el único plan permitido ($${PLAN_AMOUNT}/mes, 1 día gratis). Pide confirmación. No cobra.
2. Generar link                 Solo muestra un link con una referencia nueva. No cobra.
3. Ver suscripciones            Lista las del plan: estado, referencia, mail, FECHA DEL PRIMER COBRO. Solo lee.
4. Buscar por mail              Busca un mail dentro del plan. Solo lee. El mail no se guarda.
5. Analizar dirección regreso   Muestra qué datos trajo la página de regreso. Solo lee.
6. Ver cobros                   Cuotas y pagos del plan: estado, bruto, neto, mail, devoluciones. Solo lee.
7. Cancelar una suscripción     Frena los cobros de una suscripción DEL PLAN. Pide confirmación. No se puede deshacer.
0. Salir
Este script no devuelve pagos: eso se hace desde el panel de MP.`;

async function main() {
  out('Pegá el Access Token de PRODUCCIÓN de tu cuenta de trabajo y tocá Enter. No se va a ver nada al pegarlo.');
  token = await askHidden('Credencial: ');
  if (!token) throw new Error('No ingresaste ninguna credencial.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => rl.question(q);
  await checkAccount(ask);
  await verifyPlan();
  save();
  for (;;) {
    out(MENU);
    const option = (await ask('Opción: ')).trim();
    if (option === '0') break;
    if (option === '1') await createPlan(ask);
    else if (option === '2') showLink();
    else if (option === '3') await review();
    else if (option === '4') await searchByEmail(ask);
    else if (option === '5') await analyzeReturnUrl(ask);
    else if (option === '6') await charges(ask);
    else if (option === '7') await cancelSubscription(ask);
    else out('Opción inválida.');
  }
  rl.close();
}

main().catch(err => { console.error('\nError: ' + hideToken(err.message)); process.exit(1); });
