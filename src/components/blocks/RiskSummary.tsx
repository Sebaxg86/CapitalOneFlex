import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
import type { EngineResult, RiskItem } from '@/domain/types';
import type { ViewSpecSection } from '@/server/ai/viewspec';
import { TEXTS, severityLabel } from '@/lib/texts';

/**
 * Resumen de riesgo. Todas las cifras salen de `EngineResult`; el modelo no
 * aporta importes. Si el escenario es inviable, la interfaz lo dice con su
 * faltante residual y el alcance literal de esa conclusión.
 *
 * Lectura correcta del faltante: hay UN solo déficit diario frente a la caja
 * mínima. Los riesgos son las consecuencias de ese mismo déficit vistas desde
 * cada compromiso esencial, no faltantes que se sumen. Por eso el importe
 * global se muestra una única vez, como dato principal, y cada riesgo lleva el
 * importe de SU compromiso, nunca el faltante repetido.
 *
 * Reparto síntesis/detalle:
 * - Síntesis: saldo de cierre más bajo, su día y cuántos compromisos quedan
 *   afectados. Con los detalles cerrados la vista sigue diciendo algo útil.
 * - Detalle: la lista de compromisos afectados, uno por línea.
 *
 * Puede pintarse a media anchura: el bloque se apila en una sola columna.
 */
export interface RiskSummaryProps {
  result: EngineResult;
  section: ViewSpecSection;
  parte: 'sintesis' | 'detalle';
}

type Severidad = RiskItem['severity'];

/** El significado nunca viaja solo en el color: cada severidad lleva símbolo. */
const MARCA_SEVERIDAD: Record<Severidad, string> = {
  high: '▲',
  medium: '△',
  low: '·',
};

const TONO_SEVERIDAD: Record<Severidad, string> = {
  high: 'text-alerta-texto',
  medium: 'text-aviso-texto',
  low: 'text-tinta-tenue',
};

/**
 * Importe del compromiso afectado por el riesgo. Se resuelve contra las
 * restricciones del motor, que sí conservan el importe de cada obligación
 * esencial. Si no se puede resolver, no se inventa: se omite la cifra.
 */
function importeDelCompromiso(result: EngineResult, risk: RiskItem): number | undefined {
  if (risk.obligationId === undefined) return undefined;
  const constraint = result.constraints.find(
    (c) => c.obligationId === risk.obligationId && c.amountCents !== undefined,
  );
  return constraint?.amountCents;
}

export default function RiskSummary({ result, parte }: RiskSummaryProps) {
  const { baseline, risks, infeasibility } = result;
  const conFaltante = baseline.shortfallCents > 0;

  if (parte === 'sintesis') {
    return (
      <div className="space-y-2">
        {/*
          El faltante total NO se repite aquí: ya lo declara la línea de estado
          del cascarón, que está siempre presente y no la compone el modelo.
          Esta síntesis aporta qué día se toca fondo, con cuánto, y a cuántos
          compromisos alcanza.
        */}
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="rotulo">{TEXTS.riesgo.saldoMinimoEtiqueta}</dt>
            <dd className="cifra mt-0.5 text-titular-sm text-tinta">
              {formatCents(baseline.minimumClosingCents)}
            </dd>
          </div>
          <div>
            <dt className="rotulo">{TEXTS.riesgo.saldoMinimoFechaEtiqueta}</dt>
            <dd className="cifra mt-0.5 text-titular-sm text-tinta">
              {formatEconomicDate(baseline.minimumClosingDate)}
            </dd>
          </div>
          <div>
            <dt className="rotulo">{TEXTS.riesgo.listaTitulo}</dt>
            <dd className="cifra mt-0.5 text-titular-sm text-tinta">{risks.length}</dd>
          </div>
        </dl>

        {risks.length === 0 && !conFaltante ? (
          <p className="text-cuerpo-sm text-ok-texto">
            <span aria-hidden="true">✓ </span>
            {TEXTS.riesgo.sinRiesgoTitulo}
          </p>
        ) : null}

        {/*
          El bloqueo NO se explica aquí. El faltante residual ya lo declara la
          línea de estado del cascarón, y el detalle completo (motivo, alcance y
          restricciones implicadas) vive en «Restricciones».
        */}
        {infeasibility ? (
          <p className="text-cuerpo-sm text-alerta-texto">
            <span aria-hidden="true">✗ </span>
            {TEXTS.riesgo.bloqueoRemite}
          </p>
        ) : null}
      </div>
    );
  }

  if (risks.length === 0) {
    return <p className="text-cuerpo-sm text-tinta-suave">{TEXTS.riesgo.sinRiesgoCuerpo}</p>;
  }

  return (
    <section aria-labelledby="riesgo-consecuencias">
      <h3 id="riesgo-consecuencias" className="rotulo">
        {TEXTS.riesgo.listaTitulo}
      </h3>
      {/*
       * Lista compacta de consecuencias. El importe de cada fila es el del
       * compromiso comprometido, no el faltante: repetirlo haría creer que los
       * déficits se acumulan.
       */}
      <ul className="mt-2 divide-y divide-borde border-t border-borde">
        {risks.map((risk) => {
          const importe = importeDelCompromiso(result, risk);
          return (
            <li
              key={risk.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5"
            >
              <span className="text-cuerpo-sm text-tinta">
                <span aria-hidden="true" className={TONO_SEVERIDAD[risk.severity]}>
                  {MARCA_SEVERIDAD[risk.severity]}
                </span>{' '}
                {risk.title} <span className="text-tinta-tenue">·</span>{' '}
                <span className="cifra">{formatEconomicDate(risk.date)}</span>
              </span>
              <span className="flex flex-wrap items-baseline gap-x-3">
                {importe !== undefined ? (
                  <span className="cifra text-cuerpo-sm font-semibold text-tinta">
                    {formatCents(importe)}
                  </span>
                ) : null}
                <span className={`text-pie ${TONO_SEVERIDAD[risk.severity]}`}>
                  {TEXTS.riesgo.severidadEtiqueta}: {severityLabel(risk.severity)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
