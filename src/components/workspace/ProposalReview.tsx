'use client';

import { useRef, useState } from 'react';
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
    <section
      aria-labelledby="propuesta-titulo"
      className="rounded border border-acento bg-acento-suave p-3"
    >
      <h3 id="propuesta-titulo" className="text-sm font-semibold">
        {TEXTS.propuesta.titulo}
      </h3>

      <dl className="mt-1 space-y-1 text-xs text-tinta-suave">
        <div>
          <dt className="inline font-semibold">{TEXTS.propuesta.resumenEtiqueta}: </dt>
          <dd className="inline text-tinta">{proposal.summary}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">{TEXTS.propuesta.fuenteEtiqueta}: </dt>
          <dd className="inline">{TEXTS.propuesta.fuente[proposal.source]}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">{TEXTS.propuesta.revisionBase}: </dt>
          <dd className="inline tabular-nums">{proposal.baseRevision}</dd>
        </div>
      </dl>

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
              <p className="mt-1">
                <span className="font-semibold">{TEXTS.propuesta.diffEtiqueta}: </span>
                {change.humanDiff}
              </p>
              <p className="mt-2 border-l-2 border-acento-borde pl-3 text-cuerpo-sm italic text-tinta-suave">
                <span className="not-italic font-semibold">
                  {TEXTS.propuesta.evidenciaEtiqueta}:{' '}
                </span>
                «{change.evidence}»
              </p>
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

      <div className="mt-4 flex flex-wrap gap-3">
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
    </section>
  );
}
