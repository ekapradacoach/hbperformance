// ============================================================================
// Fase 2, etapa 5b: ¿cómo se ve en MP una suscripción del plan de prueba con prueba y sin prueba?
// SOLO LECTURA contra PRODUCCIÓN de MP. No toca Supabase. No crea, cancela ni devuelve nada.
//
// Correr desde la raíz del repo, en una terminal de VS Code o PowerShell:
//   node supabase/tests/mp-etapa5b.mjs
//
// Responde, con las suscripciones del plan de prueba de CrossFit (incluidas las canceladas):
//  1. Plazo entre la creación y el próximo cobro: ¿~7 días con prueba y ~1 mes sin prueba?
//  2. ¿La suscripción trae free_trial en los dos casos? (si sí, no sirve para distinguir)
//  3. ¿/authorized_payments/search?preapproval_id= lista el primer cobro? No está documentado.
//  4. Estado, monto y devolución del cobro en /v1/payments.
//
// Candados: la credencial se pide sin mostrarse y queda solo en memoria; solo salen llamadas GET de ALLOWED;
// no se imprimen mails, ids completos ni payer_id (solo los últimos 4 caracteres de cada id); no guarda archivos.
// ============================================================================
import readline from 'node:readline/promises';

const SIM_API = process.env.HB_MP_SIM_API || ''; // solo para la simulación local
const API = SIM_API || 'https://api.mercadopago.com';
const PLAN_NAME = 'HB Performance - CrossFit - 7 días gratis';
const out = console.log;

let token = '';
let planId = '';
const hideToken = s => (token ? String(s).split(token).join('[credencial oculta]') : String(s));
const short = v => (v ? '…' + String(v).slice(-4) : 'VACÍO');
const DAY = 24 * 3600 * 1000;
const arDate = v => {
  if (!v) return 'VACÍO';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23' });
};

const ALLOWED = [
  () => /^\/users\/me$/,
  () => new RegExp(`^/preapproval_plan/${planId}$`),
  () => new RegExp(`^/preapproval/search\\?preapproval_plan_id=${planId}&limit=50&offset=[0-9]+$`),
  () => /^\/authorized_payments\/search\?preapproval_id=[A-Za-z0-9_-]+$/,
  () => /^\/v1\/payments\/[0-9]+$/,
];

async function mp(url) {
  if (!ALLOWED.some(re => re().test(url))) throw new Error('Llamada bloqueada por el candado.');
  let res;
  try {
    res = await fetch(API + url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    return { ok: false, status: 0, data: { message: hideToken(err.message) } };
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: hideToken(text).slice(0, 200) }; }
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

function classify(gapDays) {
  if (gapDays == null) return 'SIN DATO';
  if (gapDays <= 10) return 'CON PRUEBA';
  if (gapDays >= 20) return 'SIN PRUEBA';
  return 'DUDOSO';
}

async function main() {
  if (SIM_API) {
    token = 'sim';
  } else {
    out('Pegá el Access Token de PRODUCCIÓN de tu cuenta de trabajo y tocá Enter. No se va a ver nada al pegarlo.');
    token = await askHidden('Credencial: ');
    if (!token) throw new Error('No ingresaste ninguna credencial.');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => rl.question(q);

  const me = await mp('/users/me');
  if (!me.ok) throw new Error('MP no aceptó la credencial. ' + mpError(me));
  if (token.startsWith('TEST-') || (me.data.tags || []).includes('test_user')) throw new Error('Esta credencial es de prueba. Este script es para la de producción.');
  out(`Cuenta: ${short(me.data.id)}`);
  if (!SIM_API && (await ask('¿Es tu cuenta de TRABAJO? Escribí SI para seguir: ')).trim() !== 'SI') throw new Error('Cancelado. No se hizo nada.');

  // El plan de prueba: id o dirección del checkout (la de site_config.mp_trial_plan_crossfit).
  const raw = SIM_API ? 'plan-t' : (await ask('Pegá el valor de mp_trial_plan_crossfit (id o dirección del checkout): ')).trim();
  rl.close();
  const m = raw.match(/preapproval_plan_id=([A-Za-z0-9_-]+)/);
  planId = m ? m[1] : raw;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(planId)) throw new Error('Eso no parece un id de plan. No se hizo nada.');

  const plan = await mp(`/preapproval_plan/${planId}`);
  if (!plan.ok) throw new Error('No se pudo leer el plan. ' + mpError(plan));
  const par = plan.data.auto_recurring || {};
  if (plan.data.reason !== PLAN_NAME) throw new Error(`El plan no es "${PLAN_NAME}". No se hizo nada.`);
  out(`Plan OK: $${par.transaction_amount} ${par.currency_id} | prueba ${par.free_trial ? JSON.stringify(par.free_trial) : 'NINGUNA'}`);

  // Todas las suscripciones del plan (MP pagina de a 50).
  const subs = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const r = await mp(`/preapproval/search?preapproval_plan_id=${planId}&limit=50&offset=${offset}`);
    if (!r.ok) throw new Error('No se pudo listar las suscripciones. ' + mpError(r));
    const page = (r.data.results || []).filter(s => String(s.preapproval_plan_id) === planId);
    subs.push(...page);
    if ((r.data.results || []).length < 50) break;
  }
  subs.sort((a, b) => Date.parse(a.date_created) - Date.parse(b.date_created));
  out(`\nSuscripciones del plan: ${subs.length}`);

  const summary = { conPrueba: 0, sinPrueba: 0, otras: 0, busquedaOk: 0, busquedaFalla: 0, cobrosVistos: 0 };
  let n = 0;
  for (const s of subs) {
    n++;
    const created = Date.parse(s.date_created);
    const next = Date.parse(s.next_payment_date);
    const gap = !isNaN(created) && !isNaN(next) ? (next - created) / DAY : null;
    const kind = classify(gap);
    if (kind === 'CON PRUEBA') summary.conPrueba++; else if (kind === 'SIN PRUEBA') summary.sinPrueba++; else summary.otras++;
    const sar = s.auto_recurring || {};
    out(`\n#${n} suscripción ${short(s.id)} | estado ${s.status}`);
    out(`  creada ${arDate(s.date_created)} | próximo cobro ${arDate(s.next_payment_date)} | plazo ${gap == null ? 's/d' : gap.toFixed(1) + ' días'} → ${kind}`);
    out(`  free_trial en la suscripción: ${sar.free_trial ? JSON.stringify(sar.free_trial) : 'NO'} | monto $${sar.transaction_amount ?? 's/d'} | payer_id ${s.payer_id ? 'PRESENTE' : 'VACÍO'}`);
    if (s.summarized) out(`  summarized: cuotas cobradas ${s.summarized.charged_quantity ?? 's/d'} | monto cobrado ${s.summarized.charged_amount ?? 's/d'} | última fecha ${arDate(s.summarized.last_charged_date)}`);

    const r = await mp(`/authorized_payments/search?preapproval_id=${s.id}`);
    if (!r.ok) { summary.busquedaFalla++; out(`  búsqueda de cuotas: FALLA (${mpError(r)})`); continue; }
    summary.busquedaOk++;
    const invoices = (r.data.results || []).filter(i => String(i.preapproval_id) === String(s.id));
    out(`  búsqueda de cuotas: OK, ${invoices.length} cuota(s)${(r.data.results || []).length !== invoices.length ? ` (MP devolvió ${(r.data.results || []).length}, algunas de otra suscripción)` : ''}`);
    for (const inv of invoices) {
      summary.cobrosVistos++;
      out(`   · cuota ${short(inv.id)} | estado ${inv.status} | monto $${inv.transaction_amount ?? 's/d'} | creada ${arDate(inv.date_created)} | cobro ${arDate(inv.debit_date)} | pago ${inv.payment?.id ? short(inv.payment.id) + ' ' + (inv.payment.status || '') : 'SIN PAGO'}`);
      if (inv.payment?.id && /^[0-9]+$/.test(String(inv.payment.id))) {
        const p = await mp(`/v1/payments/${inv.payment.id}`);
        if (p.ok) out(`     pago: ${p.data.status} | bruto $${p.data.transaction_amount ?? 's/d'} | neto $${p.data.transaction_details?.net_received_amount ?? 's/d'} | aprobado ${arDate(p.data.date_approved)} | devuelto $${p.data.transaction_amount_refunded ?? 0}`);
        else out(`     pago: no se pudo leer (${mpError(p)})`);
      }
    }
  }

  out('\n=== Resumen para pasarle a Claude ===');
  out(`Suscripciones: ${subs.length} | con prueba ${summary.conPrueba} | sin prueba ${summary.sinPrueba} | otras ${summary.otras}`);
  out(`Búsqueda de cuotas: OK ${summary.busquedaOk} | FALLA ${summary.busquedaFalla} | cuotas vistas ${summary.cobrosVistos}`);
}

main().catch(err => { console.error('\nError: ' + hideToken(err.message)); process.exit(1); });
