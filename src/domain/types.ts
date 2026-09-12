/**
 * Contratos del dominio. Las mismas definiciones sirven para validar entradas
 * (Zod) y para tipar el motor puro. Todo importe es entero de centavos MXN.
 */
import { z } from 'zod';
import { isEconomicDate } from './dates';

export const economicDateSchema = z
  .string()
  .refine(isEconomicDate, { message: 'fecha económica inválida (se espera YYYY-MM-DD)' });

export const centsSchema = z
  .number()
  .int({ message: 'se espera un entero de centavos' })
  .refine(Number.isSafeInteger, { message: 'importe fuera del rango seguro' });

export const positiveCentsSchema = centsSchema.refine((v) => v > 0, {
  message: 'se espera un importe positivo',
});

export const nonNegativeCentsSchema = centsSchema.refine((v) => v >= 0, {
  message: 'se espera un importe no negativo',
});

export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9:_-]+$/, { message: 'identificador con caracteres no permitidos' });

/** Sentido del movimiento respecto de la caja del negocio. */
export const directionSchema = z.enum(['inflow', 'outflow']);
export type Direction = z.infer<typeof directionSchema>;

/** Una accion solo es utilizable si su condicion esta registrada. */
export const approvalSchema = z.enum(['confirmed', 'requires_agreement']);
export type Approval = z.infer<typeof approvalSchema>;

// --- Variantes discretas de cada accion permitida -------------------------

export const deferVariantSchema = z.object({
  id: idSchema,
  /** Nueva fecha de pago. Puede caer fuera del horizonte: la deuda no desaparece. */
  toDate: economicDateSchema,
  /** Comision explicita en centavos. 0 si el contrato no cobra. */
  feeCents: nonNegativeCentsSchema,
});

export const splitPartSchema = z.object({
  date: economicDateSchema,
  amountCents: positiveCentsSchema,
});

export const splitVariantSchema = z.object({
  id: idSchema,
  /** Las partes deben sumar exactamente el importe de la obligacion. */
  parts: z.array(splitPartSchema).min(2).max(4),
  feeCents: nonNegativeCentsSchema,
});

export const advanceVariantSchema = z.object({
  id: idSchema,
  /** Fecha en la que se recibe el cobro adelantado. */
  toDate: economicDateSchema,
  /** Descuento en puntos base enteros (200 = 2 %). */
  discountBasisPoints: z.number().int().min(0).max(10_000),
});

const actionCommon = {
  id: idSchema,
  obligationId: idSchema,
  approval: approvalSchema,
  /** Texto fijo del dataset. Nunca lo aporta el modelo. */
  label: z.string().min(1).max(120),
  counterparty: z.string().min(1).max(120),
};

export const actionOptionSchema = z.discriminatedUnion('kind', [
  z.object({
    ...actionCommon,
    kind: z.literal('defer'),
    variants: z.array(deferVariantSchema).min(1),
  }),
  z.object({
    ...actionCommon,
    kind: z.literal('split'),
    variants: z.array(splitVariantSchema).min(1),
  }),
  z.object({
    ...actionCommon,
    kind: z.literal('advance_receivable'),
    variants: z.array(advanceVariantSchema).min(1),
  }),
]);
export type ActionOption = z.infer<typeof actionOptionSchema>;
export type ActionKind = ActionOption['kind'];

// --- Obligaciones ---------------------------------------------------------

export const obligationSchema = z.object({
  id: idSchema,
  businessId: idSchema,
  direction: directionSchema,
  /** Importe bruto, siempre positivo. El sentido lo define direction. */
  amountCents: positiveCentsSchema,
  date: economicDateSchema,
  counterparty: z.string().min(1).max(120),
  concept: z.string().min(1).max(160),
  /** Nomina y esenciales no se pueden mover. */
  essential: z.boolean(),
  /** Los movimientos liquidados no vuelven a contar como pendientes. */
  settled: z.boolean(),
  actions: z.array(actionOptionSchema).default([]),
});
export type Obligation = z.infer<typeof obligationSchema>;

// --- Entrada del motor ----------------------------------------------------

export const scenarioInputSchema = z
  .object({
    businessId: idSchema,
    /** Revision del escenario del que proviene esta entrada. */
    baseRevision: z.number().int().min(0),
    scenarioId: idSchema,
    openingBalanceCents: centsSchema,
    /** La caja minima no puede ser negativa. */
    minimumCashCents: nonNegativeCentsSchema,
    horizonStart: economicDateSchema,
    horizonDays: z.number().int().min(1).max(31),
    obligations: z.array(obligationSchema),
    /** Ids de acciones (opcion o variante) excluidas por decision humana. */
    excludedActionIds: z.array(idSchema).default([]),
    demoToday: economicDateSchema,
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const ob of input.obligations) {
      if (seen.has(ob.id)) {
        ctx.addIssue({ code: 'custom', message: 'obligación duplicada: ' + ob.id });
      }
      seen.add(ob.id);
      if (ob.businessId !== input.businessId) {
        ctx.addIssue({ code: 'custom', message: 'obligación de otro negocio: ' + ob.id });
      }
      if (ob.essential && ob.actions.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'obligación esencial no admite acciones: ' + ob.id,
        });
      }
      for (const action of ob.actions) {
        if (action.obligationId !== ob.id) {
          ctx.addIssue({ code: 'custom', message: 'acción apunta a otra obligación: ' + action.id });
        }
        if (action.kind === 'advance_receivable' && ob.direction !== 'inflow') {
          ctx.addIssue({ code: 'custom', message: 'solo se adelantan cobros: ' + action.id });
        }
        if ((action.kind === 'defer' || action.kind === 'split') && ob.direction !== 'outflow') {
          ctx.addIssue({ code: 'custom', message: 'solo se mueven pagos: ' + action.id });
        }
        if (action.kind === 'split') {
          for (const variant of action.variants) {
            const sum = variant.parts.reduce((acc, p) => acc + p.amountCents, 0);
            if (sum !== ob.amountCents) {
              ctx.addIssue({
                code: 'custom',
                message: 'las partes no suman el importe original: ' + variant.id,
              });
            }
          }
        }
      }
    }
  });
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

// --- Salida del motor -----------------------------------------------------

export interface DailyBalance {
  date: string;
  inflowCents: number;
  outflowCents: number;
  closingCents: number;
}

export interface AppliedAction {
  optionId: string;
  variantId: string;
  obligationId: string;
  kind: ActionKind;
  approval: Approval;
  counterparty: string;
  /** Texto del dataset, no del modelo. */
  description: string;
  costCents: number;
}

export interface PendingCondition {
  optionId: string;
  counterparty: string;
  approval: Approval;
  text: string;
}

export interface PendingOutsideHorizon {
  obligationId: string;
  date: string;
  amountCents: number;
  direction: Direction;
  counterparty: string;
  concept: string;
  /** true cuando el vencimiento salio del horizonte por una accion del plan. */
  movedByPlan: boolean;
}

export interface Plan {
  id: string;
  /** Etiqueta derivada de las acciones del dataset. */
  label: string;
  actions: AppliedAction[];
  dailyBalances: DailyBalance[];
  minimumClosingCents: number;
  minimumClosingDate: string;
  costCents: number;
  modifiedObligationCount: number;
  pendingConditions: PendingCondition[];
  /** true si alguna accion requiere acuerdo aun no obtenido. */
  conditional: boolean;
  pendingOutsideHorizon: PendingOutsideHorizon[];
}

export type ConstraintKind =
  | 'essential_obligation'
  | 'minimum_cash'
  | 'excluded_action'
  | 'requires_agreement'
  | 'outside_horizon';

export interface Constraint {
  id: string;
  kind: ConstraintKind;
  title: string;
  detail: string;
  obligationId?: string;
  optionId?: string;
  amountCents?: number;
  date?: string;
}

export interface RiskItem {
  id: string;
  title: string;
  detail: string;
  obligationId?: string;
  date: string;
  shortfallCents: number;
  severity: 'high' | 'medium' | 'low';
}

export type InfeasibilityReason = 'no_solution' | 'search_too_wide';

export interface Infeasibility {
  reason: InfeasibilityReason;
  /** Menor faltante residual entre las combinaciones permitidas enumeradas. */
  minimalResidualShortfallCents: number;
  /** Combinacion que logra ese faltante residual, si existe alguna. */
  bestEffortActions: AppliedAction[];
  affectedConstraintIds: string[];
  evaluatedCombinations: number;
  /** Texto fijo: describe el alcance real de "sin solucion". */
  scopeNote: string;
}

/** Hecho numerico resoluble por el servidor. Gemini solo cita su id. */
export interface Fact {
  id: string;
  kind: 'money' | 'count' | 'date' | 'text';
  value: string;
  label: string;
}

export interface ReceivableSummary {
  obligationId: string;
  date: string;
  amountCents: number;
  counterparty: string;
  concept: string;
  withinHorizon: boolean;
  advanceOptionId?: string;
  advanceNetCents?: number;
  advanceCostCents?: number;
  advanceToDate?: string;
  advanceExcluded?: boolean;
}

export interface EngineResult {
  id: string;
  /** Huella de la entrada. Permite detectar composiciones obsoletas. */
  inputVersion: string;
  scenarioId: string;
  businessId: string;
  baseRevision: number;
  horizon: { start: string; end: string; days: string[] };
  demoToday: string;
  minimumCashCents: number;
  openingBalanceCents: number;
  baseline: {
    dailyBalances: DailyBalance[];
    minimumClosingCents: number;
    minimumClosingDate: string;
    shortfallCents: number;
    feasible: boolean;
  };
  shortfallsByDay: { date: string; shortfallCents: number }[];
  risks: RiskItem[];
  plans: Plan[];
  constraints: Constraint[];
  pendingOutsideHorizon: PendingOutsideHorizon[];
  receivables: ReceivableSummary[];
  excludedActionIds: string[];
  infeasibility: Infeasibility | null;
  /** Tokens numericos que el servidor resuelve en los textos del modelo. */
  facts: Record<string, Fact>;
  /** Universo cerrado de referencias que una composicion puede citar. */
  refs: string[];
  diagnostics: {
    evaluatedCombinations: number;
    combinationLimit: number;
    truncated: boolean;
    intradayNote: string;
  };
}
