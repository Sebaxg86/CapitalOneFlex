import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
import type { EngineResult, ReceivableSummary } from '@/domain/types';
import type { ViewSpecSection } from '@/server/ai/viewspec';
import { TEXTS } from '@/lib/texts';

/**
 * Facturas por cobrar. El adelanto se presenta siempre con su costo y como
 * condición pendiente: nunca como dinero asegurado.
 *
 * La ausencia de adelanto no se rotula: una fila que repite «sin opción de
 * adelanto» en cada factura solo añade ruido. Solo se escribe lo que existe.
 *
 * Reparto síntesis/detalle:
 * - Síntesis: cuántas facturas caen dentro del horizonte y por cuánto, cuántas
 *   fuera y por cuánto, y si alguna admite adelanto. Invariante: si se nombra
 *   un adelanto, su neto va SIEMPRE acompañado de su costo y de la condición.
 * - Detalle: la lista de facturas, una fila por factura.
 *
 * Puede pintarse a media anchura: las filas son de dos columnas, contraparte y
 * concepto a la izquierda, importe y fecha a la derecha.
 */
export interface ReceivablesProps {
  result: EngineResult;
  section: ViewSpecSection;
  parte: 'sintesis' | 'detalle';
}

/** Adelanto vigente de una factura: existe y el usuario no lo descartó. */
function tieneAdelantoVigente(item: ReceivableSummary): boolean {
  return item.advanceOptionId !== undefined && item.advanceExcluded !== true;
}

/**
 * Bloque compacto del adelanto. Nunca se pinta el neto sin su costo ni sin la
 * condición: el adelanto es una posibilidad negociada, no liquidez cerrada.
 */
function Adelanto({ item }: { item: ReceivableSummary }) {
  return (
    <div className="mt-1.5 rounded-tarjeta bg-aviso-suave px-2.5 py-1.5">
      <p className="text-cuerpo-sm text-aviso-texto">
        <span aria-hidden="true">◇ </span>
        <span className="font-semibold">{TEXTS.cobros.adelantoTitulo}</span>
        {item.advanceNetCents !== undefined ? (
          <>
            {' · '}
            {TEXTS.cobros.adelantoNetoEtiqueta}{' '}
            <span className="cifra font-semibold text-tinta">
              {formatCents(item.advanceNetCents)}
            </span>
          </>
        ) : null}
        {item.advanceCostCents !== undefined ? (
          <>
            {' · '}
            {TEXTS.cobros.adelantoCostoEtiqueta}{' '}
            <span className="cifra font-semibold text-tinta">
              {formatCents(item.advanceCostCents)}
            </span>
          </>
        ) : null}
        {item.advanceToDate !== undefined ? (
          <>
            {' · '}
            {TEXTS.cobros.adelantoFechaEtiqueta}{' '}
            <span className="cifra text-tinta">{formatEconomicDate(item.advanceToDate)}</span>
          </>
        ) : null}
      </p>
      {/* Invariante: el adelanto es una condición, nunca liquidez cerrada. */}
      <p className="text-pie text-aviso-texto">{TEXTS.cobros.adelantoCondicion}</p>
    </div>
  );
}

/** Una factura, en una fila que funciona a media anchura. */
function Factura({ item }: { item: ReceivableSummary }) {
  const adelantoDescartado = item.advanceOptionId !== undefined && item.advanceExcluded === true;

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="text-cuerpo-sm text-tinta">
          {/* Símbolo + texto: el horizonte no se señala solo con color. */}
          <span
            aria-hidden="true"
            className={item.withinHorizon ? 'text-tinta-tenue' : 'text-aviso-texto'}
          >
            {item.withinHorizon ? '✓' : '↦'}
          </span>{' '}
          <span className="font-semibold">{item.counterparty}</span>{' '}
          <span className="text-tinta-tenue">·</span>{' '}
          <span className="text-tinta-suave">{item.concept}</span>
        </span>
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className="cifra text-cuerpo-sm font-semibold text-tinta">
            {formatCents(item.amountCents)}
          </span>
          <span className="cifra text-cuerpo-sm text-tinta-suave">
            {formatEconomicDate(item.date)}
          </span>
          <span
            className={`text-pie ${item.withinHorizon ? 'text-tinta-tenue' : 'text-aviso-texto'}`}
          >
            {item.withinHorizon ? TEXTS.cobros.dentroHorizonte : TEXTS.cobros.fueraHorizonte}
          </span>
        </span>
      </div>

      {adelantoDescartado ? (
        /* El adelanto existe pero el usuario lo excluyó: una línea, sin caja. */
        <p className="mt-1 text-pie text-tinta-tenue">
          {TEXTS.cobros.adelantoTitulo} · {TEXTS.cobros.adelantoExcluido}
        </p>
      ) : null}

      {tieneAdelantoVigente(item) ? <Adelanto item={item} /> : null}
    </li>
  );
}

export default function Receivables({ result, parte }: ReceivablesProps) {
  const facturas = result.receivables;

  if (facturas.length === 0) {
    return (
      <p className="rounded-tarjeta border border-borde bg-superficie-tenue px-3 py-2 text-cuerpo-sm text-tinta-suave">
        {TEXTS.cobros.vacio}
      </p>
    );
  }

  if (parte === 'sintesis') {
    const dentro = facturas.filter((f) => f.withinHorizon);
    const fuera = facturas.filter((f) => !f.withinHorizon);
    const suma = (items: ReceivableSummary[]) =>
      items.reduce((total, item) => total + item.amountCents, 0);
    const conAdelanto = facturas.filter(tieneAdelantoVigente);

    return (
      <div className="space-y-2">
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="rotulo">
              <span aria-hidden="true">✓ </span>
              {TEXTS.cobros.dentroHorizonte}
            </dt>
            <dd className="mt-0.5 text-titular-sm text-tinta">
              <span className="cifra">{dentro.length}</span>{' '}
              <span className="cifra text-cuerpo text-tinta-suave">
                · {formatCents(suma(dentro))}
              </span>
            </dd>
          </div>
          <div>
            <dt className="rotulo">
              <span aria-hidden="true">↦ </span>
              {TEXTS.cobros.fueraHorizonte}
            </dt>
            <dd className="mt-0.5 text-titular-sm text-tinta">
              <span className="cifra">{fuera.length}</span>{' '}
              <span className="cifra text-cuerpo text-tinta-suave">
                · {formatCents(suma(fuera))}
              </span>
            </dd>
          </div>
        </dl>

        {/*
          Invariante: donde aparece un adelanto disponible aparecen su costo y
          su condición. Nunca el neto suelto.
        */}
        {conAdelanto.length > 0 ? (
          <ul className="space-y-1">
            {conAdelanto.map((item) => (
              <li key={item.obligationId}>
                <p className="text-cuerpo-sm text-aviso-texto">
                  <span aria-hidden="true">◇ </span>
                  <span className="font-semibold">{TEXTS.cobros.adelantoTitulo}</span> ·{' '}
                  {item.counterparty}
                  {item.advanceNetCents !== undefined ? (
                    <>
                      {' · '}
                      {TEXTS.cobros.adelantoNetoEtiqueta}{' '}
                      <span className="cifra font-semibold text-tinta">
                        {formatCents(item.advanceNetCents)}
                      </span>
                    </>
                  ) : null}
                  {item.advanceCostCents !== undefined ? (
                    <>
                      {' · '}
                      {TEXTS.cobros.adelantoCostoEtiqueta}{' '}
                      <span className="cifra font-semibold text-tinta">
                        {formatCents(item.advanceCostCents)}
                      </span>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
            <li className="text-pie text-aviso-texto">{TEXTS.cobros.adelantoCondicion}</li>
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-borde border-t border-borde">
      {facturas.map((item) => (
        <Factura key={item.obligationId} item={item} />
      ))}
    </ul>
  );
}
