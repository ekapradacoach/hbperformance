// ============================================================================
// Simulación de mp-plan-prueba.mjs (etapa 9: un plan de prueba por programa).
// Levanta un MP y un Supabase falsos en localhost, corre el script real con HB_PLAN_SIM=1 y le contesta las
// preguntas. No usa la red ni credenciales. Correr desde la raíz del repo:
//   node supabase/tests/mp-plan-prueba.sim.mjs
// ============================================================================
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = process.argv[2] || path.join(here, 'mp-plan-prueba.mjs');
const BACK = 'https://hbperformance.fit/prueba-regreso.html';
const paidPlan = amount => ({ reason: 'pago', auto_recurring: { transaction_amount: amount, currency_id: 'ARS', frequency: 1, frequency_type: 'months' }, status: 'active' });

let world;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    world.calls.push(req.method + ' ' + u.pathname);
    if (u.pathname === '/rest/v1/site_config') {
      const keys = (u.searchParams.get('key') || '').replace(/^in\.\(|\)$/g, '').split(',');
      return send(200, world.config.filter(r => keys.includes(r.key)));
    }
    if (u.pathname === '/users/me') return send(200, { id: 123456, tags: [] });
    if (req.method === 'POST' && u.pathname === '/preapproval_plan') {
      const b = JSON.parse(body);
      world.created.push(b);
      const id = 'nuevo' + world.created.length;
      world.plans[id] = { ...b, status: 'active' };
      return send(201, { id, ...b });
    }
    const m = u.pathname.match(/^\/preapproval_plan\/(.+)$/);
    if (m && world.plans[m[1]]) return send(200, world.plans[m[1]]);
    send(404, { message: 'not found' });
  });
});

// Corre el script contestando cada pregunta (las que terminan en ": ") con la próxima respuesta.
function run(answers, env) {
  return new Promise(resolve => {
    const c = spawn(process.execPath, [script], { env: { ...process.env, ...env } });
    let out = '', i = 0;
    c.stdout.on('data', d => {
      out += d;
      if (/: $/.test(String(d)) && i < answers.length) c.stdin.write(answers[i++] + '\n');
    });
    c.stderr.on('data', d => out += d);
    // Si el script se queda esperando una respuesta que no está en la lista, se corta: cuenta como falla.
    const timer = setTimeout(() => { out += '\n[cortado: se quedó esperando]'; c.kill(); }, 15000);
    c.on('close', code => { clearTimeout(timer); resolve({ out, code }); });
  });
}

const tmp = mkdtempSync(path.join(tmpdir(), 'plan-sim-'));
const statePath = path.join(tmp, 'estado.json');
const cfg = (extra = []) => [
  { key: 'price_crossfit_ars', value: '45000' }, { key: 'mp_plan_crossfit', value: 'pago-c' }, { key: 'mp_trial_plan_crossfit', value: 'viejo-c' },
  { key: 'price_hybrid_ars', value: '45000' }, { key: 'mp_plan_hybrid', value: 'pago-h' },
  { key: 'price_corredores_ars', value: '40000' }, { key: 'mp_plan_corredores', value: 'https://x/checkout?preapproval_plan_id=pago-r' },
  ...extra,
];
const basePlans = () => ({ 'pago-c': paidPlan(45000), 'pago-h': paidPlan(45000), 'pago-r': paidPlan(40000),
  'viejo-c': { reason: 'HB Performance - CrossFit - 7 días gratis', auto_recurring: { transaction_amount: 45000, currency_id: 'ARS', frequency: 1, frequency_type: 'months', free_trial: { frequency: 7, frequency_type: 'days' } }, back_url: BACK, status: 'active' } });

const cases = [
  { name: 'Hybrid: crea el plan con nombre, precio, 7 días y regreso, y lo guarda aparte',
    state: { sellerId: 123456, planId: 'viejo-c', price: 45000 }, answers: ['SI', 'hybrid', '1', 'CREAR', '0'],
    check: (w, st, r) => w.created.length === 1 && w.created[0].reason === 'HB Performance - Hybrid - 7 días gratis' && w.created[0].auto_recurring.transaction_amount === 45000
      && w.created[0].auto_recurring.free_trial.frequency === 7 && w.created[0].auto_recurring.free_trial.frequency_type === 'days' && w.created[0].back_url === BACK
      && st.plans.hybrid.planId === 'nuevo1' && st.plans.crossfit.planId === 'viejo-c' && /mp_trial_plan_hybrid/.test(r.out) },
  { name: 'Corredores: precio $40.000 del plan pago y de site_config',
    answers: ['SI', 'corredores', '1', 'CREAR', '0'],
    check: (w, st) => w.created.length === 1 && w.created[0].reason === 'HB Performance - Fuerza para Corredores - 7 días gratis' && w.created[0].auto_recurring.transaction_amount === 40000 && st.plans.corredores.planId === 'nuevo1' },
  { name: 'Precio distinto entre site_config y el plan pago: no crea nada',
    config: cfg().map(r => (r.key === 'price_hybrid_ars' ? { ...r, value: '50000' } : r)), answers: ['SI', 'hybrid', '1', 'CREAR', '0'],
    check: (w, st, r) => w.created.length === 0 && /no coinciden/.test(r.out) },
  { name: 'Sin plan pago del programa en site_config: no crea nada',
    config: cfg().filter(r => r.key !== 'mp_plan_hybrid'), answers: ['SI', 'hybrid', '1', 'CREAR', '0'],
    check: (w, st, r) => w.created.length === 0 && /no tiene el plan pago de Hybrid/.test(r.out) },
  { name: 'site_config ya tiene el plan de prueba de Hybrid: no crea otro',
    config: cfg([{ key: 'mp_trial_plan_hybrid', value: 'ya-h' }]), answers: ['SI', 'hybrid', '1', 'CREAR', '0'],
    check: (w, st, r) => w.created.length === 0 && /ya tiene plan de prueba de Hybrid/.test(r.out) },
  { name: 'Estado viejo de CrossFit: no crea otro plan de CrossFit',
    state: { sellerId: 123456, planId: 'viejo-c', price: 45000 }, answers: ['SI', 'crossfit', '1', '0'],
    check: (w, st, r) => w.created.length === 0 && /ya creó el plan de CrossFit/.test(r.out) && st.plans.crossfit.planId === 'viejo-c' },
  { name: 'Sin escribir CREAR: no crea nada', answers: ['SI', 'hybrid', '1', 'no', '0'], check: w => w.created.length === 0 },
  { name: 'Programa inválido: corta sin tocar MP más allá de la cuenta', answers: ['SI', 'yoga'],
    check: (w, st, r) => w.created.length === 0 && r.code !== 0 && /Programa inválido/.test(r.out) && !w.calls.some(c => c.includes('preapproval_plan')) },
  { name: 'Otra cuenta de MP que la del estado: no hace nada',
    state: { sellerId: 999, plans: {} }, answers: ['SI', 'hybrid'], check: (w, st, r) => r.code !== 0 && /otra cuenta/.test(r.out) && w.created.length === 0 },
  { name: 'Verificar el plan de CrossFit existente: 7 líneas OK',
    answers: ['SI', 'crossfit', '2', '0'], check: (w, st, r) => (r.out.match(/OK {4}/g) || []).length === 7 && !/REVISAR/.test(r.out) },
  { name: 'Verificar un plan de Corredores con 1 día: marca la prueba para revisar',
    config: cfg([{ key: 'mp_trial_plan_corredores', value: 'r1' }]),
    plans: { r1: { reason: 'HB Performance - Fuerza para Corredores - 7 días gratis', auto_recurring: { transaction_amount: 40000, currency_id: 'ARS', frequency: 1, frequency_type: 'months', free_trial: { frequency: 1, frequency_type: 'days' } }, back_url: BACK, status: 'active' } },
    answers: ['SI', 'corredores', '2', '0'], check: (w, st, r) => /REVISAR Prueba de 7 días/.test(r.out) && (r.out.match(/OK {4}/g) || []).length === 6 },
];

const log = console.log;
let failed = 0;
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  for (const c of cases) {
    world = { config: c.config || cfg(), plans: { ...basePlans(), ...(c.plans || {}) }, created: [], calls: [] };
    if (c.state) writeFileSync(statePath, JSON.stringify(c.state)); else if (existsSync(statePath)) rmSync(statePath);
    const r = await run(c.answers, { HB_PLAN_SIM: '1', HB_SIM_MP: base, HB_SIM_SB: base, HB_SIM_STATE: statePath });
    const st = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
    let ok = false;
    try { ok = !!c.check(world, st, r); } catch (_) {}
    if (!ok) { failed++; log(`FALLA  ${c.name}\n${r.out.split('\n').map(l => '         ' + l).join('\n')}`); }
    else log(`ok     ${c.name}`);
  }
  log(`\n${cases.length - failed} de ${cases.length} casos OK`);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
