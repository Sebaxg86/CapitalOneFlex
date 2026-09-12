import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
import type { DailyBalance, EngineResult, PendingOutsideHorizon } from '@/domain/types';
import type { ViewSpecSection } from '@/server/ai/viewspec';
import { TEXTS } from '@/lib/texts';

/**
 * Calendario de caja: saldo de cierre por día, con la línea de caja mínima
 * dibujada sobre cada barra. Los días que cierran por debajo del mínimo se
 * marcan con símbolo y texto, no solo con color.
 *
 * Reparto síntesis/detalle:
 * - Síntesis: saldo más bajo del horizonte con su día, cuántos días cierran
 *   bajo la caja mínima y qué queda vencido después del horizonte.
 * - Detalle: la tabla de los siete días, la nota de intradía y la lista de
 *   vencimientos posteriores.
 *
 * El renderer coloca este bloque SIEMPRE a ancho completo: la tabla cabe en
 * escritorio sin desplazamiento horizontal y el ancho mínimo solo actúa en
 * pantallas estrechas, donde el contenedor sí permite desplazar.
 */
export interface CashCalendarProps {
  result: EngineResult;
  section: ViewSpecSection;
  parte: 'sintesis' | 'detalle';
}

/** Escala común a todas las barras: incluye el cero y la caja mínima. */
function buildScale(days: DailyBalance[], minimumCashCents: number) {
  const valores = days.map((d) => d.closingCents);
  const lo = Math.min(0, minimumCashCents, ...valores);
  const hi = Math.max(minimumCashCents, ...valores);
  const span = hi - lo;
  const pct = (value: number) => (span === 0 ? 0 : ((value - lo) / span) * 100);
  return { pct };
}

const acotar = (valor: number) => Math.max(0, Math.min(100, valor));

/** Totales de lo que vence después del último día del horizonte, por sentido. */
function totalesPosteriores(items: readonly PendingOutsideHorizon[]) {
  let cobros = 0;
  let pagos = 0;
  for (const item of items) {
    if (item.direction === 'inflow') cobros += item.amountCents;
    else pagos += item.amountCents;
  }
  return { cobros, pagos };
}

function Pendiente({ item }: { item: PendingOutsideHorizon }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5 text-cuerpo-sm">
      <span className="text-tinta">
        <span className="font-semibold">{TEXTS.calendario.direccion[item.direction]}</span>{' '}
        {item.counterparty} · {item.concept}
        {item.movedByPlan ? (
          <span className="ml-2 text-pie text-aviso-texto">
            <span aria-hidden="true">↪ </span>
            {TEXTS.calendario.pendienteMovido}
          </span>
        ) : null}
      </span>
      <span className="cifra text-tinta-suave">
        {formatEconomicDate(item.date)} · {formatCents(item.amountCents)}
      </span>
    </li>
  );
}

export default function CashCalendar({ result, parte }: CashCalendarProps) {
  const days = result.baseline.dailyBalances;
  const minimo = result.minimumCashCents;
  const posteriores = result.pendingOutsideHorizon;

  if (parte === 'sintesis') {
    const diasBajo = days.filter((d) => d.closingCents < minimo).length;
    const { cobros, pagos } = totalesPosteriores(posteriores);

    return (
      <div className="space-y-2">
        {/*
          El saldo más bajo y su día NO se repiten aquí. Están garantizados
          fuera de la composición: la línea de estado del cascarón los declara
          cuando la semana está cubierta, y cuando hay faltante el servidor
          obliga a mostrar el resumen de riesgo, que los lleva. Este bloque
          aporta lo suyo: cuántos días caen bajo el mínimo y qué queda vencido
          después del horizonte.
        */}
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="rotulo">{TEXTS.calendario.diasHorizonteEtiqueta}</dt>
            <dd className="cifra mt-0.5 text-titular-sm text-tinta">
              {days.length} <span className="text-cuerpo-sm text-tinta-suave">
                {formatEconomicDate(result.horizon.start)} – {formatEconomicDate(result.horizon.end)}
              </span>
            </dd>
          </div>
          <div>
            {/* Símbolo + texto: los días en rojo no se cuentan solo por color. */}
            <dt className="rotulo">{TEXTS.calendario.diasBajoMinimoEtiqueta}</dt>
            <dd
              className={`cifra mt-0.5 text-titular-sm ${
                diasBajo > 0 ? 'text-alerta-texto' : 'text-tinta'
              }`}
            >
              {diasBajo}
            </dd>
          </div>
          <div>
            <dt className="rotulo">{TEXTS.calendario.pendientesTitulo}</dt>
            <dd className="mt-0.5 text-cuerpo text-tinta">
              {posteriores.length === 0 ? (
                <span className="text-tinta-suave">{TEXTS.calendario.pendientesVacio}</span>
              ) : (
                <>
                  <span className="cifra text-titular-sm">{posteriores.length}</span>{' '}
                  <span className="text-cuerpo-sm text-tinta-suave">
                    {pagos > 0 ? (
                      <>
                        {TEXTS.calendario.direccion.outflow}{' '}
                        <span className="cifra">{formatCents(pagos)}</span>
                      </>
                    ) : null}
                    {pagos > 0 && cobros > 0 ? ' · ' : null}
                    {cobros > 0 ? (
                      <>
                        {TEXTS.calendario.direccion.inflow}{' '}
                        <span className="cifra">{formatCents(cobros)}</span>
                      </>
                    ) : null}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
        <p className="text-pie text-tinta-tenue">
          {TEXTS.calendario.lineaMinimaEtiqueta}:{' '}
          <span className="cifra font-semibold text-tinta-suave">{formatCents(minimo)}</span>
        </p>
      </div>
    );
  }

  const { pct } = buildScale(days, minimo);
  const lineaPct = acotar(pct(minimo));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-cuerpo-sm">
          <caption className="pb-2 text-pie text-tinta-tenue">
            {TEXTS.calendario.tablaResumen} {TEXTS.calendario.lineaMinimaLeyenda}
          </caption>
          <thead>
            <tr className="border-b border-borde-fuerte bg-superficie-tenue text-left">
              <th scope="col" className="rotulo px-3 py-1.5">
                {TEXTS.calendario.colDia}
              </th>
              <th scope="col" className="rotulo px-3 py-1.5 text-right">
                {TEXTS.calendario.colCobros}
              </th>
              <th scope="col" className="rotulo px-3 py-1.5 text-right">
                {TEXTS.calendario.colPagos}
              </th>
              <th scope="col" className="rotulo px-3 py-1.5 text-right">
                {TEXTS.calendario.colCierre}
              </th>
              <th scope="col" className="rotulo w-[24%] px-3 py-1.5">
                {TEXTS.calendario.colNivel}
              </th>
              <th scope="col" className="rotulo px-3 py-1.5">
                {TEXTS.calendario.colEstado}
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const bajo = day.closingCents < minimo;
              return (
                <tr
                  key={day.date}
                  className={`border-b border-borde last:border-b-0 ${
                    bajo ? 'bg-alerta-suave' : ''
                  }`}
                >
                  <th
                    scope="row"
                    className="cifra px-3 py-1 text-left text-cuerpo-sm font-semibold text-tinta"
                  >
                    {formatEconomicDate(day.date)}
                  </th>
                  <td className="cifra px-3 py-1 text-right text-tinta-suave">
                    {formatCents(day.inflowCents)}
                  </td>
                  <td className="cifra px-3 py-1 text-right text-tinta-suave">
                    {formatCents(day.outflowCents)}
                  </td>
                  <td
                    className={`cifra px-3 py-1 text-right font-semibold ${
                      bajo ? 'text-alerta-texto' : 'text-tinta'
                    }`}
                  >
                    <span aria-hidden="true">{bajo ? '▼ ' : ''}</span>
                    {formatCents(day.closingCents)}
                  </td>
                  <td className="px-3 py-1">
                    <div
                      aria-hidden="true"
                      className="relative h-2.5 w-full min-w-[6rem] rounded-control border border-borde bg-superficie-suave"
                    >
                      {/* Verde cuando el cierre alcanza la caja mínima; rojo cuando no. */}
                      <div
                        className={`h-full rounded-l-control ${bajo ? 'bg-alerta' : 'bg-ok'}`}
                        style={{ width: `${acotar(pct(day.closingCents))}%` }}
                      />
                      {/* Línea de caja mínima, común a todas las barras. */}
                      <div
                        className="absolute -inset-y-0.5 w-0.5 bg-tinta"
                        style={{ left: `${lineaPct}%` }}
                      />
                    </div>
                  </td>
                  <td
                    className={`px-3 py-1 ${
                      bajo ? 'font-semibold text-alerta-texto' : 'text-tinta-suave'
                    }`}
                  >
                    {bajo ? TEXTS.calendario.estadoBajoMinimo : TEXTS.calendario.estadoSobreMinimo}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/*
       * Nota metodológica: vive junto a la tabla que explica, colapsada para no
       * competir con los saldos. El texto lo fija el motor.
       */}
      <details className="rounded-tarjeta border border-borde bg-superficie-tenue px-3 py-2">
        <summary className="cursor-pointer text-cuerpo-sm font-semibold text-tinta">
          {TEXTS.shell.notaIntradiaTitulo}
        </summary>
        <p className="mt-1.5 text-cuerpo-sm text-tinta-suave">{result.diagnostics.intradayNote}</p>
      </details>

      <section aria-labelledby="calendario-pendientes">
        <h3 id="calendario-pendientes" className="rotulo">
          {TEXTS.calendario.pendientesTitulo}
        </h3>
        <p className="mt-1 text-pie text-tinta-tenue">{TEXTS.calendario.pendientesAyuda}</p>
        {posteriores.length === 0 ? (
          <p className="mt-1.5 text-cuerpo-sm text-tinta-suave">
            {TEXTS.calendario.pendientesVacio}
          </p>
        ) : (
          <ul className="mt-1.5 divide-y divide-borde border-t border-borde">
            {posteriores.map((item) => (
              <Pendiente key={`${item.obligationId}:${item.date}:${item.amountCents}`} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
