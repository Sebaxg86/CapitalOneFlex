'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ApiError,
  Focus,
  MutationResponse,
  PendingProposal,
  WorkspaceState,
} from '@/lib/contracts';
import { TEXTS } from '@/lib/texts';

/**
 * Revisión humana de una propuesta antes de tocar ningún dato.
 *
 * La clave de idempotencia se genera UNA vez por propuesta y se reutiliza en
 * cada intento: pulsar dos veces no puede duplicar el evento. Si el servidor
 * responde 409, el escenario cambió y hay que volver a revisar.
 */
export interface ProposalReviewProps {
  proposal: PendingProposal;
  /** Enfoque vigente: se conserva al recomponer tras confirmar. */
  focus: Focus;
  onApplied: (state: WorkspaceState, deduplicated: boolean) => void;
  onDiscard: () => void;
}

export default function ProposalReview({
  proposal,
  focus,
  onApplied,
  onDiscard,
}: ProposalReviewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  const [enVuelo, setEnVuelo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<number | null | undefined>(undefined);

  // Una sola clave por propuesta: no se regenera en cada clic.
  const claveRef = useRef<{ proposalId: string; key: string } | null>(null);
  if (claveRef.current === null || claveRef.current.proposalId !== proposal.id) {
    claveRef.current = { proposalId: proposal.id, key: crypto.randomUUID() };
  }
  const idempotencyKey = claveRef.current.key;

  async function confirmar() {
    if (enVuelo) return;
    setEnVuelo(true);
    setError(null);
    setConflicto(undefined);
    try {
      const respuesta = await fetch('/api/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          baseRevision: proposal.baseRevision,
          idempotencyKey,
          focus,
        }),
      });

      if (respuesta.status === 409) {
        const cuerpo = (await respuesta.json().catch(() => null)) as ApiError | null;
        setConflicto(cuerpo?.currentRevision ?? null);
        return;
      }
      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => null)) as ApiError | null;
        setError(cuerpo?.error ?? TEXTS.comunes.errorGenerico);
        return;
      }

      const cuerpo = (await respuesta.json()) as MutationResponse;
      onApplied(cuerpo.state, cuerpo.deduplicated);
    } catch {
      setError(TEXTS.redactor.errorRed);
    } finally {
      setEnVuelo(false);
    }
  }

  return (
    <dialog ref={dialogRef} onCancel={event => event.preventDefault()}
      aria-labelledby="propuesta-titulo"
      className="m-auto w-[calc(100%-2rem)] max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl border-0 bg-superficie p-0 text-tinta shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm">
      <div className="border-t-4 border-acento p-5 sm:p-7">
      <h3 id="propuesta-titulo" className="text-2xl font-semibold text-acento-profundo">
        {TEXTS.propuesta.titulo}
      </h3>


      {proposal.changes.length === 0 ? (
        <p className="mt-3 text-cuerpo-sm text-tinta-suave">{TEXTS.propuesta.sinCambios}</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {proposal.changes.map((change, index) => (
            <li
              key={`${change.operation.op}:${index}`}
              className="rounded-tarjeta border border-borde bg-superficie px-4 py-3 text-cuerpo-sm"
            >
              <p className="rotulo">
                {TEXTS.propuesta.cambioTitulo} {index + 1}:{' '}
                {TEXTS.propuesta.operaciones[change.operation.op]}
              </p>
              {change.comparison ? <>
                <p className="mt-3 rounded-xl border-l-4 border-acento bg-acento-suave px-4 py-3 text-lg font-semibold leading-snug text-acento-profundo">{change.comparison.subject}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div className="rounded-xl border border-borde bg-superficie-tenue p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-tinta-tenue">Antes</p>
                    <p className="mt-2 text-lg font-semibold">{change.comparison.before}</p>
                  </div>
                  <span aria-hidden="true" className="text-center text-xl text-acento"><span className="sm:hidden">↓</span><span className="hidden sm:inline">→</span></span>
                  <div className="rounded-xl border-2 border-acento bg-acento-suave p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-acento">Después</p>
                    <p className="mt-2 text-lg font-semibold text-acento-profundo">{change.comparison.after}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-tinta-suave">{change.comparison.note}</p>
              </> : <p className="mt-2">{change.humanDiff}</p>}
              <details className="mt-2 text-sm text-tinta-suave"><summary>Ver el mensaje original</summary><p className="mt-2 border-l-2 border-acento-borde pl-3">
                <span className="not-italic font-semibold">
                  {TEXTS.propuesta.evidenciaEtiqueta}:{' '}
                </span>
                «{change.evidence}»
              </p></details>
            </li>
          ))}
        </ol>
      )}

      {conflicto !== undefined ? (
        <div
          role="status"
          className="mt-3 rounded-tarjeta border border-alerta bg-alerta-suave px-4 py-3 text-cuerpo-sm text-alerta-texto"
        >
          <p className="font-semibold">⚠ {TEXTS.propuesta.conflictoTitulo}</p>
          <p className="mt-1">{TEXTS.propuesta.conflictoCuerpo}</p>
          {conflicto !== null ? (
            <p className="mt-1 text-xs tabular-nums">
              {TEXTS.propuesta.conflictoRevision}: {conflicto}
            </p>
          ) : null}
        </div>
      ) : null}

      {error !== null ? (
        <div
          role="status"
          className="mt-3 rounded-tarjeta border border-alerta bg-alerta-suave px-4 py-3 text-cuerpo-sm text-alerta-texto"
        >
          <p className="font-semibold">✗ {TEXTS.propuesta.errorTitulo}</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : null}

      <div className="sticky bottom-0 mt-5 flex flex-col gap-3 border-t border-borde bg-superficie py-3 sm:flex-row">
        <button
          type="button"
          onClick={confirmar}
          disabled={enVuelo || proposal.changes.length === 0}
          className="boton-principal"
        >
          {enVuelo ? TEXTS.propuesta.confirmando : TEXTS.propuesta.confirmar}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={enVuelo}
          className="boton-secundario"
        >
          {TEXTS.propuesta.descartar}
        </button>
      </div>
      </div>
    </dialog>
  );
}
