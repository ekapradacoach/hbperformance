// ============================================================================
// Fase 2, etapas 3 y 9: crea el plan de prueba de un programa (CrossFit, Hybrid o Fuerza para Corredores) en
// PRODUCCIÓN de MP y lo verifica. Al empezar pide el programa.
// Crear un plan no cobra. Nadie puede suscribirse hasta tener el link, y este script no lo publica.
//
// Correr desde la raíz del repo, en una terminal de VS Code o PowerShell:
//   node supabase/tests/mp-plan-prueba.mjs
//
// Candados:
//  · La credencial se pide al iniciar, no se ve y queda solo en memoria.
//  · Solo crea UN plan por programa, con nombre, prueba y dirección de regreso fijos. El precio tiene que coincidir con
//    site_config (price_<programa>_ars) y con el plan pago del programa (mp_plan_<programa>); si no, no crea nada.
//  · Si site_config ya tiene el plan de prueba de ese programa o el script ya creó uno, no crea otro.
//  · Todo pasa por mp(), que solo deja salir las llamadas de ALLOWED. No modifica planes ni toca suscripciones.
//  · No escribe en Supabase: al plan pago y a site_config solo los lee.
// En tu carpeta de usuario se guarda .hb-mp-plan-prueba.json (sin secretos): cuenta y un plan por programa.
// (El formato viejo, con el plan de CrossFit suelto, se sigue leyendo igual.)
// ============================================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

// Solo para la simulación local (supabase/tests/mp-plan-prueba.sim.mjs): MP y Supabase simulados, sin credencial real.
const SIM = process.env.HB_PLAN_SIM === '1';
const API = SIM ? process.env.HB_SIM_MP : 'https://api.mercadopago.com';
const STATE_FILE = path.join(homedir(), '.hb-mp-plan-prueba.json');
const SUPABASE_URL = SIM ? process.env.HB_SIM_SB : 'https://frjlafrgdcbomdnentbe.supabase.co';
const SUPABASE_KEY = 'sb_publishable_fx4VccMrxdC3j8ObKnxX7A_GSNoai80'; // pública: la usan las landings
const PROGRAMS = { crossfit: 'CrossFit', hybrid: 'Hybrid', corredores: 'Fuerza para Corredores' };
const TRIAL_DAYS = 7;
let PROGRAM = '';
let PLAN_NAME = '';
const BACK_URL = 'https://hbperformance.fit/prueba-regreso.html';
const out = console.log;

let token = '';
const STATE_PATH = SIM ? process.env.HB_SIM_STATE : STATE_FILE;
let state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : {};
// Formato viejo: { sellerId, planId, price } era el plan de CrossFit.
if (!state.plans) state = { sellerId: state.sellerId, plans: state.planId ? { crossfit: { planId: state.planId, price: state.price } } : {} };
const plan = () => (PROGRAM ? (state.plans[PROGRAM] || (state.plans[PROGRAM] = {})) : {});
const save = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
const hideToken = s => (token ? String(s).split(token).join('[credencial oculta]') : String(s));
const validId = id => /^[A-Za-z0-9_-]{1,80}$/.test(id);
// En site_config el plan puede estar como id o como dirección del checkout.
const planIdOf = v => {
  const value = String(v || '').trim();
  const m = value.match(/preapproval_plan_id=([A-Za-z0-9_-]+)/);
  return m ? m[1] : (validId(value) ? value : null);
};

let paidPlanId = null;

// Lista cerrada de llamadas permitidas. Cualquier otra se corta antes de salir a la red.
const ALLOWED = [
  ['GET', () => /^\/users\/me$/],
  ['POST', () => /^\/preapproval_plan$/],
  ['GET', () => (paidPlanId ? new RegExp(`^/preapproval_plan/${paidPlanId}$`) : /$^/)],
  ['GET', () => (plan().planId ? new RegExp(`^/preapproval_plan/${plan().planId}$`) : /$^/)],
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

async function readConfig() {
  const keys = [`price_${PROGRAM}_ars`, `mp_plan_${PROGRAM}`, `mp_trial_plan_${PROGRAM}`];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/site_config?select=key,value&key=in.(${keys.join(',')})`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`No se pudo leer site_config (${res.status}). No se hizo nada.`);
  const rows = await res.json();
  const get = k => rows.find(r => r.key === k)?.value;
  return { price: Number(get(keys[0])), paidPlan: planIdOf(get(keys[1])), trialPlan: planIdOf(get(keys[2])) };
}

// El precio tiene que ser el mismo en site_config y en el plan pago, para que la prueba no cobre otro monto.
async function checkedPrice(config) {
  if (!Number.isFinite(config.price) || config.price <= 0) throw new Error('site_config no tiene un precio válido. No se hizo nada.');
  if (!config.paidPlan) throw new Error(`site_config no tiene el plan pago de ${PROGRAMS[PROGRAM]}. No se hizo nada.`);
  paidPlanId = config.paidPlan;
  const r = await mp('GET', `/preapproval_plan/${paidPlanId}`);
  if (!r.ok) throw new Error('No se pudo leer el plan pago. ' + mpError(r));
  const ar = r.data.auto_recurring || {};
  out(`Plan pago de ${PROGRAMS[PROGRAM]}: $${ar.transaction_amount} ${ar.currency_id}, cada ${ar.frequency} ${ar.frequency_type} | prueba ${ar.free_trial ? JSON.stringify(ar.free_trial) : 'NINGUNA'}`);
  out(`Precio en site_config: $${config.price}`);
  if (Number(ar.transaction_amount) !== config.price || ar.currency_id !== 'ARS' || Number(ar.frequency) !== 1 || ar.frequency_type !== 'months') {
    throw new Error('El plan pago y site_config no coinciden. No se creó nada: revisalos primero.');
  }
  return config.price;
}

async function createPlan(ask) {
  if (plan().planId) { out(`Este script ya creó el plan de ${PROGRAMS[PROGRAM]}: ${plan().planId}. No crea otro.`); return; }
  const config = await readConfig();
  if (config.trialPlan) { out(`site_config ya tiene plan de prueba de ${PROGRAMS[PROGRAM]}: ${config.trialPlan}. No se crea otro.`); return; }
  const price = await checkedPrice(config);
  out(`\nSe va a crear: "${PLAN_NAME}", $${price} por mes, ${TRIAL_DAYS} días gratis.`);
  out(`Regreso: ${BACK_URL}`);
  if ((await ask('Escribí CREAR para confirmar: ')).trim() !== 'CREAR') { out('No se creó nada.'); return; }
  const r = await mp('POST', '/preapproval_plan', {
    reason: PLAN_NAME,
    auto_recurring: {
      frequency: 1, frequency_type: 'months', transaction_amount: price, currency_id: 'ARS',
      free_trial: { frequency: TRIAL_DAYS, frequency_type: 'days' },
    },
    back_url: BACK_URL,
  });
  if (!r.ok) { out(mpError(r)); return; }
  if (!validId(String(r.data.id))) { out('MP devolvió un id inesperado. No se guardó.'); return; }
  state.plans[PROGRAM] = { planId: r.data.id, price };
  save();
  out(`\nPlan creado: ${r.data.id}`);
  out(`Todavía no compartas el link. Cargá el id en site_config, clave mp_trial_plan_${PROGRAM}.`);
  await verify();
}

async function verify() {
  if (!plan().planId) {
    const config = await readConfig();
    if (!config.trialPlan) { out(`Todavía no hay plan de prueba de ${PROGRAMS[PROGRAM]}. Usá la opción 1.`); return; }
    plan().planId = config.trialPlan;
  }
  if (!validId(plan().planId)) throw new Error('El id de plan guardado no es válido. No se hizo nada.');
  const config = await readConfig();
  const r = await mp('GET', `/preapproval_plan/${plan().planId}`);
  if (!r.ok) { out(mpError(r)); return; }
  const ar = r.data.auto_recurring || {}, trial = ar.free_trial;
  const days = trial?.frequency_type === 'days' ? Number(trial.frequency) : null;
  const checks = [
    ['Nombre', r.data.reason === PLAN_NAME, r.data.reason],
    ['Precio igual a site_config', Number(ar.transaction_amount) === config.price, `$${ar.transaction_amount} (site_config: $${config.price})`],
    ['Moneda y frecuencia', ar.currency_id === 'ARS' && Number(ar.frequency) === 1 && ar.frequency_type === 'months', `${ar.currency_id}, cada ${ar.frequency} ${ar.frequency_type}`],
    [`Prueba de ${TRIAL_DAYS} días`, days === TRIAL_DAYS, trial ? JSON.stringify(trial) : 'NINGUNA'],
    ['Dirección de regreso', r.data.back_url === BACK_URL, r.data.back_url || 'VACÍA'],
    ['Estado activo', r.data.status === 'active', r.data.status],
    ['Plan en site_config', config.trialPlan === plan().planId, config.trialPlan || 'todavía no cargado'],
  ];
  out(`\nPlan de ${PROGRAMS[PROGRAM]}: ${plan().planId}`);
  checks.forEach(([name, ok, value]) => out(`  ${ok ? 'OK    ' : 'REVISAR'} ${name}: ${hideToken(value)}`));
  save();
}

const MENU = () => `
=== Plan de prueba de ${PROGRAMS[PROGRAM]} (PRODUCCIÓN) ===
1. Crear el plan     Crea el único plan permitido, con el precio verificado. Pide confirmación. No cobra.
2. Verificar         Revisa nombre, precio, días, regreso y estado. Sirve después de editar el plan en el panel. Solo lee.
0. Salir`;

async function main() {
  out('Pegá el Access Token de PRODUCCIÓN de tu cuenta de trabajo y tocá Enter. No se va a ver nada al pegarlo.');
  token = SIM ? 'credencial-simulada' : await askHidden('Credencial: ');
  if (!token) throw new Error('No ingresaste ninguna credencial.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => rl.question(q);
  await checkAccount(ask);
  const chosen = (await ask('Programa (crossfit / hybrid / corredores): ')).trim().toLowerCase();
  if (!Object.hasOwn(PROGRAMS, chosen)) throw new Error('Programa inválido. No se hizo nada.');
  PROGRAM = chosen;
  PLAN_NAME = `HB Performance - ${PROGRAMS[PROGRAM]} - ${TRIAL_DAYS} días gratis`;
  save();
  for (;;) {
    out(MENU());
    const option = (await ask('Opción: ')).trim();
    if (option === '0') break;
    if (option === '1') await createPlan(ask);
    else if (option === '2') await verify();
    else out('Opción inválida.');
  }
  rl.close();
}

main().catch(err => { console.error('\nError: ' + hideToken(err.message)); process.exit(1); });
