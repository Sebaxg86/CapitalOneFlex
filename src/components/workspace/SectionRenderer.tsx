'use client';

import { useState, type ReactNode } from 'react';
import type { EngineResult } from '@/domain/types';
import {
  COMPONENT_LABELS,
  COMPONENT_TYPES,
  resolveFactTokens,
  type ComponentType,
  type Emphasis,
  type ViewSpec,
  type ViewSpecSection,
} from '@/server/ai/viewspec';
import { TEXTS } from '@/lib/texts';
import RiskSummary from '@/components/blocks/RiskSummary';
import CashCalendar from '@/components/blocks/CashCalendar';
import Receivables from '@/components/blocks/Receivables';
import PlanComparison from '@/components/blocks/PlanComparison';
import Constraints from '@/components/blocks/Constraints';
import History, { type HistoryEntry } from '@/components/blocks/History';

/**
 * Renderiza la composición validada.
 *
 * GRAMÁTICA ESPACIAL. El modelo decide selección, orden y énfasis; el renderer
 * aplica una gramática pública y determinista, igual para cualquier permutación
 * de los seis componentes:
 *
 * - Las secciones se recorren EN EL ORDEN recibido. Nunca se reordenan por
 *   énfasis: protagonismo no es lo mismo que precedencia. Un `high` al final
 *   se queda al final.
 * - `high` abre fila y ocupa el ancho completo.
 * - `normal` y `low` comparten fila solo si son consecutivos y ambos admiten
 *   media anchura. Nunca se busca un bloque posterior para rellenar un hueco.
 * - Tres componentes piden ancho completo siempre, con cualquier énfasis,
 *   porque llevan tabla o comparación en columnas: el comparador de planes, el
 *   calendario y el historial. El énfasis sigue controlando su tratamiento.
 * - En móvil, una sola columna en el mismo orden.
 *
 * Defensa en profundidad: aunque el servidor ya valida el catálogo cerrado,
 * aquí se vuelve a filtrar. Un tipo desconocido no se renderiza.
 */
export interface SectionRendererProps {
  spec: ViewSpec;
  result: EngineResult;
  /** Comprobaciones que impuso el servidor sobre la propuesta del modelo. */
  enforcement?: string[];
  historyEntries?: HistoryEntry[];
  onRejectAction?: (optionId: string) => void;
  rejectingOptionId?: string | null;
  busy?: boolean;
}

const CATALOGO: ReadonlySet<string> = new Set<string>(COMPONENT_TYPES);

/**
 * Componentes que necesitan el ancho completo para poder leerse: alinean
 * columnas entre alternativas o llevan una tabla que no cabe a media anchura.
 */
const ANCHO_COMPLETO: ReadonlySet<ComponentType> = new Set<ComponentType>([
  'plan_comparison',
  'cash_calendar',
  'history',
]);

/**
 * Función pura: qué bloques del catálogo produce una composición, en orden.
 * Ignora tipos desconocidos y repetidos. No toca el DOM ni React.
 */
export function selectBlocksForSpec(spec: ViewSpec): ComponentType[] {
  const vistos = new Set<ComponentType>();
  const bloques: ComponentType[] = [];
  for (const section of spec?.sections ?? []) {
    const type = section?.type;
    if (typeof type !== 'string' || !CATALOGO.has(type)) continue;
    if (vistos.has(type)) continue;
    vistos.add(type);
    bloques.push(type);
  }
  return bloques;
}

/**
 * REGLA DE APERTURA. Nace abierto un único bloque: el PRIMERO, en el orden
 * recibido, que tenga el mayor énfasis presente en la composición.
 *
 * Es pública y determinista, como la de anchuras, y funciona en los casos
 * degenerados: si todo es `high`, `normal` o `low`, abre el primero; si hay una
 * sola sección, abre esa; un `high` al final abre allí y no sube de posición.
 * El modelo sigue decidiendo qué existe, en qué orden, con qué relevancia y
 * cuál se abre primero; no es un filtro que elimine decisiones suyas.
 */
const ORDEN_ENFASIS: readonly Emphasis[] = ['high', 'normal', 'low'];

export function indiceAbiertoInicial(secciones: ViewSpecSection[]): number {
  if (secciones.length === 0) return -1;
  for (const nivel of ORDEN_ENFASIS) {
    const indice = secciones.findIndex((s) => s.emphasis === nivel);
    if (indice !== -1) return indice;
  }
  return 0;
}

/** Una sección ocupa la fila entera por su énfasis o por su contenido. */
export function ocupaFilaCompleta(section: ViewSpecSection): boolean {
  return section.emphasis === 'high' || ANCHO_COMPLETO.has(section.type);
}

/**
 * Agrupa las secciones en filas de una o dos columnas, sin reordenarlas.
 * Función pura: la gramática se puede verificar sin renderizar nada.
 */
export function agruparEnFilas(secciones: ViewSpecSection[]): ViewSpecSection[][] {
  const filas: ViewSpecSection[][] = [];
  let i = 0;
  while (i < secciones.length) {
    const actual = secciones[i];
    const siguiente = secciones[i + 1];
    if (!ocupaFilaCompleta(actual) && siguiente && !ocupaFilaCompleta(siguiente)) {
      filas.push([actual, siguiente]);
      i += 2;
      continue;
    }
    filas.push([actual]);
    i += 1;
  }
  return filas;
}

/**
 * El énfasis se expresa con superficie, trazo, aire y tamaño de titular, no
 * con color de acento: así no depende de la percepción cromática y sigue
 * siendo legible en cualquier posición de la rejilla.
 */
const ESTILOS: Record<Emphasis, { contenedor: string; titulo: string; nota: string }> = {
  high: {
    contenedor: 'tarjeta border-borde-fuerte shadow-nivel1 p-5 sm:p-6',
    titulo: 'text-titular-md',
    nota: 'text-cuerpo text-tinta-suave',
  },
  normal: {
    contenedor: 'tarjeta p-4 sm:p-5',
    titulo: 'text-titular-sm',
    nota: 'text-cuerpo-sm text-tinta-suave',
  },
  low: {
    contenedor: 'tarjeta bg-superficie-tenue p-4',
    titulo: 'text-cuerpo font-semibold text-tinta-suave',
    nota: 'text-cuerpo-sm text-tinta-tenue',
  },
};

function renderBlock(
  type: ComponentType,
  section: ViewSpecSection,
  props: SectionRendererProps,
  parte: 'sintesis' | 'detalle',
): ReactNode {
  const { result, historyEntries, onRejectAction, rejectingOptionId, busy } = props;
  const comun = { result, section, parte } as const;
  switch (type) {
    case 'risk_summary':
      return <RiskSummary {...comun} />;
    case 'cash_calendar':
      return <CashCalendar {...comun} />;
    case 'receivables':
      return <Receivables {...comun} />;
    case 'plan_comparison':
      return (
        <PlanComparison
          {...comun}
          onReject={onRejectAction}
          rejectingOptionId={rejectingOptionId}
          busy={busy}
        />
      );
    case 'constraints':
      return <Constraints {...comun} />;
    case 'history':
      return <History {...comun} entries={historyEntries} />;
    default:
      return null;
  }
}

/**
 * Una sección: síntesis siempre visible + detalle plegable.
 *
 * La síntesis nunca es solo un título: lleva cifras concretas del motor, de
 * modo que una vista con todos los detalles cerrados sigue diciendo algo.
 * Lo que NUNCA se pliega (faltante, inviabilidad, condiciones pendientes de un
 * plan, costo de un adelanto) lo garantiza cada bloque en su propia síntesis.
 */
function Seccion({
  section,
  props,
  abiertaInicial,
}: {
  section: ViewSpecSection;
  props: SectionRendererProps;
  abiertaInicial: boolean;
}) {
  const { result } = props;
  const [abierta, setAbierta] = useState(abiertaInicial);
  const estilo = ESTILOS[section.emphasis];
  const id = `seccion-${section.type}`;
  const titulo = section.title
    ? resolveFactTokens(section.title, result)
    : COMPONENT_LABELS[section.type];
  const nota = section.note ? resolveFactTokens(section.note, result) : null;

  return (
    <section
      data-seccion={section.type}
      data-enfasis={section.emphasis}
      data-abierta={abierta ? 'si' : 'no'}
      aria-labelledby={id}
      className={estilo.contenedor}
    >
      <h2 id={id} className={estilo.titulo}>
        {titulo}
      </h2>
      {nota ? <p className={`mt-1 ${estilo.nota}`}>{nota}</p> : null}

      <div className="mt-4">{renderBlock(section.type, section, props, 'sintesis')}</div>

      <button
        type="button"
        aria-expanded={abierta}
        aria-controls={`${id}-detalle`}
        onClick={() => setAbierta((previo) => !previo)}
        className="mt-4 flex items-center gap-1.5 text-cuerpo-sm font-semibold text-acento hover:text-acento-fuerte"
      >
        <span aria-hidden="true">{abierta ? '▾' : '▸'}</span>
        {abierta ? TEXTS.renderer.ocultarDetalle : TEXTS.renderer.verDetalle}
      </button>

      <div id={`${id}-detalle`} hidden={!abierta} className="mt-4 border-t border-borde pt-4">
        {renderBlock(section.type, section, props, 'detalle')}
      </div>
    </section>
  );
}

export default function SectionRenderer(props: SectionRendererProps) {
  const { spec, result, enforcement } = props;
  const permitidos = new Set(selectBlocksForSpec(spec));
  const pintados = new Set<ComponentType>();

  const secciones = (spec?.sections ?? []).filter((section) => {
    if (!permitidos.has(section.type) || pintados.has(section.type)) return false;
    // El comparador vacío no se pinta: una tarjeta sin planes engaña.
    if (section.type === 'plan_comparison' && result.plans.length === 0) return false;
    pintados.add(section.type);
    return true;
  });

  const filas = agruparEnFilas(secciones);
  const abiertaInicial = indiceAbiertoInicial(secciones);
  // Los despliegues se conservan mientras sea la misma composición del mismo
  // resultado; una composición nueva vuelve a aplicar la regla desde cero.
  const composicionId = `${spec.resultId}|${spec.focus}|${secciones.map((s) => s.type + s.emphasis).join(',')}`;

  return (
    <div className="space-y-4">
      {secciones.length === 0 ? (
        <p className="tarjeta p-5 text-cuerpo-sm text-tinta-suave">{TEXTS.renderer.vacio}</p>
      ) : (
        filas.map((fila) => (
          <div
            key={fila.map((s) => s.type).join('|')}
            className={
              fila.length === 2
                ? 'grid gap-4 lg:grid-cols-2 lg:items-start'
                : 'grid gap-4 grid-cols-1'
            }
          >
            {fila.map((section) => (
              <Seccion
                key={`${composicionId}|${section.type}`}
                section={section}
                props={props}
                abiertaInicial={secciones.indexOf(section) === abiertaInicial}
              />
            ))}
          </div>
        ))
      )}

      {enforcement && enforcement.length > 0 ? (
        <details className="rounded-tarjeta border border-borde bg-superficie-tenue px-4 py-3">
          <summary className="cursor-pointer text-cuerpo-sm font-semibold text-tinta-suave">
            {TEXTS.renderer.ajustesTitulo}
          </summary>
          <p className="mt-2 text-pie text-tinta-tenue">{TEXTS.renderer.ajustesAyuda}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-pie text-tinta-tenue">
            {enforcement.map((linea) => (
              <li key={linea}>{linea}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
