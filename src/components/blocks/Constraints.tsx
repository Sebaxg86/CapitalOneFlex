import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
import type { Constraint, ConstraintKind, EngineResult } from '@/domain/types';
import type { ViewSpecSection } from '@/server/ai/viewspec';
import { TEXTS } from '@/lib/texts';

/**
 * Restricciones y bloqueos, agrupados por tipo.
 *
 * Regla: aquí no se imprime ningún identificador interno. Las restricciones
 * implicadas en la inviabilidad se resuelven contra `result.constraints` y se
 * muestran por su título; un id que no resuelva se omite en vez de filtrarse a
 * la pantalla.
 *
 * Reparto síntesis/detalle:
 * - Síntesis: si el escenario está bloqueado, el MOTIVO y las restricciones
 *   implicadas por su título; nunca se pliegan. Si no hay bloqueo, cuántas
 *   restricciones hay de cada tipo, en una línea.
 * - Detalle: los grupos completos, una línea por restricción.
 *
 * El faltante residual y el alcance literal de «sin solución» los declara el
 * cascarón, fuera de la composición: no se repiten aquí.
 *
 * Puede pintarse a media anchura: una sola columna, grupos apilados.
 */
export interface ConstraintsProps {
  result: EngineResult;
  section: ViewSpecSection;
  parte: 'sintesis' | 'detalle';
}

const ORDEN: ConstraintKind[] = [
  'minimum_cash',
  'essential_obligation',
  'requires_agreement',
  'excluded_action',
  'outside_horizon',
];

function agrupar(constraints: Constraint[]): Map<ConstraintKind, Constraint[]> {
  const grupos = new Map<ConstraintKind, Constraint[]>();
  for (const kind of ORDEN) {
    const propias = constraints.filter((c) => c.kind === kind);
    if (propias.length > 0) grupos.set(kind, propias);
  }
  return grupos;
}

/** Títulos legibles de las restricciones implicadas; los ids no se muestran. */
function titulosImplicados(ids: readonly string[], constraints: Constraint[]): string[] {
  const porId = new Map(constraints.map((c) => [c.id, c] as const));
  const titulos: string[] = [];
  for (const id of ids) {
    const titulo = porId.get(id)?.title;
    if (titulo !== undefined) titulos.push(titulo);
  }
  return titulos;
}

/** Importe y fecha de la restricción, ya formateados, para el final de la fila. */
function cifrasDe(constraint: Constraint): string {
  const extras: string[] = [];
  if (constraint.amountCents !== undefined) extras.push(formatCents(constraint.amountCents));
  if (constraint.date !== undefined) extras.push(formatEconomicDate(constraint.date));
  return extras.join(' · ');
}

/**
 * El detalle solo aporta cuando dice algo que el título no dice ya. Repetir el
 * título en letra pequeña alarga la lista sin añadir información.
 */
function detalleAporta(constraint: Constraint): boolean {
  const detalle = constraint.detail?.trim() ?? '';
  if (detalle === '') return false;
  const titulo = constraint.title.trim();
  return detalle !== titulo && !titulo.includes(detalle);
}

export default function Constraints({ result, parte }: ConstraintsProps) {
  const grupos = agrupar(result.constraints);
  const { infeasibility } = result;

  if (parte === 'sintesis') {
    if (infeasibility) {
      const implicadas = titulosImplicados(
        infeasibility.affectedConstraintIds,
        result.constraints,
      );
      return (
        <div className="rounded-tarjeta border border-alerta bg-alerta-suave px-3 py-2">
          <p className="text-cuerpo font-semibold text-alerta-texto">
            <span aria-hidden="true">✗ </span>
            {TEXTS.restricciones.bloqueoTitulo}
          </p>
          <p className="mt-0.5 text-cuerpo-sm text-tinta">
            {TEXTS.riesgo.bloqueoMotivo[infeasibility.reason]}
          </p>
          {implicadas.length > 0 ? (
            <p className="mt-1 text-cuerpo-sm text-tinta-suave">
              <span className="font-semibold">{TEXTS.restricciones.bloqueoAfectadas}: </span>
              {implicadas.join(' · ')}
            </p>
          ) : null}
        </div>
      );
    }

    if (grupos.size === 0) {
      return <p className="text-cuerpo-sm text-tinta-suave">{TEXTS.restricciones.vacio}</p>;
    }

    return (
      <p className="text-cuerpo-sm text-tinta">
        {[...grupos.entries()].map(([kind, items], indice) => (
          <span key={kind}>
            {indice > 0 ? <span className="text-tinta-tenue"> · </span> : null}
            {TEXTS.restricciones.grupos[kind]}{' '}
            <span className="cifra font-semibold">{items.length}</span>
          </span>
        ))}
      </p>
    );
  }

  if (grupos.size === 0) {
    return <p className="text-cuerpo-sm text-tinta-suave">{TEXTS.restricciones.vacio}</p>;
  }

  return (
    <div className="space-y-3">
      {[...grupos.entries()].map(([kind, items]) => (
        <section key={kind} aria-labelledby={`restricciones-${kind}`}>
          <h3 id={`restricciones-${kind}`} className="rotulo">
            {TEXTS.restricciones.grupos[kind]}
          </h3>
          <ul className="mt-1 divide-y divide-borde border-t border-borde">
            {items.map((constraint) => {
              const cifras = cifrasDe(constraint);
              return (
                <li key={constraint.id} className="py-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                    <span className="text-cuerpo-sm font-semibold text-tinta">
                      {constraint.title}
                    </span>
                    {cifras !== '' ? (
                      <span className="cifra text-cuerpo-sm text-tinta-suave">{cifras}</span>
                    ) : null}
                  </div>
                  {detalleAporta(constraint) ? (
                    <p className="text-pie text-tinta-tenue">{constraint.detail}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* Texto fijo del motor sobre el alcance real de «sin solución». */}
      {infeasibility ? (
        <p className="text-pie text-tinta-suave">{infeasibility.scopeNote}</p>
      ) : null}
    </div>
  );
}
