import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
import type { EngineResult, Plan } from '@/domain/types';
import type { ViewSpecSection } from '@/server/ai/viewspec';
import { TEXTS } from '@/lib/texts';

/**
 * Comparador de planes (máximo tres, ya ordenados por el motor).
 *
 * CASO ESPECIAL DEL PLEGADO. Este bloque es el que más restricciones tiene: la
 * síntesis, que está siempre visible, debe bastar para decidir. Por eso lleva,
 * para CADA alternativa, sus tres cifras principales (costo, saldo mínimo
 * resultante y compromisos modificados), el aviso «Todavía no es dinero
 * disponible» y TODAS sus condiciones pendientes con la contraparte. Un
 * genérico «hay condiciones» no vale. Los botones de excluir también viven en
 * la síntesis: son controles esenciales.
 *
 * Al detalle solo bajan los desgloses secundarios: las acciones del plan con su
 * costo y el día en que se toca el saldo mínimo.
 *
 * Esta síntesis puede ocupar varias líneas. No se trunca para cumplir una
 * altura: se prefiere una página más alta a una vista que oculta una condición.
 *
 * El renderer coloca este bloque a ancho completo, así que los planes se
 * pintan lado a lado. Las bandas de cada tarjeta comparten las filas de la
 * rejilla mediante `grid-rows-subgrid`: las cifras y las condiciones quedan a
 * la misma altura en todas las columnas y se pueden comparar en horizontal. En
 * móvil cada plan se apila y la rejilla vuelve a una sola columna.
 */
export interface PlanComparisonProps {
  result: EngineResult;
  section: ViewSpecSection;
  parte: 'sintesis' | 'detalle';
  /** Excluye la acción del escenario y fuerza un recálculo del motor. */
  onReject?: (optionId: string) => void;
  /** Acción cuyo rechazo está en vuelo. */
  rejectingOptionId?: string | null;
  busy?: boolean;
  onSelect?: (planId: string) => void;
  selectedPlanId?: string | null;
}

/** Tailwind necesita las clases completas: el motor nunca devuelve más de tres. */
const COLUMNAS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
};

/** Las cuatro bandas comparables de la síntesis. */
const FILAS_SINTESIS = 'lg:grid-rows-[auto_auto_auto_auto]';
/** Las dos bandas comparables del detalle. */
const FILAS_DETALLE = 'lg:grid-rows-[auto_auto]';

function PlanSintesis({
  plan,
  onReject,
  rejectingOptionId,
  busy,
  onSelect,
  selectedPlanId,
}: {
  plan: Plan;
  onReject?: (optionId: string) => void;
  rejectingOptionId?: string | null;
  busy?: boolean;
  onSelect?: (planId: string) => void;
  selectedPlanId?: string | null;
}) {
  // Un mismo plan puede tocar varias obligaciones: un botón por acción distinta.
  const opciones = plan.actions.filter(
    (action, index) => plan.actions.findIndex((a) => a.optionId === action.optionId) === index,
  );

  return (
    <li
      data-plan={plan.id}
      className={`tarjeta grid content-start gap-y-2.5 p-3 lg:row-span-4 lg:grid-rows-subgrid ${
        plan.conditional ? 'border-aviso' : 'border-borde'
      }`}
    >
      {/* 1. La descripción del plan aparece UNA sola vez, como título. */}
      <div><h3 className="text-cuerpo font-semibold text-tinta">{plan.actions.map(a => ({defer:'Pagar más tarde',split:'Pagar en dos partes',advance_receivable:'Cobrar antes'}[a.kind])).filter((v,i,a)=>a.indexOf(v)===i).join(' + ')}</h3>
      <ul className="mt-2 space-y-2 text-sm text-tinta">
        {opciones.map(action => <li key={action.optionId}>
          <span className="font-semibold">{action.counterparty}: </span>{action.description}
        </li>)}
      </ul></div>

      {/* 2. Cifras comparables entre columnas. */}
      <dl className="grid grid-cols-2 gap-x-3">
        <div>
          <dt className="rotulo">{TEXTS.planes.costoEtiqueta}</dt>
          <dd className="cifra mt-0.5 text-titular-sm text-tinta">{formatCents(plan.costCents)}</dd>
        </div>
        <div>
          <dt className="rotulo">{TEXTS.planes.saldoMinimoEtiqueta}</dt>
          <dd className="cifra mt-0.5 text-titular-sm text-tinta">
            {formatCents(plan.minimumClosingCents)}
          </dd>
        </div>

      </dl>

      {/*
       * 3. Condición de aceptación: siempre visible, nunca plegada, y con la
       * lista COMPLETA de condiciones pendientes y su contraparte.
       */}
      {plan.conditional ? (
        <div className="rounded-tarjeta border border-aviso bg-aviso-suave px-2.5 py-2">
          <p className="text-cuerpo-sm font-semibold text-aviso-texto">
            <span aria-hidden="true">⚠ </span>
            {TEXTS.planes.condicionalAviso}
          </p>
          {plan.pendingConditions.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-pie text-tinta">
              {plan.pendingConditions.map((condition) => (
                <li key={condition.optionId}>
                  <span className="font-semibold">{condition.counterparty}: </span>
                  {condition.text.replace(/Solo es posible si .*? acepta\. Hasta entonces no es dinero disponible\./, 'Necesita aceptar el acuerdo.')}{' '}
                  <span className="text-tinta-tenue">
                    ({TEXTS.planes.condicionAprobacion[condition.approval]})
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-cuerpo-sm text-ok-texto">
          <span aria-hidden="true">✓ </span>
          {TEXTS.planes.noCondicional}
        </p>
      )}

      {/*
       * 4. Excluir una acción la saca de TODO el escenario, no solo de esta
       * tarjeta. La etiqueta nombra la contraparte afectada; el alcance real lo
       * explica el texto de ayuda, no un botón convertido en párrafo.
       */}
      <div>
        {onSelect && <button type="button" className="boton-principal mb-3 w-full" disabled={busy} onClick={()=>onSelect(plan.id)}>{selectedPlanId === plan.id ? 'Opción elegida para negociar' : 'Quiero intentar esta opción'}</button>}
        {selectedPlanId === plan.id && <p className="mb-3 text-sm text-tinta-suave">Pendiente de acuerdo. Tus pagos todavía no cambian.</p>}
        {onReject ? (
          <>
            <div className="flex flex-wrap gap-2">
              {opciones.map((action) => {
                const enVuelo = rejectingOptionId === action.optionId;
                return (
                  <button
                    key={action.optionId}
                    type="button"
                    onClick={() => onReject(action.optionId)}
                    disabled={busy === true || enVuelo}
                    className="boton-descartar"
                  >
                    <span aria-hidden="true">✗</span>
                    {enVuelo
                      ? TEXTS.planes.rechazando
                      : `${TEXTS.planes.excluirPrefijo} ${action.counterparty}`}
                  </button>
                );
              })}
            </div>

          </>
        ) : null}
      </div>
    </li>
  );
}

/** Desglose secundario: acciones con su costo y día del saldo mínimo. */
function PlanDetalle({ plan }: { plan: Plan }) {
  // Sin `data-plan`: el plan lo identifica su tarjeta de síntesis, una sola vez.
  return (
    <li className="grid content-start gap-y-2 lg:row-span-2 lg:grid-rows-subgrid">
      <div>
        <h3 className="text-cuerpo-sm font-semibold text-tinta">{plan.label}</h3>
        <p className="mt-0.5 text-pie text-tinta-suave">
          {TEXTS.planes.saldoMinimoFechaEtiqueta}:{' '}
          <span className="cifra text-tinta">{formatEconomicDate(plan.minimumClosingDate)}</span>
        </p>
        {plan.conditional ? (
          <p className="mt-0.5 text-pie text-tinta-suave">{TEXTS.planes.condicionalCuerpo}</p>
        ) : null}
      </div>

      <div>
        <h4 className="rotulo">{TEXTS.planes.accionesTitulo}</h4>
        <ul className="mt-1 divide-y divide-borde border-t border-borde">
          {plan.actions.map((action) => (
            <li
              key={`${action.optionId}:${action.variantId}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 py-1 text-cuerpo-sm"
            >
              <span className="text-tinta">{action.counterparty}</span>
              <span className="cifra text-tinta-suave">
                {TEXTS.planes.accionCostoEtiqueta}: {formatCents(action.costCents)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export default function PlanComparison({
  result,
  parte,
  onReject,
  rejectingOptionId,
  busy,
  onSelect,
  selectedPlanId,
}: PlanComparisonProps) {
  if (result.plans.length === 0) return null;

  const columnas = COLUMNAS[result.plans.length] ?? COLUMNAS[3];

  if (parte === 'detalle') {
    return (
      <ul className={`grid gap-x-5 gap-y-4 ${columnas} ${FILAS_DETALLE}`}>
        {result.plans.map((plan) => (
          <PlanDetalle key={plan.id} plan={plan} />
        ))}
      </ul>
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm text-tinta-suave">{TEXTS.planes.beneficio}</p>
    <ul className={`grid gap-x-4 gap-y-4 ${columnas} ${FILAS_SINTESIS}`}>
      {result.plans.map((plan) => (
        <PlanSintesis
          key={plan.id}
          plan={plan}
          onReject={onReject}
          rejectingOptionId={rejectingOptionId}
          busy={busy}
          onSelect={onSelect}
          selectedPlanId={selectedPlanId}
        />
      ))}
    </ul>
    </div>
  );
}
