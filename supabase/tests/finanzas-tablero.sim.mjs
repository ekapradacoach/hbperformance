// Simulación de los cálculos del tablero de Finanzas (finanzas etapa 3).
// Toma del admin real el bloque entre "FIN-CALC-START" y "FIN-CALC-END" y lo corre con datos inventados,
// calculados a mano. Sin red ni base. Uso: node supabase/tests/finanzas-tablero.sim.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(process.env.FIN_ADMIN_HTML || path.join(ROOT, 'admin', 'index.html'), 'utf8');
const a = html.indexOf('// ==== FIN-CALC-START'), b = html.indexOf('// ==== FIN-CALC-END');
if (a < 0 || b < 0) { console.log('FALLA: no encontré el bloque FIN-CALC en admin/index.html'); process.exit(1); }
const F = new Function(html.slice(a, b) + '\nreturn { finDashboard, finMonth, finPrepare, finDelta, finCohorts, finRent };')();

let ok = 0, bad = 0;
const near = (x, y) => (x == null || y == null) ? x === y : Math.abs(x - y) < 1e-6;
const check = (name, got, exp) => {
  const pass = (typeof exp === 'number' || exp === null) ? near(got, exp) : JSON.stringify(got) === JSON.stringify(exp);
  if (pass) { ok++; console.log('ok    ', name); } else { bad++; console.log('FALLA ', name, '→ dio', JSON.stringify(got), 'esperaba', JSON.stringify(exp)); }
};

// ---------------- Datos ----------------
const ev = (athlete_id, program, kind, event_date, access_until = null, voided = false) => ({ athlete_id, program, kind, event_date, access_until, voided });
const pay = (id, athlete_id, program, amount, net_amount, paid_at, method) => ({ id, athlete_id, program, amount, net_amount, paid_at, method });
const input = {
  today: '2026-11-15',
  prices: { price_crossfit_ars: '45000', price_hybrid_ars: '50000', price_corredores_ars: '40000' },
  athletes: [
    { id: 'A', program: 'crossfit' },
    { id: 'B', program: 'hybrid' },
    { id: 'C', program: 'corredores', trial_status: 'converted', trial_started_at: '2026-10-25T15:00:00Z' },
    { id: 'D', program: 'crossfit', custom_price: 40000 },
    { id: 'E', program: 'asesoria-erika' },
    { id: 'F', program: 'crossfit' },
    { id: 'G', program: 'hybrid', trial_status: 'cancelled', trial_started_at: '2026-11-03T15:00:00Z' },
    { id: 'H', program: 'crossfit', trial_status: 'in_trial', trial_started_at: '2026-11-08T15:00:00Z' },
    // prueba que empezó el 1/11 a las 01:00 UTC = 31/10 en Argentina → cuenta en octubre
    { id: 'I', program: 'crossfit', trial_status: 'charge_rejected', trial_started_at: '2026-11-01T01:00:00Z' },
  ],
  events: [
    ev('A', 'crossfit', 'alta', '2026-09-05'),
    ev('A', 'crossfit', 'baja', '2026-10-01', '2026-10-15', true),        // baja anulada: no cuenta
    ev('B', 'hybrid', 'alta', '2026-09-20'),
    ev('B', 'hybrid', 'baja', '2026-10-20', '2026-10-31'),
    ev('C', 'corredores', 'prueba_inicio', '2026-10-25'),
    ev('C', 'corredores', 'prueba_convertida', '2026-11-01'),
    ev('D', 'crossfit', 'alta', '2026-10-10'),
    ev('E', 'asesoria-erika', 'alta', '2026-09-01'),
    ev('F', 'crossfit', 'alta', '2026-09-01'),
    ev('F', 'crossfit', 'baja', '2026-11-01', '2026-11-10'),
    ev('F', 'crossfit', 'reactivacion', '2026-11-12'),
    ev('G', 'hybrid', 'prueba_inicio', '2026-11-03'),
    ev('G', 'hybrid', 'prueba_cancelada', '2026-11-05', '2026-11-10'),     // prueba que no siguió: no es baja
    ev('H', 'crossfit', 'prueba_inicio', '2026-11-08'),
    ev(null, 'crossfit', 'alta', '2026-10-05'),                           // alumno eliminado
    ev(null, 'crossfit', 'baja', '2026-10-25', '2026-11-05'),
  ],
  payments: [
    pay(1, 'A', 'crossfit', 45000, 41000, '2026-10-05', 'mp'),
    pay(2, 'B', 'hybrid', 50000, 46000, '2026-10-20', 'mp'),
    pay(3, 'D', 'crossfit', 40000, 40000, '2026-10-10', 'manual'),
    pay(4, null, 'crossfit', 45000, 41500, '2026-10-05', 'mp'),            // alumno eliminado
    pay(5, 'A', 'crossfit', 45000, 41000, '2026-11-05', 'mp'),
    pay(6, 'C', 'corredores', 40000, 37000, '2026-11-01', 'mp'),
    pay(7, 'D', 'crossfit', 40000, null, '2026-11-10', 'manual'),          // sin neto → cuenta el monto
    pay(8, 'F', 'crossfit', 45000, 41000, '2026-11-12', 'mp'),
    pay(9, 'E', 'asesoria-erika', 30000, 30000, '2026-11-03', 'manual'),
    pay(10, 'A', 'crossfit', 45000, 41000, '2026-12-01', 'mp'),            // mes que viene: no cuenta
  ],
  expenses: [
    { id: 1, month: '2026-11-01', category: 'publicidad', amount: 60000 },
    { id: 2, month: '2026-11-01', category: 'publicidad', amount: '20000' },
    { id: 3, month: '2026-11-01', category: 'otro', amount: 10000 },
    { id: 4, month: '2026-10-01', category: 'publicidad', amount: 50000 },
  ],
};

// ---------------- Noviembre, Grupales ----------------
const D = F.finDashboard(input, 2026, 11, 'grupales');
const n = D.cur, o = D.prev;
console.log('\n— Noviembre 2026, Grupales (hoy 15/11) —');
check('mes en curso: hasta hoy', [n.partial, n.ref], [true, '2026-11-15']);
check('bruto', n.bruto, 170000);
check('neto (pago sin neto cuenta el monto)', n.neto, 159000);
check('comisión MP (solo pagos de MP con neto)', n.comision, 11000);
check('pagos y alumnos que pagaron', [n.pagos, n.pagadores], [4, 4]);
check('pago promedio', n.ticket, 42500);
check('activos a hoy (A, C, D, F; sin prueba en curso ni asesoría)', n.activos, 4);
check('activos al empezar (31/10: A, B, D, F)', n.activosInicio, 4);
check('ingreso esperado (precio personalizado de D)', n.mrr, 170000);
check('altas: nuevas · vuelven · de la prueba', [n.nuevas, n.vuelven, n.pruebasConv, n.altas], [0, 1, 1, 2]);
check('bajas (F y el eliminado; la anulada y la prueba cancelada no)', n.bajas, 2);
check('crecimiento', n.netoAlumnos, 0);
check('tasa de bajas', n.churn, 0.5);
check('publicidad (monto como texto también suma) y otros', [n.publicidad, n.otros], [80000, 10000]);
check('costo por alumno nuevo (vuelven no cuenta)', n.cac, 80000);
check('lo que pagaron los que entraron', n.ingresosNuevos, 37000);
check('retorno de la publicidad', n.roas, 0.4625);
check('pruebas: convertidas / terminadas / en curso', [n.trialConv, n.trialDone, n.trialEnCurso], [0, 1, 1]);
check('pruebas que pasan a pagar', n.conversion, 0);
check('resultado', n.resultado, 69000);

console.log('\n— Octubre 2026, Grupales —');
check('mes completo', [o.partial, o.ref], [false, '2026-10-31']);
check('bruto (incluye pago de alumno eliminado)', o.bruto, 180000);
check('neto', o.neto, 168500);
check('comisión', o.comision, 11500);
check('alumnos que pagaron (el eliminado cuenta aparte)', o.pagadores, 4);
check('activos al cierre / al empezar', [o.activos, o.activosInicio], [4, 3]);
check('ingreso esperado', o.mrr, 180000);
check('altas (el eliminado cuenta como nueva)', [o.nuevas, o.altas], [2, 2]);
check('bajas (B el 31/10; la anulada no)', o.bajas, 1);
check('tasa de bajas', o.churn, 1 / 3);
check('costo por alumno nuevo', o.cac, 25000);
check('retorno (solo D; del eliminado no se sabe)', o.roas, 0.8);
check('pruebas de octubre (I empezó el 31/10 en hora AR)', [o.trialConv, o.trialDone, o.conversion], [1, 2, 0.5]);
check('resultado', o.resultado, 118500);

console.log('\n— Rentabilidad —');
check('tasa de bajas promedio (solo meses con dato: nov y oct)', [D.rent.churnProm, D.rent.churnMeses], [(0.5 + 1 / 3) / 2, 2]);
check('valor de un alumno (nov)', D.rent.ltv, 39750 / ((0.5 + 1 / 3) / 2));
check('valor ÷ costo (nov)', D.rent.ltvCac, (39750 / ((0.5 + 1 / 3) / 2)) / 80000);
check('meses para recuperar (nov)', D.rent.recupero, 80000 / 39750);
check('valor de un alumno (oct)', D.rentPrev.ltv, 126375);
check('meses para recuperar (oct)', D.rentPrev.recupero, 25000 / 42125);

console.log('\n— Cohortes —');
const co = Object.fromEntries(D.cohorts.map(c => [`${c.y}-${c.m}`, c]));
check('6 filas (jun a nov)', D.cohorts.map(c => c.m), [6, 7, 8, 9, 10, 11]);
check('septiembre: 3 entraron; 100% a fin de oct, 2 de 3 a hoy', [co['2026-9'].n, co['2026-9'].pct[0], co['2026-9'].pct[1], co['2026-9'].pct[2]], [3, 1, 2 / 3, null]);
check('octubre: 1 entró (el eliminado no), sigue', [co['2026-10'].n, co['2026-10'].pct[0], co['2026-10'].pct[1]], [1, 1, null]);
check('noviembre: 2 entraron, sin meses siguientes', [co['2026-11'].n, co['2026-11'].pct[0]], [2, null]);
check('meses sin altas: vacíos', [co['2026-6'].n, co['2026-6'].pct.every(v => v === null)], [0, true]);

console.log('\n— Todo (con asesorías) —');
const T = F.finDashboard(input, 2026, 11, 'todo').cur;
check('bruto y neto suman la asesoría', [T.bruto, T.neto], [200000, 189000]);
check('pago promedio', T.ticket, 40000);
check('activos (+ asesoría)', [T.activos, T.activosInicio], [5, 5]);
check('asesoría sin precio: no suma al esperado y se avisa', [T.mrr, T.sinPrecio], [170000, 1]);
check('tasa de bajas', T.churn, 0.4);
check('resultado', T.resultado, 99000);

console.log('\n— Bordes —');
check('mes que no empezó → null', F.finDashboard(input, 2026, 12, 'grupales').cur, null);
const S = F.finDashboard(input, 2026, 8, 'grupales').cur;
check('mes sin datos: ceros y N/D donde no se puede dividir', [S.bruto, S.ticket, S.churn, S.cac, S.roas, S.conversion], [0, null, null, null, null, null]);
const Dsep = F.finDashboard(input, 2026, 9, 'grupales');
check('sin bajas promedio → valor de un alumno N/D', [Dsep.rent.churnProm, Dsep.rent.ltv], [null, null]);
check('variación: baja 10.000 de 180.000', F.finDelta(170000, 180000), { diff: -10000, pct: -10000 / 180000 * 100, dir: -1 });
check('variación desde 0: sin %', F.finDelta(5, 0), { diff: 5, pct: null, dir: 1 });
check('variación sin dato', F.finDelta(null, 3), null);
check('variación igual', F.finDelta(4, 4).dir, 0);
check('variación contra negativo usa el valor absoluto', F.finDelta(-50, -100).pct, 50);
const noPub = F.finDashboard(Object.assign({}, input, { expenses: [] }), 2026, 11, 'grupales');
check('sin publicidad: costo, retorno y valor÷costo N/D', [noPub.cur.cac, noPub.cur.roas, noPub.rent.ltvCac, noPub.rent.recupero], [null, null, null, null]);
const sinCfg = F.finDashboard(Object.assign({}, input, { prices: {} }), 2026, 11, 'grupales').cur;
check('sin precios en Configuración: solo suma el personalizado', [sinCfg.mrr, sinCfg.sinPrecio], [40000, 3]);
// Un pago manual con neto distinto (carga rara) no suma comisión de MP
const manualRaro = F.finDashboard(Object.assign({}, input, { payments: [pay(20, 'A', 'crossfit', 10000, 9000, '2026-11-02', 'manual')] }), 2026, 11, 'grupales').cur;
check('pago manual: no tiene comisión de MP', [manualRaro.comision, manualRaro.neto], [0, 9000]);
// Enero: el mes anterior es diciembre del año anterior
const ene = F.finDashboard(Object.assign({}, input, { today: '2027-01-20' }), 2027, 1, 'grupales');
check('enero compara con diciembre del año anterior', [ene.prev.y, ene.prev.m, ene.prev.bruto], [2026, 12, 45000]);
// No modifica los datos de entrada
check('no modifica los pagos de entrada', input.payments[0].day, undefined);

console.log(`\n${ok} de ${ok + bad} casos OK`);
process.exit(bad ? 1 : 0);
