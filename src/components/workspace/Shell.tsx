import type { ReactNode } from 'react';
import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
import type { IntegrationStatus, WorkspaceState } from '@/lib/contracts';
import { type Focus } from '@/server/ai/viewspec';
import { TEXTS } from '@/lib/texts';
import Logo from './Logo';
import IntegrationBadges from './IntegrationBadges';

export interface ShellProps {
  state: WorkspaceState; focus: Focus; onFocusChange: (focus: Focus) => void;
  undoLabel?: string;
  onReset: () => void;
  onBack: () => void; canGoBack: boolean; busy: boolean; statusMessage: string | null;
  decisions: ReactNode; children: ReactNode;
}
export function describeIntegration(status: IntegrationStatus): string {
  if (!status.configured) return TEXTS.integraciones.estadoNoConfigurado;
  return status.verified ? TEXTS.integraciones.estadoVerificado : TEXTS.integraciones.estadoConfigurado;
}
export default function Shell({state, focus, onFocusChange, onReset, onBack, canGoBack, undoLabel, busy, statusMessage, decisions, children}: ShellProps) {
  const {business, result, view, integrations, notices} = state;
  const gap = result.baseline.shortfallCents;
  const blocked = result.infeasibility;
  return <div className="min-h-screen bg-lienzo text-tinta">
    <a href="#contenido" className="sr-only focus:not-sr-only">Ir al contenido</a>
    <header className="border-t-2 border-t-[#cc2427] border-b border-borde bg-superficie text-acento-profundo shadow-[0_2px_12px_rgba(1,61,91,0.04)]">
      <div className="mx-auto max-w-lienzo px-4 sm:px-6">
        <div className="flex items-center justify-between gap-3 py-5 sm:py-6">
          <h1 aria-label="Capital One Flex" className="flex shrink-0 items-center"><Logo/></h1>
          <span className="rounded-full border border-borde bg-superficie-tenue px-3 py-1.5 text-[10px] font-semibold tracking-wide text-tinta-suave sm:text-xs">Demo HackMTY</span>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-borde/60 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-acento-suave text-xs font-semibold text-acento-profundo">{business.name.split(' ').filter(Boolean).slice(0,2).map(word=>word[0]).join('')}</span>
            <div className="min-w-0"><p className="text-[10px] leading-tight text-tinta-tenue">Tu negocio</p><p className="truncate text-sm font-semibold">{business.name}</p></div>
          </div>
          <button type="button" onClick={onReset} disabled={busy} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-tinta-suave transition-colors hover:bg-acento-suave hover:text-acento-profundo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-40">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M4 10a8 8 0 1 1 1.8 7M4 4v6h6"/></svg>
            Reiniciar ejemplo
          </button>
        </div>
      </div>
    </header>
    <main id="contenido" className="mx-auto max-w-lienzo px-4 py-5 sm:px-6 space-y-5">
      <section key={result.id} className={`cambio-visible rounded-2xl border p-5 ${blocked ? 'border-aviso bg-aviso-suave' : gap > 0 ? 'border-alerta bg-alerta-suave' : 'border-ok bg-ok-suave'}`} aria-label="Estado de tu semana">
        <p className="text-sm text-tinta-tenue">Tu semana · {formatEconomicDate(result.horizon.start)} – {formatEconomicDate(result.horizon.end)}</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-acento-profundo">
          {blocked ? 'Con estas opciones no alcanza' : gap > 0 ? 'Necesitas cubrir' : TEXTS.estado.cubiertoTitulo}
        </h2>
        {gap > 0 && <p className="mt-1 text-4xl font-semibold cifra text-alerta-texto">{formatCents(blocked?.minimalResidualShortfallCents ?? gap)}</p>}
        <p className="mt-2 text-cuerpo-sm text-tinta-suave">{blocked ? 'Aun con la mejor combinación disponible, falta este dinero. Revisa qué acuerdo podrías negociar.' : gap > 0 ? 'Para pagar tus compromisos y conservar el dinero de reserva.' : 'Con los cobros previstos puedes pagar y conservar tu reserva.'}</p>
        {blocked && <details className="mt-2 text-sm"><summary>Qué significa “no alcanza”</summary><p className="mt-2">{blocked.scopeNote}</p></details>}
      </section>
      {canGoBack && <div className="rounded-xl border border-borde bg-superficie p-3 text-sm">
        <button className="font-semibold text-acento underline underline-offset-4 disabled:opacity-50" onClick={onBack} disabled={busy}>Deshacer último cambio</button>
        <p className="mt-1 text-tinta-suave">{undoLabel}</p>
      </div>}
      <details key={gap > 0 ? 'with-risk' : 'without-risk'} open={gap === 0} className="tarjeta p-4 sm:p-5" aria-label="Contar un cambio">
        <summary className="font-semibold text-acento-profundo">{gap > 0 ? 'Contar otro cambio' : 'Cuéntanos qué pasó'}</summary>
        <div className="mt-3" aria-busy={busy}>{decisions}</div>
      </details>
      <div aria-live="polite" role="status">{busy ? <p className="text-acento">Revisando tus opciones…</p> : statusMessage ? <div key={state.result.id + statusMessage} className="cambio-visible rounded-xl border-l-4 border-acento bg-acento-suave p-4"><p className="font-semibold">Qué cambió</p><p className="mt-1 text-sm">{statusMessage}</p></div> : null}</div>
      {view.source === 'fallback' && <p className="text-xs text-tinta-tenue">Vista básica · La IA no organizó esta pantalla.</p>}
      <nav aria-label="Explorar tu semana" className="pt-1">
        <h2 className="mb-3 text-lg font-semibold text-acento-profundo">¿Qué quieres entender?</h2>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'overview', title: 'Ver mis próximos pagos', help: 'Cuándo entra y sale dinero durante la semana.' },
            ...(gap > 0 && !blocked ? [{ value: 'payroll', title: 'Comparar cómo cubrir el faltante', help: 'Qué puedes negociar, cuánto cuesta y de quién depende.' }] : []),
            { value: 'receivables', title: 'Ver quién me debe', help: 'Facturas pendientes, fechas y opciones para cobrar antes.' },
            ...(blocked ? [{ value: 'no_solution', title: 'Ver qué impide cubrir los pagos', help: 'Reserva, pagos esenciales y opciones descartadas.' }] : []),
            { value: 'history', title: 'Revisar mis cambios', help: 'Qué modificaste y cómo cambió el dinero que falta.' },
          ] as {value: Focus; title: string; help: string}[]).map(item => <button key={item.value} type="button" aria-pressed={focus === item.value} disabled={busy} onClick={() => onFocusChange(item.value)} className={`rounded-xl border p-3 text-left disabled:opacity-50 ${focus === item.value ? 'border-acento bg-acento-suave' : 'border-borde bg-superficie hover:border-acento'}`}>
            <span className="block text-sm font-semibold text-acento-profundo">{item.title}</span>
            <span className="mt-1 block text-xs text-tinta-suave">{item.help}</span>
          </button>)}
        </div>
      </nav>
      <section aria-label="Tu decisión" aria-busy={busy}>{children}</section>
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
