/**
 * Datos sinteticos de la demo. Todo es ficticio.
 *
 * Hay dos fixtures:
 * - `oracleScenario`: el caso numerico exacto de ARQUITECTURA.md seccion 3.
 *   Queda CONGELADO: sus valores esperados no cambian.
 * - `demoScenario`: el negocio de ~10 registros que usa la aplicacion. Sus
 *   obligaciones adicionales estan compensadas dia a dia, de modo que los
 *   saldos de cierre coinciden con el oraculo; aun asi se verifican en un test
 *   propio (`tests/demo-fixture.test.ts`), no por herencia del anterior.
 */
import { pesos } from '../src/domain/money';
import { addDays, type EconomicDate } from '../src/domain/dates';
import type { Obligation, ScenarioInput } from '../src/domain/types';

export const DEMO_BUSINESS_ID = 'biz:marea';

export const DEMO_BUSINESS = {
  id: DEMO_BUSINESS_ID,
  name: 'Marea Estudio',
  description: 'Agencia B2B de servicios creativos. Cobra por factura y cubre nómina y proveedores.',
  currency: 'MXN',
  timezone: 'America/Monterrey',
} as const;

/** Fecha economica D0. Se puede sobreescribir con DEMO_TODAY. */
export const DEFAULT_DEMO_TODAY: EconomicDate = '2026-09-12';

export const HORIZON_DAYS = 7;

export const OPENING_BALANCE_CENTS = pesos(20_000);
export const MINIMUM_CASH_CENTS = pesos(3_000);

/** Devuelve la fecha del dia relativo `n` del horizonte (D0 = today). */
export function day(today: EconomicDate, n: number): EconomicDate {
  return addDays(today, n);
}

function baseObligations(today: EconomicDate): Obligation[] {
  const D = (n: number) => day(today, n);
  return [
    {
      id: 'inv-a',
      businessId: DEMO_BUSINESS_ID,
      direction: 'inflow',
      amountCents: pesos(18_000),
      date: D(2),
      counterparty: 'Arcadia Retail',
      concept: 'Factura F-1042',
      essential: false,
      settled: false,
      actions: [],
    },
    {
      id: 'sup-cloud',
      businessId: DEMO_BUSINESS_ID,
      direction: 'outflow',
      amountCents: pesos(12_000),
      date: D(2),
      counterparty: 'Núcleo Cloud',
      concept: 'Servicios de infraestructura',
      essential: false,
      settled: false,
      actions: [
        {
          id: 'action:S',
          obligationId: 'sup-cloud',
          kind: 'split',
          approval: 'requires_agreement',
          label: 'Dividir el pago a Núcleo Cloud',
          counterparty: 'Núcleo Cloud',
          variants: [
            {
              id: 'S1',
              parts: [
                { date: D(2), amountCents: pesos(2_000) },
                { date: D(8), amountCents: pesos(10_000) },
              ],
              feeCents: 0,
            },
          ],
        },
      ],
    },
    {
      id: 'payroll',
      businessId: DEMO_BUSINESS_ID,
      direction: 'outflow',
      amountCents: pesos(15_000),
      date: D(3),
      counterparty: 'Equipo Marea Estudio',
      concept: 'Nómina quincenal',
      essential: true,
      settled: false,
      actions: [],
    },
    {
      id: 'inv-b',
      businessId: DEMO_BUSINESS_ID,
      direction: 'inflow',
      amountCents: pesos(11_000),
      date: D(8),
      counterparty: 'Bruma Logística',
      concept: 'Factura F-1051',
      essential: false,
      settled: false,
      actions: [
        {
          id: 'action:C',
          obligationId: 'inv-b',
          kind: 'advance_receivable',
          approval: 'requires_agreement',
          label: 'Adelantar el cobro de Bruma Logística',
          counterparty: 'Bruma Logística',
          variants: [{ id: 'C1', toDate: D(2), discountBasisPoints: 200 }],
        },
      ],
    },
  ];
}

/** Obligaciones adicionales del negocio de la demo. Netean cero cada dia. */
function neutralObligations(today: EconomicDate): Obligation[] {
  const D = (n: number) => day(today, n);
  return [
    {
      id: 'rent',
      businessId: DEMO_BUSINESS_ID,
      direction: 'outflow',
      amountCents: pesos(1_200),
      date: D(1),
      counterparty: 'Inmobiliaria Sierra',
      concept: 'Renta de oficina',
      essential: true,
      settled: false,
      actions: [],
    },
    {
      id: 'inv-lumen-1',
      businessId: DEMO_BUSINESS_ID,
      direction: 'inflow',
      amountCents: pesos(1_200),
      date: D(1),
      counterparty: 'Lumen Digital',
      concept: 'Factura F-1039',
      essential: false,
      settled: false,
      actions: [],
    },
    {
      id: 'sup-fria',
      businessId: DEMO_BUSINESS_ID,
      direction: 'outflow',
      amountCents: pesos(2_400),
      date: D(4),
      counterparty: 'Nube Fría',
      concept: 'Licencias de almacenamiento',
      essential: false,
      settled: false,
      actions: [
        {
          id: 'action:D',
          obligationId: 'sup-fria',
          kind: 'defer',
          approval: 'requires_agreement',
          label: 'Aplazar el pago a Nube Fría',
          counterparty: 'Nube Fría',
          variants: [{ id: 'D1', toDate: D(9), feeCents: 0 }],
        },
      ],
    },
    {
      id: 'inv-onix',
      businessId: DEMO_BUSINESS_ID,
      direction: 'inflow',
      amountCents: pesos(2_400),
      date: D(4),
      counterparty: 'Ónix Manufactura',
      concept: 'Factura F-1047',
      essential: false,
      settled: false,
      actions: [],
    },
    {
      id: 'bank-fees',
      businessId: DEMO_BUSINESS_ID,
      direction: 'outflow',
      amountCents: pesos(900),
      date: D(6),
      counterparty: 'Banco del Norte',
      concept: 'Comisiones y licencias',
      essential: true,
      settled: false,
      actions: [],
    },
    {
      id: 'inv-lumen-2',
      businessId: DEMO_BUSINESS_ID,
      direction: 'inflow',
      amountCents: pesos(900),
      date: D(6),
      counterparty: 'Lumen Digital',
      concept: 'Factura F-1045',
      essential: false,
      settled: false,
      actions: [],
    },
  ];
}

function makeScenario(
  scenarioId: string,
  obligations: Obligation[],
  today: EconomicDate,
): ScenarioInput {
  return {
    businessId: DEMO_BUSINESS_ID,
    scenarioId,
    baseRevision: 0,
    openingBalanceCents: OPENING_BALANCE_CENTS,
    minimumCashCents: MINIMUM_CASH_CENTS,
    horizonStart: today,
    horizonDays: HORIZON_DAYS,
    obligations,
    excludedActionIds: [],
    demoToday: today,
  };
}

/** Caso numerico congelado de ARQUITECTURA.md seccion 3. */
export function oracleScenario(today: EconomicDate = DEFAULT_DEMO_TODAY): ScenarioInput {
  return makeScenario('scenario:oracle', baseObligations(today), today);
}

/** Negocio completo de la demo: 10 obligaciones. */
export function demoScenario(today: EconomicDate = DEFAULT_DEMO_TODAY): ScenarioInput {
  return makeScenario(
    'scenario:demo',
    [...baseObligations(today), ...neutralObligations(today)],
    today,
  );
}

/** Aplica la novedad de la demo: la factura F-1042 se retrasa a D8. */
export function withDelayedInvoiceA(input: ScenarioInput): ScenarioInput {
  const today = input.horizonStart;
  return {
    ...input,
    baseRevision: input.baseRevision + 1,
    obligations: input.obligations.map((ob) =>
      ob.id === 'inv-a' ? { ...ob, date: day(today, 8) } : ob,
    ),
  };
}

/** Excluye acciones por decision humana (rechazos de la demo). */
export function withExclusions(input: ScenarioInput, ids: string[]): ScenarioInput {
  return {
    ...input,
    baseRevision: input.baseRevision + 1,
    excludedActionIds: [...new Set([...input.excludedActionIds, ...ids])].sort(),
  };
}

/** Mensaje sintetico del cliente que dispara la demo. */
export const DEMO_MESSAGE =
  'Hola, les aviso que el pago de la factura F-1042 se nos recorre: tesoreria la programo para el 20 de septiembre. Disculpen la demora.';

/** Mensaje ambiguo: no permite fijar una fecha. */
export const AMBIGUOUS_MESSAGE =
  'Oigan, la factura de Arcadia se va a atrasar un poco, les aviso luego con calma.';
