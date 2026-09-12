/**
 * Motor determinista. Funciones puras: misma entrada, mismo resultado.
 *
 * Reglas fijadas aqui y verificadas por tests:
 * - Se evalua la caja al CIERRE de cada dia. Cobros y pagos del mismo dia se
 *   compensan; este MVP no modela orden intradia (se declara en la interfaz).
 * - Aplazar o dividir no elimina la obligacion: lo que cae fuera del horizonte
 *   se reporta como pendiente posterior.
 * - La comision de aplazar se paga junto con el importe aplazado; la de dividir
 *   se suma a la ultima parte. El costo de adelantar un cobro es el descuento.
 * - shortfall = max(0, cajaMinima - minimo saldo de cierre del horizonte).
 */
import { addCents, applyBasisPoints, type Cents } from './money';
import { buildHorizon, compareDates, addDays, formatEconomicDate, type EconomicDate } from './dates';
import { stableHash } from './hash';
import {
  scenarioInputSchema,
  type ActionOption,
  type AppliedAction,
  type Constraint,
  type DailyBalance,
  type EngineResult,
  type Fact,
  type Infeasibility,
  type Obligation,
  type PendingCondition,
  type PendingOutsideHorizon,
  type Plan,
  type ReceivableSummary,
  type RiskItem,
  type ScenarioInput,
} from './types';
import { formatCents } from './money';

/** Tope de combinaciones enumeradas. Superarlo NO significa "sin solucion". */
export const COMBINATION_LIMIT = 10_000;

export const INTRADAY_NOTE =
  'Se evalúa la caja al cierre de cada día. Los cobros y pagos del mismo día se compensan; no se modela el orden intradía.';

export const NO_SOLUTION_SCOPE_NOTE =
  'Sin solución dentro de las acciones registradas y no rechazadas de este escenario. No es una conclusión sobre todas las opciones financieras posibles.';

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

interface Flow {
  date: EconomicDate;
  direction: 'inflow' | 'outflow';
  amountCents: Cents;
  obligationId: string;
}

interface Choice {
  option: ActionOption;
  variantId: string;
  obligation: Obligation;
}

interface Combination {
  choices: Choice[];
  applied: AppliedAction[];
  costCents: Cents;
  dailyBalances: DailyBalance[];
  minimumClosingCents: Cents;
  minimumClosingDate: EconomicDate;
  shortfallCents: Cents;
  pendingOutsideHorizon: PendingOutsideHorizon[];
  modifiedObligationCount: number;
  planId: string;
  variantIds: string[];
}

// --- Aplicacion de acciones sobre los flujos -------------------------------

function flowsForObligation(ob: Obligation, choice: Choice | undefined): { flows: Flow[]; costCents: Cents } {
  if (!choice) {
    return {
      flows: [{ date: ob.date, direction: ob.direction, amountCents: ob.amountCents, obligationId: ob.id }],
      costCents: 0,
    };
  }
  const { option, variantId } = choice;
  if (option.kind === 'defer') {
    const variant = option.variants.find((v) => v.id === variantId);
    if (!variant) throw new EngineError('variante inexistente: ' + variantId);
    return {
      flows: [
        {
          date: variant.toDate,
          direction: 'outflow',
          amountCents: addCents(ob.amountCents, variant.feeCents),
          obligationId: ob.id,
        },
      ],
      costCents: variant.feeCents,
    };
  }
  if (option.kind === 'split') {
    const variant = option.variants.find((v) => v.id === variantId);
    if (!variant) throw new EngineError('variante inexistente: ' + variantId);
    const flows: Flow[] = variant.parts.map((part) => ({
      date: part.date,
      direction: 'outflow' as const,
      amountCents: part.amountCents,
      obligationId: ob.id,
    }));
    // La comision de dividir se paga con la ultima parte.
    const last = flows[flows.length - 1];
    last.amountCents = addCents(last.amountCents, variant.feeCents);
    return { flows, costCents: variant.feeCents };
  }
  const variant = option.variants.find((v) => v.id === variantId);
  if (!variant) throw new EngineError('variante inexistente: ' + variantId);
  const cost = applyBasisPoints(ob.amountCents, variant.discountBasisPoints);
  return {
    flows: [
      {
        date: variant.toDate,
        direction: 'inflow',
        amountCents: ob.amountCents - cost,
        obligationId: ob.id,
      },
    ],
    costCents: cost,
  };
}

function describeChoice(ob: Obligation, choice: Choice): { description: string; costCents: Cents } {
  const { option, variantId } = choice;
  if (option.kind === 'defer') {
    const v = option.variants.find((x) => x.id === variantId)!;
    const fee = v.feeCents > 0 ? ' con comisión de ' + formatCents(v.feeCents) : ' sin comisión';
    return {
      description:
        'Aplazar ' + formatCents(ob.amountCents) + ' a ' + formatEconomicDate(v.toDate) + fee,
      costCents: v.feeCents,
    };
  }
  if (option.kind === 'split') {
    const v = option.variants.find((x) => x.id === variantId)!;
    const parts = v.parts
      .map((p) => formatCents(p.amountCents) + ' el ' + formatEconomicDate(p.date))
      .join(' y ');
    const fee = v.feeCents > 0 ? ' más comisión de ' + formatCents(v.feeCents) : ' sin comisión';
    return { description: 'Dividir el pago en ' + parts + fee, costCents: v.feeCents };
  }
  const v = option.variants.find((x) => x.id === variantId)!;
  const cost = applyBasisPoints(ob.amountCents, v.discountBasisPoints);
  return {
    description:
      'Adelantar el cobro a ' +
      formatEconomicDate(v.toDate) +
      ' con descuento de ' +
      formatCents(cost) +
      ' (neto ' +
      formatCents(ob.amountCents - cost) +
      ')',
    costCents: cost,
  };
}

// --- Evaluacion de una combinacion ----------------------------------------

function evaluate(input: ScenarioInput, choices: Choice[], horizon: EconomicDate[]): Combination {
  const horizonStart = horizon[0];
  const horizonEnd = horizon[horizon.length - 1];
  const byObligation = new Map(choices.map((c) => [c.obligation.id, c]));

  const flows: Flow[] = [];
  let costCents = 0;
  for (const ob of input.obligations) {
    if (ob.settled) continue;
    const choice = byObligation.get(ob.id);
    const produced = flowsForObligation(ob, choice);
    costCents = addCents(costCents, produced.costCents);
    flows.push(...produced.flows);
  }

  const byDate = new Map<string, { inflow: Cents; outflow: Cents }>();
  for (const day of horizon) byDate.set(day, { inflow: 0, outflow: 0 });

  const outside: PendingOutsideHorizon[] = [];
  for (const flow of flows) {
    if (compareDates(flow.date, horizonStart) < 0) {
      throw new EngineError('flujo anterior al inicio del horizonte: ' + flow.obligationId);
    }
    if (compareDates(flow.date, horizonEnd) > 0) {
      const ob = input.obligations.find((o) => o.id === flow.obligationId)!;
      outside.push({
        obligationId: ob.id,
        date: flow.date,
        amountCents: flow.amountCents,
        direction: flow.direction,
        counterparty: ob.counterparty,
        concept: ob.concept,
        movedByPlan:
          byObligation.has(ob.id) && compareDates(ob.date, horizonEnd) <= 0,
      });
      continue;
    }
    const bucket = byDate.get(flow.date)!;
    if (flow.direction === 'inflow') bucket.inflow = addCents(bucket.inflow, flow.amountCents);
    else bucket.outflow = addCents(bucket.outflow, flow.amountCents);
  }

  let running = input.openingBalanceCents;
  const dailyBalances: DailyBalance[] = [];
  for (const day of horizon) {
    const bucket = byDate.get(day)!;
    running = addCents(running, bucket.inflow, -bucket.outflow);
    dailyBalances.push({
      date: day,
      inflowCents: bucket.inflow,
      outflowCents: bucket.outflow,
      closingCents: running,
    });
  }

  let minimumClosingCents = dailyBalances[0].closingCents;
  let minimumClosingDate = dailyBalances[0].date;
  for (const d of dailyBalances) {
    if (d.closingCents < minimumClosingCents) {
      minimumClosingCents = d.closingCents;
      minimumClosingDate = d.date;
    }
  }
  const shortfallCents = Math.max(0, input.minimumCashCents - minimumClosingCents);

  const applied: AppliedAction[] = choices.map((choice) => {
    const { description, costCents: c } = describeChoice(choice.obligation, choice);
    return {
      optionId: choice.option.id,
      variantId: choice.variantId,
      obligationId: choice.obligation.id,
      kind: choice.option.kind,
      approval: choice.option.approval,
      counterparty: choice.option.counterparty,
      description,
      costCents: c,
    };
  });

  const variantIds = choices.map((c) => c.variantId).sort();
  outside.sort((a, b) => compareDates(a.date, b.date) || a.obligationId.localeCompare(b.obligationId));

  return {
    choices,
    applied,
    costCents,
    dailyBalances,
    minimumClosingCents,
    minimumClosingDate,
    shortfallCents,
    pendingOutsideHorizon: outside,
    modifiedObligationCount: choices.length,
    planId: variantIds.length === 0 ? 'plan:base' : 'plan:' + variantIds.join('-'),
    variantIds,
  };
}

// --- Enumeracion ----------------------------------------------------------

interface ChoiceGroup {
  obligation: Obligation;
  options: Choice[];
}

function buildChoiceGroups(input: ScenarioInput): ChoiceGroup[] {
  const excluded = new Set(input.excludedActionIds);
  const groups: ChoiceGroup[] = [];
  for (const ob of input.obligations) {
    if (ob.settled || ob.essential) continue;
    const options: Choice[] = [];
    for (const option of ob.actions) {
      if (excluded.has(option.id)) continue;
      for (const variant of option.variants) {
        if (excluded.has(variant.id)) continue;
        options.push({ option, variantId: variant.id, obligation: ob });
      }
    }
    if (options.length > 0) groups.push({ obligation: ob, options });
  }
  // Orden estable para que la enumeracion sea reproducible.
  groups.sort((a, b) => a.obligation.id.localeCompare(b.obligation.id));
  return groups;
}

function countCombinations(groups: ChoiceGroup[]): number {
  let total = 1;
  for (const g of groups) {
    total *= g.options.length + 1; // +1 = no tocar esa obligacion
    if (total > COMBINATION_LIMIT) return total;
  }
  return total;
}

function* enumerate(groups: ChoiceGroup[]): Generator<Choice[]> {
  const current: Choice[] = [];
  function* walk(index: number): Generator<Choice[]> {
    if (index === groups.length) {
      yield [...current];
      return;
    }
    yield* walk(index + 1); // sin accion sobre esta obligacion
    for (const choice of groups[index].options) {
      current.push(choice);
      yield* walk(index + 1);
      current.pop();
    }
  }
  yield* walk(0);
}

// --- Filtros y orden de planes --------------------------------------------

function comparePlans(a: Combination, b: Combination): number {
  if (a.costCents !== b.costCents) return a.costCents - b.costCents;
  if (a.modifiedObligationCount !== b.modifiedObligationCount) {
    return a.modifiedObligationCount - b.modifiedObligationCount;
  }
  return a.planId.localeCompare(b.planId);
}

/**
 * Elimina combinaciones redundantes de forma comprobable: un plan que anade
 * acciones sobre otro plan ya factible, sin reducir costo ni compromisos
 * modificados, no aporta una alternativa distinta.
 */
function removeDominated(feasible: Combination[]): Combination[] {
  const sets = feasible.map((p) => new Set(p.variantIds));
  return feasible.filter((plan, i) => {
    for (let j = 0; j < feasible.length; j += 1) {
      if (i === j) continue;
      const other = feasible[j];
      if (other.variantIds.length >= plan.variantIds.length) continue;
      const isSubset = other.variantIds.every((v) => sets[i].has(v));
      if (!isSubset) continue;
      if (other.costCents <= plan.costCents && other.modifiedObligationCount <= plan.modifiedObligationCount) {
        return false;
      }
    }
    return true;
  });
}

function pendingConditionsFor(applied: AppliedAction[]): PendingCondition[] {
  return applied
    .filter((a) => a.approval === 'requires_agreement')
    .map((a) => ({
      optionId: a.optionId,
      counterparty: a.counterparty,
      approval: a.approval,
      text:
        'Solo es posible si ' + a.counterparty + ' acepta. Hasta entonces no es dinero disponible.',
    }));
}

function planLabel(applied: AppliedAction[]): string {
  if (applied.length === 0) return 'Sin cambios';
  return applied.map((a) => a.description).join(' + ');
}

function toPlan(c: Combination): Plan {
  const pendingConditions = pendingConditionsFor(c.applied);
  return {
    id: c.planId,
    label: planLabel(c.applied),
    actions: c.applied,
    dailyBalances: c.dailyBalances,
    minimumClosingCents: c.minimumClosingCents,
    minimumClosingDate: c.minimumClosingDate,
    costCents: c.costCents,
    modifiedObligationCount: c.modifiedObligationCount,
    pendingConditions,
    conditional: pendingConditions.length > 0,
    pendingOutsideHorizon: c.pendingOutsideHorizon,
  };
}

// --- Restricciones, riesgos, hechos y referencias --------------------------

function buildConstraints(
  input: ScenarioInput,
  horizon: EconomicDate[],
  baseline: Combination,
): Constraint[] {
  const horizonEnd = horizon[horizon.length - 1];
  const constraints: Constraint[] = [];

  constraints.push({
    id: 'constraint:minimum_cash',
    kind: 'minimum_cash',
    title: 'Caja mínima obligatoria',
    detail:
      'El saldo de cierre no puede bajar de ' +
      formatCents(input.minimumCashCents) +
      ' ningún día del horizonte.',
    amountCents: input.minimumCashCents,
  });

  for (const ob of input.obligations) {
    if (!ob.essential || ob.settled) continue;
    if (compareDates(ob.date, horizon[0]) < 0 || compareDates(ob.date, horizonEnd) > 0) continue;
    constraints.push({
      id: 'constraint:' + ob.id,
      kind: 'essential_obligation',
      title: 'No se puede mover: ' + ob.concept,
      detail:
        'Compromiso esencial de ' +
        formatCents(ob.amountCents) +
        ' con ' +
        ob.counterparty +
        ' el ' +
        formatEconomicDate(ob.date) +
        '. No admite aplazamiento ni división.',
      obligationId: ob.id,
      amountCents: ob.amountCents,
      date: ob.date,
    });
  }

  const excluded = new Set(input.excludedActionIds);
  for (const ob of input.obligations) {
    for (const option of ob.actions) {
      if (excluded.has(option.id) || option.variants.every((v) => excluded.has(v.id))) {
        constraints.push({
          id: 'constraint:excluded:' + option.id,
          kind: 'excluded_action',
          title: 'Acción descartada: ' + option.label,
          detail:
            'La excluiste. Deja de considerarse en el cálculo; el pago registrado no cambia.',
          obligationId: ob.id,
          optionId: option.id,
        });
        continue;
      }
      if (option.approval === 'requires_agreement') {
        constraints.push({
          id: 'constraint:agreement:' + option.id,
          kind: 'requires_agreement',
          title: 'Condicionado: ' + option.label,
          detail:
            'Solo es posible si ' +
            option.counterparty +
            ' acepta. Es una condición pendiente, no un acuerdo cerrado.',
          obligationId: ob.id,
          optionId: option.id,
        });
      }
    }
  }

  if (baseline.pendingOutsideHorizon.length > 0) {
    let pagos = 0;
    let cobros = 0;
    for (const p of baseline.pendingOutsideHorizon) {
      if (p.direction === 'outflow') pagos = addCents(pagos, p.amountCents);
      else cobros = addCents(cobros, p.amountCents);
    }
    const partes: string[] = [];
    if (pagos > 0) partes.push('pagos por ' + formatCents(pagos));
    if (cobros > 0) partes.push('cobros por ' + formatCents(cobros));
    constraints.push({
      id: 'constraint:outside_horizon',
      kind: 'outside_horizon',
      title: 'Vencimientos después del horizonte',
      detail:
        'Quedan compromisos con fecha posterior al último día mostrado: ' +
        partes.join(' y ') +
        '. No entran en el cálculo de la caja de estos siete días.',
      // Solo se destaca un importe si queda deuda por pagar: un cero suelto
      // junto a un cobro pendiente se leería como si no quedara nada fuera.
      amountCents: pagos > 0 ? pagos : undefined,
    });
  }

  return constraints;
}

function buildRisks(input: ScenarioInput, baseline: Combination): RiskItem[] {
  if (baseline.shortfallCents === 0) return [];
  const risks: RiskItem[] = [];
  const shortfallDays = baseline.dailyBalances.filter(
    (d) => d.closingCents < input.minimumCashCents,
  );
  const firstDay = shortfallDays[0];

  for (const ob of input.obligations) {
    if (!ob.essential || ob.settled) continue;
    const day = baseline.dailyBalances.find((d) => d.date === ob.date);
    if (!day) continue;
    if (day.closingCents >= input.minimumCashCents) continue;
    risks.push({
      id: 'risk:' + ob.id,
      title: ob.concept + ' en riesgo',
      detail:
        'El saldo de cierre del ' +
        formatEconomicDate(ob.date) +
        ' queda en ' +
        formatCents(day.closingCents) +
        ', por debajo de la caja mínima. ' +
        ob.concept +
        ' es un compromiso esencial de ' +
        formatCents(ob.amountCents) +
        '.',
      obligationId: ob.id,
      date: ob.date,
      shortfallCents: Math.max(0, input.minimumCashCents - day.closingCents),
      severity: day.closingCents < 0 ? 'high' : 'medium',
    });
  }

  if (risks.length === 0 && firstDay) {
    risks.push({
      id: 'risk:minimum_cash',
      title: 'Caja mínima comprometida',
      detail:
        'El saldo de cierre del ' +
        formatEconomicDate(firstDay.date) +
        ' queda en ' +
        formatCents(firstDay.closingCents) +
        ', por debajo de la caja mínima exigida.',
      date: firstDay.date,
      shortfallCents: Math.max(0, input.minimumCashCents - firstDay.closingCents),
      severity: firstDay.closingCents < 0 ? 'high' : 'medium',
    });
  }

  risks.sort((a, b) => b.shortfallCents - a.shortfallCents || a.id.localeCompare(b.id));
  return risks;
}

function buildReceivables(
  input: ScenarioInput,
  horizon: EconomicDate[],
): ReceivableSummary[] {
  const excluded = new Set(input.excludedActionIds);
  const horizonEnd = horizon[horizon.length - 1];
  return input.obligations
    .filter((ob) => ob.direction === 'inflow' && !ob.settled)
    .map((ob) => {
      const advance = ob.actions.find((a) => a.kind === 'advance_receivable');
      const variant =
        advance && advance.kind === 'advance_receivable'
          ? advance.variants.find((v) => !excluded.has(v.id))
          : undefined;
      const isExcluded = Boolean(advance && (excluded.has(advance.id) || !variant));
      const cost = variant ? applyBasisPoints(ob.amountCents, variant.discountBasisPoints) : undefined;
      return {
        obligationId: ob.id,
        date: ob.date,
        amountCents: ob.amountCents,
        counterparty: ob.counterparty,
        concept: ob.concept,
        withinHorizon: compareDates(ob.date, horizonEnd) <= 0,
        advanceOptionId: advance?.id,
        advanceNetCents: cost === undefined ? undefined : ob.amountCents - cost,
        advanceCostCents: cost,
        advanceToDate: variant?.toDate,
        advanceExcluded: isExcluded || undefined,
      };
    })
    .sort((a, b) => compareDates(a.date, b.date) || a.obligationId.localeCompare(b.obligationId));
}

function buildFacts(
  input: ScenarioInput,
  baseline: Combination,
  plans: Plan[],
  receivables: ReceivableSummary[],
  infeasibility: Infeasibility | null,
): Record<string, Fact> {
  const facts: Record<string, Fact> = {};
  const money = (id: string, label: string, cents: number) => {
    facts[id] = { id, kind: 'money', value: formatCents(cents), label };
  };
  const count = (id: string, label: string, value: number) => {
    facts[id] = { id, kind: 'count', value: String(value), label };
  };
  const date = (id: string, label: string, value: string) => {
    facts[id] = { id, kind: 'date', value: formatEconomicDate(value), label };
  };

  money('fact:opening_balance', 'Saldo inicial', input.openingBalanceCents);
  money('fact:minimum_cash', 'Caja mínima', input.minimumCashCents);
  money('fact:shortfall_total', 'Total que falta esta semana', baseline.shortfallCents);
  money('fact:baseline_min_closing', 'Saldo de cierre más bajo', baseline.minimumClosingCents);
  date('fact:baseline_min_date', 'Día del saldo más bajo', baseline.minimumClosingDate);
  count('fact:plan_count', 'Planes disponibles', plans.length);

  for (const day of baseline.dailyBalances) {
    money('fact:day:' + day.date + ':closing', 'Saldo de cierre', day.closingCents);
    money('fact:day:' + day.date + ':inflow', 'Cobros del día', day.inflowCents);
    money('fact:day:' + day.date + ':outflow', 'Pagos del día', day.outflowCents);
  }

  for (const plan of plans) {
    money('fact:' + plan.id + ':cost', 'Costo del plan', plan.costCents);
    money('fact:' + plan.id + ':min_closing', 'Saldo más bajo con el plan', plan.minimumClosingCents);
    count('fact:' + plan.id + ':modified', 'Compromisos modificados', plan.modifiedObligationCount);
    count('fact:' + plan.id + ':conditions', 'Condiciones pendientes', plan.pendingConditions.length);
  }

  for (const r of receivables) {
    money('fact:receivable:' + r.obligationId + ':amount', 'Importe de la factura', r.amountCents);
    date('fact:receivable:' + r.obligationId + ':date', 'Fecha esperada de cobro', r.date);
    if (r.advanceNetCents !== undefined) {
      money('fact:receivable:' + r.obligationId + ':net', 'Neto si se adelanta', r.advanceNetCents);
    }
    if (r.advanceCostCents !== undefined) {
      money('fact:receivable:' + r.obligationId + ':cost', 'Costo de adelantar', r.advanceCostCents);
    }
  }

  if (infeasibility) {
    money(
      'fact:residual_shortfall',
      'Lo que seguiría faltando aun con el mejor plan',
      infeasibility.minimalResidualShortfallCents,
    );
  }

  return facts;
}

function buildRefs(
  resultId: string,
  input: ScenarioInput,
  horizon: EconomicDate[],
  plans: Plan[],
  constraints: Constraint[],
  risks: RiskItem[],
  facts: Record<string, Fact>,
): string[] {
  const refs = new Set<string>();
  refs.add('result:' + resultId);
  for (const day of horizon) refs.add('day:' + day);
  for (const ob of input.obligations) refs.add('obligation:' + ob.id);
  for (const plan of plans) refs.add(plan.id);
  for (const c of constraints) refs.add(c.id);
  for (const r of risks) refs.add(r.id);
  for (const f of Object.keys(facts)) refs.add(f);
  refs.add('history:scenario');
  return [...refs].sort();
}

// --- Canonicalizacion de la entrada ---------------------------------------

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/**
 * Ordena la entrada de forma estable antes de calcular.
 *
 * Es imprescindible: el mismo escenario puede llegar desde la memoria del
 * proceso o reconstruido desde Tiger Data, y el orden de obligaciones,
 * acciones o variantes no tiene por que coincidir. Sin esto, dos estados
 * identicos producirian identificadores de resultado distintos y la cache de
 * composicion y el control de "resultado vigente" dejarian de funcionar.
 */
export function canonicalizeInput(input: ScenarioInput): ScenarioInput {
  return {
    ...input,
    excludedActionIds: [...new Set(input.excludedActionIds)].sort(),
    obligations: [...input.obligations].sort(byId).map((ob) => ({
      ...ob,
      actions: [...ob.actions]
        .sort(byId)
        .map((action) => ({ ...action, variants: [...action.variants].sort(byId) }) as ActionOption),
    })),
  };
}

// --- Entrada principal ----------------------------------------------------

export function computeEngineResult(rawInput: ScenarioInput): EngineResult {
  const parsed = scenarioInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new EngineError(
      'entrada inválida: ' + parsed.error.issues.map((i) => i.message).join('; '),
    );
  }
  const input = canonicalizeInput(parsed.data);
  const horizon = buildHorizon(input.horizonStart, input.horizonDays);
  const horizonEnd = horizon[horizon.length - 1];

  const baseline = evaluate(input, [], horizon);
  const inputVersion = stableHash({
    businessId: input.businessId,
    scenarioId: input.scenarioId,
    baseRevision: input.baseRevision,
    openingBalanceCents: input.openingBalanceCents,
    minimumCashCents: input.minimumCashCents,
    horizonStart: input.horizonStart,
    horizonDays: input.horizonDays,
    demoToday: input.demoToday,
    // Ya canonicalizadas: mismo estado, misma huella, venga de donde venga.
    obligations: input.obligations,
    excludedActionIds: input.excludedActionIds,
  });
  const resultId = 'result:' + inputVersion;

  const groups = buildChoiceGroups(input);
  const combinationCount = countCombinations(groups);

  let plans: Plan[] = [];
  let infeasibility: Infeasibility | null = null;
  let evaluated = 0;
  let truncated = false;

  const constraints = buildConstraints(input, horizon, baseline);
  const risks = buildRisks(input, baseline);

  if (baseline.shortfallCents > 0) {
    if (combinationCount > COMBINATION_LIMIT) {
      truncated = true;
      infeasibility = {
        reason: 'search_too_wide',
        minimalResidualShortfallCents: baseline.shortfallCents,
        bestEffortActions: [],
        affectedConstraintIds: constraints.map((c) => c.id),
        evaluatedCombinations: 0,
        scopeNote:
          'El escenario es demasiado amplio para enumerar las combinaciones permitidas. No se concluye que no exista solución.',
      };
    } else {
      const feasible: Combination[] = [];
      let best: Combination = baseline;
      for (const choices of enumerate(groups)) {
        evaluated += 1;
        const combo = choices.length === 0 ? baseline : evaluate(input, choices, horizon);
        if (combo.shortfallCents === 0) {
          feasible.push(combo);
        } else if (
          combo.shortfallCents < best.shortfallCents ||
          (combo.shortfallCents === best.shortfallCents && comparePlans(combo, best) < 0)
        ) {
          best = combo;
        }
      }
      const survivors = removeDominated(feasible).sort(comparePlans);
      plans = survivors.slice(0, 3).map(toPlan);

      if (plans.length === 0) {
        infeasibility = {
          reason: 'no_solution',
          minimalResidualShortfallCents: best.shortfallCents,
          bestEffortActions: best.applied,
          affectedConstraintIds: constraints
            .filter(
              (c) =>
                c.kind === 'essential_obligation' ||
                c.kind === 'minimum_cash' ||
                c.kind === 'excluded_action',
            )
            .map((c) => c.id),
          evaluatedCombinations: evaluated,
          scopeNote: NO_SOLUTION_SCOPE_NOTE,
        };
      }
    }
  }

  const receivables = buildReceivables(input, horizon);
  const facts = buildFacts(input, baseline, plans, receivables, infeasibility);
  const refs = buildRefs(resultId, input, horizon, plans, constraints, risks, facts);

  return {
    id: resultId,
    inputVersion,
    scenarioId: input.scenarioId,
    businessId: input.businessId,
    baseRevision: input.baseRevision,
    horizon: { start: input.horizonStart, end: horizonEnd, days: horizon },
    demoToday: input.demoToday,
    minimumCashCents: input.minimumCashCents,
    openingBalanceCents: input.openingBalanceCents,
    baseline: {
      dailyBalances: baseline.dailyBalances,
      minimumClosingCents: baseline.minimumClosingCents,
      minimumClosingDate: baseline.minimumClosingDate,
      shortfallCents: baseline.shortfallCents,
      feasible: baseline.shortfallCents === 0,
    },
    shortfallsByDay: baseline.dailyBalances.map((d) => ({
      date: d.date,
      shortfallCents: Math.max(0, input.minimumCashCents - d.closingCents),
    })),
    risks,
    plans,
    constraints,
    pendingOutsideHorizon: baseline.pendingOutsideHorizon,
    receivables,
    excludedActionIds: [...input.excludedActionIds].sort(),
    infeasibility,
    facts,
    refs,
    diagnostics: {
      evaluatedCombinations: evaluated,
      combinationLimit: COMBINATION_LIMIT,
      truncated,
      intradayNote: INTRADAY_NOTE,
    },
  };
}

/** Utilidad para la UI y las pruebas: proyecta el dia siguiente al horizonte. */
export function dayAfterHorizon(result: EngineResult): EconomicDate {
  return addDays(result.horizon.end, 1);
}
