'use client';

import { type ReactNode } from 'react';
import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
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
  onUndoHistory?: (eventId: string) => void;
  rejectingOptionId?: string | null;
  busy?: boolean;
  onSelectPlan?: (planId: string) => void;
  selectedPlanId?: string | null;
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
          onSelect={props.onSelectPlan}
          selectedPlanId={props.selectedPlanId}
        />
      );
    case 'constraints':
      return <Constraints {...comun} />;
    case 'history':
      return <History {...comun} entries={historyEntries} beforeAfter={props.beforeAfter} onUndo={props.onUndoHistory} busy={props.busy} />;
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
function CalendarTimeline({ result }: { result: EngineResult }) {
  return <ol className="space-y-2">
    {result.baseline.dailyBalances.map(day => <li key={day.date} className={`grid grid-cols-[1fr_auto] gap-2 rounded-xl border-l-4 p-3 ${day.closingCents < result.minimumCashCents ? 'border-aviso bg-aviso-suave' : 'border-borde bg-superficie-tenue'}`}>
      <div><p className="font-semibold">{formatEconomicDate(day.date)}</p>
        <p className="text-sm text-tinta-suave">{day.inflowCents > 0 ? `Cobras ${formatCents(day.inflowCents)}` : 'Sin cobros'} · {day.outflowCents > 0 ? `Pagas ${formatCents(day.outflowCents)}` : 'Sin pagos'}</p>
      </div>
      <div className="text-right"><p className="text-xs text-tinta-suave">Te quedan</p><p className="cifra font-semibold">{formatCents(day.closingCents)}</p></div>
    </li>)}
  </ol>;
}

function DecisionLimits({ result }: { result: EngineResult }) {
  const excluded = result.constraints.filter(item => item.kind === 'excluded_action');
  const essential = result.constraints.filter(item => item.kind === 'essential_obligation');
  return <div className="space-y-4">
    {excluded.length > 0 && <div>
      <h3 className="font-semibold">Opciones que descartaste</h3>
      <ul className="mt-2 space-y-2">{excluded.map(item => <li key={item.id} className="rounded-xl border border-aviso bg-superficie p-3 text-sm">{item.title.replace(/^Acción descartada:\s*/i, '')}</li>)}</ul>
      <p className="mt-2 text-sm text-tinta-suave">Si alguna vuelve a ser posible, usa Deshacer último cambio para recuperar el paso anterior.</p>
    </div>}
    <div className="rounded-xl bg-superficie p-4">
      <p className="font-semibold">Tu reserva: {formatCents(result.minimumCashCents)}</p>
      <p className="mt-1 text-sm text-tinta-suave">Este dinero debe quedar disponible después de pagar.</p>
      {essential.length > 0 && <><h3 className="mt-3 font-semibold">Pagos que no podemos mover</h3>
        <ul className="mt-2 space-y-1 text-sm">{essential.map(item => <li key={item.id}>{item.title.replace(/^No se puede mover:\s*/i, '')}{item.amountCents !== undefined ? ' · ' + formatCents(item.amountCents) : ''}</li>)}</ul></>}
    </div>
  </div>;
}

const PURPOSE: Partial<Record<ComponentType, string>> = {
  cash_calendar: 'Estos son tus cobros y pagos previstos. La reserva debe quedar cubierta al cierre de cada día.',
  receivables: 'Revisa cuándo esperas cobrar y qué adelantos podrías negociar.',
  constraints: 'Revisa qué acuerdos podrías volver a considerar. Los pagos esenciales siguen protegidos.',
  history: 'Compara el faltante y consulta las decisiones que has tomado.',
};

function Seccion({ section, props, primary }: {
  section: ViewSpecSection; props: SectionRendererProps; primary: boolean;
}) {
  const proposedTitle = section.title ? resolveFactTokens(section.title, props.result) : '';
  const title = section.type === 'plan_comparison' && props.result.plans.length === 1 ? 'La alternativa que queda' : proposedTitle && proposedTitle.length <= 55 ? proposedTitle : COMPONENT_LABELS[section.type];
  const proposedNote = section.note ? resolveFactTokens(section.note, props.result) : '';
  const explanation = proposedNote && proposedNote.length <= 220 ? proposedNote : PURPOSE[section.type];
  const detailLabel = section.type === 'history' ? 'Ver todos los registros' : section.type === 'plan_comparison' ? 'Ver fechas y costos' : 'Ver el detalle';
  const content = <>
    {primary && explanation && <p className="mb-4 text-sm text-tinta-suave">{explanation}</p>}
    {primary && section.type === 'constraints' ? <DecisionLimits result={props.result}/> : primary && section.type === 'cash_calendar' ? <CalendarTimeline result={props.result}/> : renderBlock(section.type, section, props, primary && section.type === 'receivables' ? 'detalle' : 'sintesis')}
    {!(primary && section.type === 'receivables') && <details className="mt-4 text-sm text-tinta-suave"><summary>{detailLabel}</summary><div className="mt-3 overflow-x-auto">{renderBlock(section.type, section, props, 'detalle')}</div></details>}
  </>;
  return <section data-seccion={section.type} data-enfasis={section.emphasis} data-protagonista={primary ? 'si' : 'no'} className={primary ? `cambio-visible rounded-2xl border p-4 sm:p-6 ${section.type === 'constraints' ? 'border-aviso bg-aviso-suave' : 'border-borde bg-superficie'}` : 'rounded-xl border border-borde bg-superficie p-4'}>
    {primary ? <><h2 className="mb-3 text-2xl font-semibold text-acento-profundo">{title}</h2>{content}</> : <details><summary className="font-semibold text-acento-profundo">{title}</summary><div className="mt-3">{content}</div></details>}
  </section>;
}

function Composicion({props}: {props: SectionRendererProps}) {
  const seen = new Set<string>();
  const sections = props.spec.sections.filter(s => { if (!CATALOGO.has(s.type) || seen.has(s.type)) return false; seen.add(s.type); return true; }).filter(s => s.type !== 'risk_summary' && (s.type !== 'plan_comparison' || props.result.plans.length > 0));
  const primaryIndex = indiceAbiertoInicial(sections);
  // La composición del agente decide el protagonista por énfasis; el resto
  // conserva su orden relativo. Cada componente tiene una presentación propia.
  const primary = sections[primaryIndex];
  return <div className="space-y-3" data-vista={primary?.type}>
    {primary && <Seccion key={primary.type} section={primary} props={props} primary/>}
    <div className="grid gap-3 sm:grid-cols-2">{sections.filter(s => s !== primary).map(section => <Seccion key={section.type} section={section} props={props} primary={false}/>)}</div>
  </div>;
}

export default function SectionRenderer(props: SectionRendererProps) {
  const key = props.spec.resultId + props.spec.focus + JSON.stringify(props.spec.sections);
  return <Composicion key={key} props={props}/>;
}
