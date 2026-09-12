import type { ReactNode } from 'react';
import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
import type { IntegrationStatus, WorkspaceState } from '@/lib/contracts';
import { FOCUS_LABELS, FOCUS_VALUES, type Focus } from '@/server/ai/viewspec';
import { TEXTS } from '@/lib/texts';
import IntegrationBadges, { AvisoVistaBasica } from './IntegrationBadges';
import Logo from './Logo';

/**
 * Cascarón estable, en una sola columna centrada.
 *
 * El orden vertical es deliberado y no depende de la composición:
 *   1. Cabecera del negocio.
 *   2. Línea de estado financiero, calculada por el motor. Es la garantía
 *      mínima de que la inviabilidad y el faltante nunca se ocultan, pase lo
 *      que pase con la vista compuesta.
 *   3. Barra de acciones (enfoque y deshacer). Va ANTES de la zona de decisión
 *      justamente para que su posición no dependa de una propuesta abierta:
 *      encima de ella solo hay bloques de altura estable.
 *   4. Zona de decisión: pegar el aviso y revisar la propuesta.
 *   5. Zona compuesta: lo único que el modelo reorganiza.
 *   6. Pie con el detalle de integraciones.
 */
export interface ShellProps {
  state: WorkspaceState;
  focus: Focus;
  onFocusChange: (focus: Focus) => void;
  onBack: () => void;
  canGoBack: boolean;
  busy: boolean;
  statusMessage: string | null;
  /** Área de confirmar/rechazar: redactor y revisión de propuestas. */
  decisions: ReactNode;
  /** Zona central adaptable: la composición validada. */
  children: ReactNode;
}

/**
 * Describe el estado de una integración. Función pura y verificable:
 * jamás devuelve "verificado" cuando el proveedor no se comprobó de verdad.
 */
export function describeIntegration(status: IntegrationStatus): string {
  if (!status.configured) return TEXTS.integraciones.estadoNoConfigurado;
  if (!status.verified) return TEXTS.integraciones.estadoConfigurado;
  return TEXTS.integraciones.estadoVerificado;
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="rotulo">{etiqueta}</dt>
      <dd className="cifra mt-0.5 text-cuerpo-sm font-semibold text-tinta">{valor}</dd>
    </div>
  );
}

/**
 * Estado financiero en una línea, siempre presente y siempre del motor.
 * No lo compone el modelo ni puede suprimirlo.
 */
function LineaDeEstado({ state }: { state: WorkspaceState }) {
  const { result } = state;
  const faltante = result.baseline.shortfallCents;
  const bloqueado = result.infeasibility !== null;

  if (bloqueado) {
    const { minimalResidualShortfallCents: residual, scopeNote } = result.infeasibility!;
    return (
      <div className="rounded-tarjeta border border-alerta bg-alerta-suave px-5 py-4">
        <p className="text-titular-sm text-alerta-texto">✕ {TEXTS.estado.bloqueadoTitulo}</p>
        <p className="mt-1 text-cuerpo text-alerta-texto">
          {TEXTS.estado.bloqueadoResidual}:{' '}
          <span className="cifra font-semibold">{formatCents(residual)}</span>
        </p>
        {/*
          El alcance real de «sin solución» vive aquí, fuera de la composición
          y sin plegar: si estuviera solo dentro de «Restricciones», plegar ese
          bloque rompería la garantía.
        */}
        <p className="mt-2 text-cuerpo-sm text-alerta-texto">{scopeNote}</p>
      </div>
    );
  }

  if (faltante > 0) {
    return (
      <div className="rounded-tarjeta border border-alerta bg-alerta-suave px-5 py-4">
        <p className="text-titular-sm text-alerta-texto">
          ▲ {TEXTS.estado.riesgoTitulo}{' '}
          <span className="cifra">{formatCents(faltante)}</span>
        </p>
        <p className="mt-1 text-cuerpo-sm text-alerta-texto">
          {TEXTS.estado.riesgoDia}: {formatEconomicDate(result.baseline.minimumClosingDate)}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-tarjeta border border-ok bg-ok-suave px-5 py-4">
      <p className="text-titular-sm text-ok-texto">✓ {TEXTS.estado.cubiertoTitulo}</p>
      <p className="mt-1 text-cuerpo-sm text-ok-texto">
        {TEXTS.estado.cubiertoDetalle}:{' '}
        <span className="cifra font-semibold">
          {formatCents(result.baseline.minimumClosingCents)}
        </span>
      </p>
    </div>
  );
}

export default function Shell({
  state,
  focus,
  onFocusChange,
  onBack,
  canGoBack,
  busy,
  statusMessage,
  decisions,
  children,
}: ShellProps) {
  const { business, scenario, result, view, integrations, notices } = state;

  return (
    <div className="min-h-screen bg-lienzo text-tinta">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-superficie focus:px-4 focus:py-2"
      >
        {TEXTS.shell.saltarAlContenido}
      </a>

      {/* 1. Cabecera */}
      <header className="border-b border-borde bg-superficie">
        <div className="mx-auto max-w-lienzo px-4 py-5 sm:px-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-borde pb-4">
            <Logo />
            <p className="rotulo">{TEXTS.marca.descriptor}</p>
          </div>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-titular-lg">{business.name}</h1>
            <p className="text-cuerpo-sm text-tinta-tenue">{business.description}</p>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <Dato
              etiqueta={TEXTS.shell.horizonteEtiqueta}
              valor={`${formatEconomicDate(result.horizon.start)} ${TEXTS.shell.horizonteSeparador} ${formatEconomicDate(result.horizon.end)}`}
            />
            <Dato etiqueta={TEXTS.shell.hoyEtiqueta} valor={formatEconomicDate(result.demoToday)} />
            <Dato
              etiqueta={TEXTS.shell.saldoInicialEtiqueta}
              valor={formatCents(result.openingBalanceCents)}
            />
            <Dato
              etiqueta={TEXTS.shell.cajaMinimaEtiqueta}
              valor={formatCents(result.minimumCashCents)}
            />
            <Dato etiqueta={TEXTS.shell.escenarioEtiqueta} valor={scenario.label} />
          </dl>

          <p className="mt-4 text-pie text-tinta-tenue">{TEXTS.shell.datosFicticios}</p>
        </div>
      </header>

      <main id="contenido" className="mx-auto max-w-lienzo space-y-5 px-4 py-6 sm:px-8">
        {/* 2. Estado financiero: del motor, nunca compuesto. */}
        <LineaDeEstado state={state} />

        {/*
          3. Barra de acciones. Va inmediatamente después del estado financiero
          y ANTES de cualquier bloque de altura variable. Los avisos dependen de
          si la vista la compuso el modelo, así que cambian de alto al cambiar
          de enfoque: si estuvieran encima, moverían los controles.
        */}
        <div
          data-barra-acciones
          className="flex min-h-[3.5rem] flex-wrap items-center justify-between gap-3 rounded-tarjeta border border-borde bg-superficie px-4 py-2"
        >
          <fieldset data-controles-foco className="min-w-0">
            <legend className="sr-only">{TEXTS.shell.focoLeyenda}</legend>
            <div className="flex flex-wrap gap-2">
              {FOCUS_VALUES.map((value) => (
                <label
                  key={value}
                  data-foco={value}
                  data-activo={focus === value ? 'si' : 'no'}
                  className={`pildora cursor-pointer ${focus === value ? 'pildora-activa' : ''}`}
                >
                  <input
                    type="radio"
                    name="foco"
                    value={value}
                    checked={focus === value}
                    disabled={busy}
                    onChange={() => onFocusChange(value)}
                    className="sr-only"
                  />
                  <span>{FOCUS_LABELS[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            onClick={onBack}
            disabled={!canGoBack || busy}
            title={canGoBack ? TEXTS.shell.volverAyuda : TEXTS.shell.volverVacio}
            className="boton-secundario"
          >
            ← {TEXTS.shell.volverBoton}
          </button>
        </div>

        {notices.length > 0 ? (
          <section
            aria-labelledby="avisos-titulo"
            className="rounded-tarjeta border border-aviso bg-aviso-suave px-4 py-3"
          >
            <h2 id="avisos-titulo" className="text-cuerpo-sm font-semibold text-aviso-texto">
              ⚠ {TEXTS.shell.avisosTitulo}
            </h2>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-cuerpo-sm text-aviso-texto">
              {notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* 4. Zona de decisión: la acción principal del producto. */}
        <section
          aria-labelledby="decisiones-titulo"
          aria-live="polite"
          aria-busy={busy}
          className="tarjeta p-5 sm:p-6"
        >
          <h2 id="decisiones-titulo" className="text-titular-sm">
            {TEXTS.shell.decisionesTitulo}
          </h2>
          <div className="mt-4">{decisions}</div>
        </section>

        {/* 5. Zona compuesta. */}
        <section aria-labelledby="vista-titulo" aria-live="polite" aria-busy={busy} className="min-w-0">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="vista-titulo" className="rotulo">
              {FOCUS_LABELS[focus]}
            </h2>
            <p className="text-pie text-tinta-tenue">
              {view.source === 'gemini' ? '◆ ' : '◇ '}
              {TEXTS.shell.composicionFuente[view.source]}
            </p>
          </div>
          <p className="sr-only" role="status">
            {busy ? TEXTS.shell.estadoTrabajando : (statusMessage ?? TEXTS.shell.estadoListo)}
          </p>
          {statusMessage && !busy ? (
            <p className="mb-3 rounded-control border border-acento-borde bg-acento-suave px-4 py-2 text-cuerpo-sm text-acento-profundo">
              {statusMessage}
            </p>
          ) : null}
          {/* El aviso de vista básica vive aquí, junto al contenido al que afecta. */}
          <AvisoVistaBasica view={view} />
          {children}
        </section>

        {/* 6. Pie: detalle técnico, lejos de las decisiones de negocio. */}
        <footer className="rounded-tarjeta border border-borde bg-superficie-tenue px-4 py-3">
          <IntegrationBadges
            integrations={integrations}
            view={view}
            describir={describeIntegration}
          />
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-borde pt-3 text-pie text-tinta-tenue">
            <p>
              {TEXTS.shell.almacenamientoEtiqueta}: {TEXTS.shell.almacenamiento[state.storage]}
            </p>
            {/*
              Cómo se evalúa la caja tiene que estar declarado siempre, aunque
              la composición no incluya el calendario. Colapsado para no
              competir con las decisiones, pero nunca ausente.
            */}
            <details>
              <summary className="cursor-pointer">{TEXTS.shell.notaIntradiaTitulo}</summary>
              <p className="mt-1 max-w-prose">{result.diagnostics.intradayNote}</p>
            </details>
          </div>
        </footer>
      </main>
    </div>
  );
}
