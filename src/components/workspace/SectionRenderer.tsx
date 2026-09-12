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
import type { BeforeAfter } from '@/lib/contracts';
import { TEXTS } from '@/lib/texts';
import RiskSummary from '@/components/blocks/RiskSummary';
import CashCalendar from '@/components/blocks/CashCalendar';
import Receivables from '@/components/blocks/Receivables';
import PlanComparison from '@/components/blocks/PlanComparison';
import Constraints from '@/components/blocks/Constraints';
import History, { type HistoryEntry } from '@/components/blocks/History';

/** Vista móvil: conserva el orden del agente y abre inicialmente su panel de
 * mayor énfasis. El estado financiero vive en el shell, sin repetirse aquí.
 * Las utilidades de agrupación se conservan para composiciones alternativas.
 */
export interface SectionRendererProps {
  spec: ViewSpec;
  result: EngineResult;
  /** Comprobaciones que impuso el servidor sobre la propuesta del modelo. */
  enforcement?: string[];
  historyEntries?: HistoryEntry[];
  beforeAfter?: BeforeAfter[];
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
      return <History {...comun} entries={historyEntries} beforeAfter={props.beforeAfter} />;
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
function Seccion({ section, props, open, onToggle }: {
  section: ViewSpecSection; props: SectionRendererProps; open: boolean; onToggle: () => void;
}) {
  const id = `seccion-${section.type}`;
  const proposedTitle = section.title ? resolveFactTokens(section.title, props.result) : '';
  const title = proposedTitle && proposedTitle.length <= 55 ? proposedTitle : COMPONENT_LABELS[section.type];
  return <section data-seccion={section.type} data-enfasis={section.emphasis} data-abierta={open ? 'si' : 'no'} className="tarjeta overflow-hidden">
    <h2>
      <button aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-4 text-left text-lg font-semibold text-acento-profundo">
        {title}<span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
    </h2>
    <div id={id} hidden={!open} className="px-4 pb-4">
      {renderBlock(section.type, section, props, 'sintesis')}
      <details className="mt-4 text-sm text-tinta-suave">
        <summary>Ver cómo se calcula</summary>
        <div className="mt-3 overflow-x-auto">{renderBlock(section.type, section, props, 'detalle')}</div>
      </details>
    </div>
  </section>;
}

function Composicion({props}: {props: SectionRendererProps}) {
  // El estado financiero se mantiene siempre visible en el shell. No repetirlo aquí.
  const seen = new Set<string>();
  const sections = props.spec.sections.filter(s => { if (!CATALOGO.has(s.type) || seen.has(s.type)) return false; seen.add(s.type); return true; }).filter(s => s.type !== 'risk_summary' && (s.type !== 'plan_comparison' || props.result.plans.length > 0));
  const initial = indiceAbiertoInicial(sections);
  const [active, setActive] = useState<string | null>(sections[initial]?.type ?? null);
  return <div className="space-y-3">
    {sections.map(section => <Seccion key={section.type} section={section} props={props} open={active === section.type} onToggle={()=>setActive(active === section.type ? null : section.type)}/>)}
  </div>;
}

export default function SectionRenderer(props: SectionRendererProps) {
  const key = props.spec.resultId + props.spec.focus + JSON.stringify(props.spec.sections);
  return <Composicion key={key} props={props}/>;
}
