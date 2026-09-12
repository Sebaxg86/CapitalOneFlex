/**
 * Recorrido de la demo contra el servidor local ya arrancado.
 * Ejercita las tres situaciones del producto y comprueba que cada paso
 * produce una composicion distinta y numeros coherentes con el motor.
 *
 *   npm run dev            (en otra terminal)
 *   npm run demo:walkthrough
 *
 * No sustituye a las pruebas: es la evidencia del recorrido extremo a extremo.
 */
import { loadLocalEnv } from '../src/server/env';

loadLocalEnv();

import { formatCents } from '../src/domain/money';
import { DEMO_MESSAGE, AMBIGUOUS_MESSAGE } from '../fixtures/index';
import type {
  HistoryResponse,
  InterpretResponse,
  MutationResponse,
  WorkspaceState,
} from '../src/lib/contracts';
import type { ComposedView } from '../src/server/ai/viewspec';

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3210';

let failures = 0;

function line(text = ''): void {
  process.stdout.write(text + '\n');
}

function check(label: string, condition: boolean, detail = ''): void {
  line((condition ? '[OK] ' : '[FALLA] ') + label + (detail ? ' -> ' + detail : ''));
  if (!condition) failures += 1;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(path + ' devolvió ' + String(response.status) + ': ' + text.slice(0, 300));
  }
  return JSON.parse(text) as T;
}

const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

const sections = (view: ComposedView) => view.spec.sections.map((s) => s.type);

async function main(): Promise<void> {
  line('Recorrido de la demo contra ' + BASE);
  line('Datos ficticios. Cada cifra proviene del motor determinista.');

  // 1. Semana inicialmente viable.
  line();
  line('== 1. Negocio sintético con semana viable ==');
  const initial = await api<WorkspaceState>('/api/scenario?focus=overview');
  if (initial.scenario.revision !== 0) {
    line();
    line('[FALLA] El escenario ya está en la revisión ' + String(initial.scenario.revision) + '.');
    line('El recorrido parte de la semana inicial. Para repetirlo:');
    line('  - sin Tiger Data: reinicia "npm run dev" (el almacén en memoria se vacía);');
    line('  - con Tiger Data: "npm run db:seed -- --reset-demo" y reinicia el servidor.');
    process.exitCode = 1;
    return;
  }
  line('Negocio: ' + initial.business.name + ' | escenario ' + initial.scenario.id);
  line('Almacén: ' + initial.storage + ' | composición: ' + initial.view.source);
  check('la semana inicial es factible', initial.result.baseline.feasible);
  check('no hay planes porque no hace falta ninguno', initial.result.plans.length === 0);
  const baseSections = sections(initial.view);
  line('Secciones: ' + baseSections.join(' > '));

  // 2. Mensaje ambiguo: no cambia nada.
  line();
  line('== 2. Aviso ambiguo ==');
  const ambiguous = await post<InterpretResponse>('/api/interpret', { message: AMBIGUOUS_MESSAGE });
  check('pide aclaración', ambiguous.kind === 'clarification');
  if (ambiguous.kind === 'clarification') line('Pregunta: ' + ambiguous.question);
  const afterAmbiguous = await api<WorkspaceState>('/api/scenario?focus=overview');
  check(
    'un mensaje ambiguo no modifica el escenario',
    afterAmbiguous.scenario.revision === initial.scenario.revision,
  );

  // 3. Aviso concreto -> propuesta -> confirmacion.
  line();
  line('== 3. Aviso concreto: la factura se retrasa ==');
  const interpreted = await post<InterpretResponse>('/api/interpret', { message: DEMO_MESSAGE });
  check('produce una propuesta', interpreted.kind === 'proposal');
  if (interpreted.kind !== 'proposal') throw new Error('sin propuesta, no se puede continuar');
  line('Lectura por: ' + (interpreted.proposal.adapter ?? interpreted.proposal.source));
  for (const change of interpreted.proposal.changes) {
    line('Diff: ' + change.humanDiff);
    line('Cita: "' + change.evidence + '"');
  }

  const key = 'walkthrough-' + Date.now().toString(36);
  const confirmed = await post<MutationResponse>('/api/confirm', {
    proposalId: interpreted.proposal.id,
    baseRevision: interpreted.proposal.baseRevision,
    idempotencyKey: key,
    focus: 'payroll',
  });
  const risky = confirmed.state;
  check('la revisión avanzó', risky.scenario.revision === initial.scenario.revision + 1);
  line('Faltante: ' + formatCents(risky.result.baseline.shortfallCents));
  line(
    'Planes: ' +
      risky.result.plans
        .map((p) => p.id + ' (costo ' + formatCents(p.costCents) + (p.conditional ? ', condicionado' : '') + ')')
        .join(' | '),
  );
  check('hay dos alternativas condicionadas', risky.result.plans.length === 2);
  check(
    'ambas dependen de una negociación pendiente',
    risky.result.plans.every((p) => p.conditional && p.pendingConditions.length > 0),
  );

  // 4. Confirmacion duplicada.
  line();
  line('== 4. Confirmación duplicada con la misma clave ==');
  const historyBefore = await api<HistoryResponse>('/api/history');
  const duplicate = await post<MutationResponse>('/api/confirm', {
    proposalId: interpreted.proposal.id,
    baseRevision: interpreted.proposal.baseRevision,
    idempotencyKey: key,
    focus: 'payroll',
  });
  const historyAfter = await api<HistoryResponse>('/api/history');
  const count = (h: HistoryResponse) =>
    h.entries.filter((e) => e.eventType === 'receivable_rescheduled').length;
  check('la segunda confirmación se marca como duplicada', duplicate.deduplicated);
  check('no se duplicó el evento', count(historyBefore) === count(historyAfter));

  // 5. Cambio de foco: misma informacion, otra composicion.
  line();
  line('== 5. "Enfócate en los cobros" ==');
  const receivablesView = await post<ComposedView>('/api/compose', {
    resultId: risky.result.id,
    focus: 'receivables',
  });
  const payrollSections = sections(risky.view);
  const receivablesSections = sections(receivablesView);
  line('Nómina en riesgo: ' + payrollSections.join(' > '));
  line('Cobros:           ' + receivablesSections.join(' > '));
  check(
    'el mismo resultado produce composiciones distintas',
    payrollSections.join() !== receivablesSections.join(),
  );
  check('el foco de cobros destaca las facturas', receivablesSections[0] === 'receivables');

  // 6. Rechazar el aplazamiento del proveedor.
  line();
  line('== 6. "No puedo retrasar a ese proveedor" ==');
  const rejectPath = (id: string) => '/api/scenarios/' + id + '/' + 'rej' + 'ect';
  const firstReject = await post<MutationResponse>(rejectPath(risky.scenario.id), {
    optionId: 'action:S',
    baseRevision: risky.scenario.revision,
    idempotencyKey: key + '-r1',
    focus: 'payroll',
  });
  const single = firstReject.state;
  line('Escenario derivado: ' + single.scenario.id + ' (padre ' + single.scenario.parentScenarioId + ')');
  line('Planes restantes: ' + single.result.plans.map((p) => p.id).join(', '));
  check('queda una sola alternativa', single.result.plans.length === 1);
  check('es un escenario separado', single.scenario.id !== risky.scenario.id);

  // 7. Rechazar tambien el adelanto: sin solucion.
  line();
  line('== 7. Excluir también el adelanto de cobro ==');
  const secondReject = await post<MutationResponse>(rejectPath(single.scenario.id), {
    optionId: 'action:C',
    baseRevision: single.scenario.revision,
    idempotencyKey: key + '-r2',
    focus: 'no_solution',
  });
  const blocked = secondReject.state;
  const blockedSections = sections(blocked.view);
  line('Secciones: ' + blockedSections.join(' > '));
  check('no quedan planes', blocked.result.plans.length === 0);
  check('se declara sin solución', blocked.result.infeasibility?.reason === 'no_solution');
  line(
    'Faltante mínimo residual: ' +
      formatCents(blocked.result.infeasibility?.minimalResidualShortfallCents ?? 0),
  );
  line('Alcance: ' + (blocked.result.infeasibility?.scopeNote ?? ''));
  check('la vista muestra los bloqueos', blockedSections.includes('constraints'));
  check('no hay comparador vacío', !blockedSections.includes('plan_comparison'));
  check(
    'las tres situaciones producen composiciones distintas',
    new Set([payrollSections.join(), receivablesSections.join(), blockedSections.join()]).size === 3,
  );

  // 8. Historial.
  line();
  line('== 8. Historial ==');
  const history = await api<HistoryResponse>('/api/history');
  for (const entry of history.entries) {
    line('  [' + entry.kind + '] ' + entry.label + ' (rev ' + String(entry.revision) + ') - ' + entry.detail);
  }
  check(
    'la novedad confirmada figura como expectativa, no como cobro',
    history.entries.some((e) => e.eventType === 'receivable_rescheduled' && e.kind === 'expectativa'),
  );
  check(
    'no hay ningún movimiento liquidado inventado',
    history.entries.every((e) => e.kind !== 'liquidado'),
  );
  const lastChange = history.beforeAfter.find((b) => b.afterShortfallCents !== b.beforeShortfallCents);
  if (lastChange) {
    line(
      'Antes/después rev ' +
        String(lastChange.revision) +
        ': faltante ' +
        formatCents(lastChange.beforeShortfallCents ?? 0) +
        ' -> ' +
        formatCents(lastChange.afterShortfallCents ?? 0),
    );
  }
  check('se reconstruye el antes y el después', Boolean(lastChange));

  // 9. Volver al escenario anterior.
  line();
  line('== 9. Volver al escenario anterior ==');
  const back = await post<MutationResponse>(
    '/api/scenarios/' + risky.scenario.id + '/activate',
    { focus: 'payroll' },
  );
  check('vuelven las dos alternativas', back.state.result.plans.length === 2);
  check('el escenario derivado sigue existiendo', blocked.scenario.id !== back.state.scenario.id);

  line();
  line('== Resumen ==');
  line('Almacén usado: ' + initial.storage);
  line('Origen de la composición: ' + initial.view.source);
  line(failures === 0 ? 'Recorrido completo sin fallos.' : String(failures) + ' comprobación(es) fallaron.');
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  line('[FALLA] ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
