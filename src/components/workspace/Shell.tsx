import type { ReactNode } from 'react';
import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
import type { IntegrationStatus, WorkspaceState } from '@/lib/contracts';
import { FOCUS_LABELS, FOCUS_VALUES, type Focus } from '@/server/ai/viewspec';
import { TEXTS } from '@/lib/texts';
import IntegrationBadges from './IntegrationBadges';

export interface ShellProps {
  state: WorkspaceState; focus: Focus; onFocusChange: (focus: Focus) => void;
  onBack: () => void; canGoBack: boolean; busy: boolean; statusMessage: string | null;
  decisions: ReactNode; children: ReactNode;
}
export function describeIntegration(status: IntegrationStatus): string {
  if (!status.configured) return TEXTS.integraciones.estadoNoConfigurado;
  return status.verified ? TEXTS.integraciones.estadoVerificado : TEXTS.integraciones.estadoConfigurado;
}
export default function Shell({state, focus, onFocusChange, onBack, canGoBack, busy, statusMessage, decisions, children}: ShellProps) {
  const {business, result, view, integrations, notices} = state;
  const gap = result.baseline.shortfallCents;
  const blocked = result.infeasibility;
  return <div className="min-h-screen bg-lienzo text-tinta">
    <a href="#contenido" className="sr-only focus:not-sr-only">Ir al contenido</a>
    <header className="border-t-4 border-t-[#cc2427] bg-acento-profundo text-white">
      <div className="mx-auto max-w-lienzo px-5 py-4 flex items-center justify-between gap-3">
        <div><p className="text-sm opacity-80">Compromisos bajo presión</p><h1 className="text-xl font-semibold">{business.name}</h1></div>
        <span className="rounded-full border border-white/30 px-3 py-1 text-xs">Demo HackMTY</span>
      </div>
    </header>
    <main id="contenido" className="mx-auto max-w-lienzo px-4 py-5 sm:px-6 space-y-5">
      <section className="px-1" aria-label="Estado de tu semana">
        <p className="text-sm text-tinta-tenue">Tu semana · {formatEconomicDate(result.horizon.start)} – {formatEconomicDate(result.horizon.end)}</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-acento-profundo">
          {blocked ? 'Con estas opciones no alcanza' : gap > 0 ? 'Necesitas cubrir' : TEXTS.estado.cubiertoTitulo}
        </h2>
        {gap > 0 && <p className="mt-1 text-4xl font-semibold cifra text-alerta-texto">{formatCents(blocked?.minimalResidualShortfallCents ?? gap)}</p>}
        <p className="mt-2 text-cuerpo-sm text-tinta-suave">{blocked ? 'Es lo que falta después de probar las opciones permitidas. Puedes revisar qué condición cambiar.' : gap > 0 ? 'Para pagar tus compromisos y conservar el dinero de reserva.' : 'Tus pagos y tu reserva están cubiertos con los datos de este escenario.'}</p>
        {blocked && <details className="mt-2 text-sm"><summary>Qué significa “no alcanza”</summary><p className="mt-2">{blocked.scopeNote}</p></details>}
      </section>
      <div data-barra-acciones className="flex items-center justify-between gap-3">
        <label data-controles-foco className="flex-1 min-w-0 text-sm text-tinta-suave">Quiero revisar
          <select aria-label="Quiero revisar" className="campo mt-1" value={focus} disabled={busy} onChange={e=>onFocusChange(e.target.value as Focus)}>
            {FOCUS_VALUES.map(value=><option key={value} value={value}>{FOCUS_LABELS[value]}</option>)}
          </select>
        </label>
        <button className="boton-secundario mt-6" onClick={onBack} disabled={!canGoBack || busy}>← Volver</button>
      </div>
      <details key={gap > 0 ? 'with-risk' : 'without-risk'} open={gap === 0} className="tarjeta p-4 sm:p-5" aria-label="Contar un cambio">
        <summary className="font-semibold text-acento-profundo">{gap > 0 ? 'Contar otro cambio' : 'Cuéntanos qué pasó'}</summary>
        <div className="mt-3" aria-busy={busy}>{decisions}</div>
      </details>
      <div aria-live="polite" role="status">{busy ? <p className="text-acento">Revisando tus opciones…</p> : statusMessage ? <p className="text-sm text-acento-profundo">{statusMessage}</p> : null}</div>
      {view.source === 'fallback' && <p className="text-xs text-tinta-tenue">Vista básica · La IA no organizó esta pantalla.</p>}
      <section aria-label="Tus opciones" aria-busy={busy}>{children}</section>
      <details className="border-t border-borde pt-4 text-sm text-tinta-suave">
        <summary>Datos del ejemplo y conexiones</summary>
        <div className="space-y-3 mt-3">
          <p>Prototipo de hackatón inspirado en Capital One; no es un servicio bancario oficial. Datos ficticios, sin pagos reales.</p>
          <p>Dinero inicial: {formatCents(result.openingBalanceCents)} · Reserva: {formatCents(result.minimumCashCents)}.</p>
          <p>{result.diagnostics.intradayNote}</p>
          {notices.map(n=><p key={n}>{n}</p>)}
          <IntegrationBadges integrations={integrations} view={view} describir={describeIntegration}/>
        </div>
      </details>
    </main>
  </div>;
}
