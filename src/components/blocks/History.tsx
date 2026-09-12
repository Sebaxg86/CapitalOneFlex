import type { BeforeAfter } from '@/lib/contracts';
import { formatCents } from '@/domain/money';
import type { EngineResult } from '@/domain/types';
import type { ViewSpecSection } from '@/server/ai/viewspec';
import { TEXTS } from '@/lib/texts';

/**
 * Historial antes/después. Los eventos llegan de `/api/history`; el tipo es
 * laxo a propósito porque la forma exacta la fija la capa de persistencia.
 *
 * Invariante: una expectativa actualizada NO es un cobro recibido y un plan
 * aceptado NO es un pago ejecutado. Cada fila lo distingue con símbolo y texto
 * —no con el color— para que la diferencia se lea sin depender de la vista.
 * Si no hay eventos, se dice que no los hay: este componente nunca inventa
 * historial.
 *
 * Reparto síntesis/detalle:
 * - Síntesis: el último cambio registrado (su etiqueta y su detalle) y cuántos
 *   eventos hay en total.
 * - Detalle: los tres eventos más recientes y, plegado, el resto.
 *
 * CUIDADO con «antes → después»: la revisión anterior de cada fila se calcula
 * sobre la secuencia COMPLETA de eventos, no sobre los que están visibles. Si
 * se calculara sobre lo visible, el evento más antiguo de la ventana aparecería
 * como «estado inicial» y estaría mintiendo.
 *
 * El renderer coloca este bloque a ancho completo: la tabla se lee entera.
 */
export interface HistoryEntry {
  id: string;
  recordedAt: string;
  revision: number;
  eventType: string;
  label: string;
  detail?: string;
  kind?: string;
}

export interface HistoryProps {
  result: EngineResult;
  section: ViewSpecSection;
  parte: 'sintesis' | 'detalle';
  entries?: HistoryEntry[];
  beforeAfter?: BeforeAfter[];
}

type Categoria = keyof typeof TEXTS.historial.tipos;

/** Fila ya resuelta: el «antes» viene de la secuencia completa, no de la vista. */
interface Fila {
  entry: HistoryEntry;
  categoria: Categoria;
  antes: string;
}

/**
 * Tono de cada categoría. El acento queda reservado a las acciones, así que
 * las decisiones de escenario se separan por trazo y por su símbolo propio,
 * no por un color de marca.
 */
const CLASES: Record<Categoria, string> = {
  expectativa: 'border-aviso bg-aviso-suave text-aviso-texto',
  liquidado: 'border-ok bg-ok-suave text-ok-texto',
  escenario: 'border-borde-fuerte bg-superficie-suave text-tinta',
  resultado: 'border-borde bg-superficie-tenue text-tinta-suave',
  otro: 'border-borde bg-superficie text-tinta-tenue',
};

/** Clasifica sin inventar: solo a partir de `kind` y `eventType` del evento. */
export function classifyHistoryEntry(entry: Pick<HistoryEntry, 'eventType' | 'kind'>): Categoria {
  const texto = `${entry.kind ?? ''} ${entry.eventType ?? ''}`.toLowerCase();
  if (/settl|liquidad|payment_made|cobro_recibido|received/.test(texto)) return 'liquidado';
  if (/expect|reschedul|novedad|due_date|expectativa/.test(texto)) return 'expectativa';
  if (/scenario|escenario|plan|reject|exclu|constraint|restricc/.test(texto)) return 'escenario';
  if (/result|resultado|engine|motor/.test(texto)) return 'resultado';
  return 'otro';
}

const SELLO = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'UTC',
  dateStyle: 'short',
  timeStyle: 'short',
});

function formatSello(value: string): string {
  const fecha = new Date(value);
  return Number.isNaN(fecha.getTime()) ? value : SELLO.format(fecha);
}

/**
 * Ordena de más antiguo a más reciente y resuelve el «antes» de cada evento
 * contra su predecesor real. Devuelve las filas en orden inverso, de lo más
 * reciente a lo más antiguo, con el «antes» ya fijado.
 */
function construirFilas(entries: HistoryEntry[]): Fila[] {
  const ordenadas = [...entries].sort(
    (a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.revision - b.revision,
  );
  const filas = ordenadas.map((entry, index) => {
    const anterior = index === 0 ? null : ordenadas[index - 1].revision;
    return {
      entry,
      categoria: classifyHistoryEntry(entry),
      antes:
        anterior === null
          ? TEXTS.historial.estadoInicial
          : `${TEXTS.historial.revisionPrefijo} ${anterior}`,
    };
  });
  return filas.reverse();
}

function Etiqueta({ categoria }: { categoria: Categoria }) {
  return (
    <span
      className={`inline-block rounded-control border px-1.5 py-0.5 text-pie font-semibold ${CLASES[categoria]}`}
    >
      {TEXTS.historial.tipos[categoria].etiqueta}
    </span>
  );
}

function Tabla({ filas }: { filas: Fila[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-cuerpo-sm">
        <caption className="pb-2 text-pie text-tinta-tenue">
          {TEXTS.historial.tablaResumen}
        </caption>
        <thead>
          <tr className="border-b border-borde-fuerte bg-superficie-tenue text-left">
            <th scope="col" className="rotulo px-3 py-1.5">
              {TEXTS.historial.colRegistro}
            </th>
            <th scope="col" className="rotulo px-3 py-1.5">
              {TEXTS.historial.colRevisiones}
            </th>
            <th scope="col" className="rotulo w-[18%] px-3 py-1.5">
              {TEXTS.historial.colTipo}
            </th>
            <th scope="col" className="rotulo px-3 py-1.5">
              {TEXTS.historial.colCambio}
            </th>
            <th scope="col" className="rotulo px-3 py-1.5">
              {TEXTS.historial.colDetalle}
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map(({ entry, categoria, antes }) => (
            <tr key={entry.id} className="border-b border-borde align-top last:border-b-0">
              <th
                scope="row"
                className="cifra px-3 py-1 text-left text-cuerpo-sm font-normal text-tinta-suave"
              >
                {formatSello(entry.recordedAt)}
              </th>
              <td className="cifra px-3 py-1 text-tinta-suave">
                {antes} → {TEXTS.historial.revisionPrefijo} {entry.revision}
              </td>
              <td className="px-3 py-1">
                {/* Etiqueta con símbolo propio: la categoría no depende del color. */}
                <Etiqueta categoria={categoria} />
              </td>
              <td className="px-3 py-1 font-semibold text-tinta">{entry.label}</td>
              <td className="px-3 py-1 text-tinta-suave">{entry.detail ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function History({ entries, parte, beforeAfter }: HistoryProps) {
  const filas = construirFilas(entries ?? []);

  if (filas.length === 0) {
    return parte === 'sintesis' ? (
      <p className="text-cuerpo-sm text-tinta-suave">{TEXTS.historial.vacio}</p>
    ) : (
      <p className="text-pie text-tinta-tenue">{TEXTS.historial.vacioAyuda}</p>
    );
  }

  const ultima = filas[0];
  const comparison = beforeAfter?.filter(x=>x.beforeShortfallCents !== null && x.afterShortfallCents !== null).at(-1);

  if (parte === 'sintesis') {
    return (
      <div className="space-y-1.5">
        {comparison && <div className="grid grid-cols-2 gap-3 rounded-panel bg-acento-suave p-4 mb-3">
          <div><p className="text-sm">Antes faltaban</p><p className="text-xl cifra font-semibold">{formatCents(comparison.beforeShortfallCents!)}</p></div>
          <div><p className="text-sm">Después faltan</p><p className="text-xl cifra font-semibold">{formatCents(comparison.afterShortfallCents!)}</p></div>
        </div>}
        {/*
          La etiqueta ya nombra el tipo de evento: repetir `entry.label` al lado
          lo imprimía dos veces seguidas. Aquí va la etiqueta y el detalle.
        */}
        <p className="flex flex-wrap items-baseline gap-x-2 text-cuerpo-sm">
          <Etiqueta categoria={ultima.categoria} />
          {ultima.entry.detail ? (
            <span className="text-tinta">{ultima.entry.detail}</span>
          ) : (
            <span className="font-semibold text-tinta">{ultima.entry.label}</span>
          )}
        </p>
        <p className="text-pie text-tinta-tenue">
          <span className="cifra">{formatSello(ultima.entry.recordedAt)}</span>
          {' · '}
          <span className="cifra">
            {ultima.antes} → {TEXTS.historial.revisionPrefijo} {ultima.entry.revision}
          </span>
          {' · '}
          <span className="cifra font-semibold text-tinta-suave">{filas.length}</span>{' '}
          {TEXTS.historial.eventosContador}
        </p>
      </div>
    );
  }

  const recientes = filas.slice(0, 3);
  const resto = filas.slice(3);

  return (
    <div className="space-y-3">
      <Tabla filas={recientes} />

      {resto.length > 0 ? (
        <details className="rounded-tarjeta border border-borde bg-superficie-tenue px-3 py-2">
          <summary className="cursor-pointer text-cuerpo-sm font-semibold text-tinta">
            {TEXTS.historial.verAnteriores}{' '}
            <span className="cifra font-normal text-tinta-tenue">({resto.length})</span>
          </summary>
          <div className="mt-2">
            <Tabla filas={resto} />
          </div>
        </details>
      ) : null}

      {/*
       * La leyenda repite lo que ya dice la nota de cada etiqueta, así que se
       * pliega: disponible para quien la necesite, fuera del camino del resto.
       */}
      <details className="rounded-tarjeta border border-borde bg-superficie-tenue px-3 py-2">
        <summary className="cursor-pointer text-cuerpo-sm font-semibold text-tinta">
          {TEXTS.historial.leyendaTitulo}
        </summary>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-pie text-tinta-suave">
          {TEXTS.historial.leyenda.map((linea) => (
            <li key={linea}>{linea}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
