'use client';

import { useState } from 'react';
import { AMBIGUOUS_MESSAGE, DEMO_MESSAGE } from '@fixtures/index';
import type {
  ApiError,
  Focus,
  InterpretResponse,
  PendingProposal,
  WorkspaceState,
} from '@/lib/contracts';
import { TEXTS } from '@/lib/texts';
import ProposalReview from './ProposalReview';

/**
 * Redactor del aviso del cliente.
 *
 * Interpretar NUNCA cambia datos: devuelve una aclaración, una propuesta que
 * hay que confirmar, o un error que deja abierto el flujo manual.
 */
export interface MessageComposerProps {
  scenarioId: string;
  /** Enfoque vigente: se conserva al recomponer tras confirmar. */
  focus: Focus;
  onApplied: (state: WorkspaceState, deduplicated: boolean) => void;
  busy?: boolean;
}

interface Aclaracion {
  question: string;
  options: string[];
  source: 'gemini' | 'fallback';
}

export default function MessageComposer({
  scenarioId,
  focus,
  onApplied,
  busy,
}: MessageComposerProps) {
  const [mensaje, setMensaje] = useState('');
  const [enVuelo, setEnVuelo] = useState(false);
  const [propuesta, setPropuesta] = useState<PendingProposal | null>(null);
  const [aclaracion, setAclaracion] = useState<Aclaracion | null>(null);
  const [error, setError] = useState<string | null>(null);

  function limpiarRespuestas() {
    setPropuesta(null);
    setAclaracion(null);
    setError(null);
  }

  async function interpretar() {
    if (enVuelo) return;
    const texto = mensaje.trim();
    if (texto.length === 0) {
      limpiarRespuestas();
      setError(TEXTS.redactor.vacio);
      return;
    }

    setEnVuelo(true);
    limpiarRespuestas();
    try {
      const respuesta = await fetch('/api/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: texto, scenarioId }),
      });

      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => null)) as ApiError | null;
        setError(cuerpo?.error ?? TEXTS.comunes.errorGenerico);
        return;
      }

      const cuerpo = (await respuesta.json()) as InterpretResponse;
      if (cuerpo.kind === 'proposal') {
        setPropuesta(cuerpo.proposal);
      } else if (cuerpo.kind === 'clarification') {
        setAclaracion({
          question: cuerpo.question,
          options: cuerpo.options,
          source: cuerpo.source,
        });
      } else {
        setError(cuerpo.message);
      }
    } catch {
      setError(TEXTS.redactor.errorRed);
    } finally {
      setEnVuelo(false);
    }
  }

  function usarEjemplo(texto: string) {
    setMensaje(texto);
    limpiarRespuestas();
  }

  const deshabilitado = enVuelo || busy === true;

  return (
    <div className="space-y-4">
      {/* Primer uso: sin esta línea el usuario no sabe por dónde empezar. */}
      {mensaje.trim() === '' && propuesta === null && aclaracion === null && error === null ? (
        <p className="text-cuerpo text-tinta-suave">
          <span className="font-semibold text-tinta">{TEXTS.shell.bienvenidaTitulo}</span>{' '}
          {TEXTS.shell.bienvenidaCuerpo}
        </p>
      ) : null}

      <div>
        <label htmlFor="mensaje-cliente" className="text-cuerpo-sm font-semibold">
          {TEXTS.redactor.etiquetaTextarea}
        </label>
        <textarea
          id="mensaje-cliente"
          value={mensaje}
          onChange={(event) => setMensaje(event.target.value)}
          rows={3}
          placeholder={TEXTS.redactor.marcador}
          disabled={deshabilitado}
          className="campo mt-2 disabled:opacity-60"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={interpretar}
          disabled={deshabilitado}
          className="boton-principal"
        >
          {enVuelo ? TEXTS.redactor.interpretando : TEXTS.redactor.interpretar}
        </button>
        {mensaje.trim() !== '' ? (
          <button
            type="button"
            onClick={() => {
              setMensaje('');
              limpiarRespuestas();
            }}
            disabled={deshabilitado}
            className="text-cuerpo-sm font-semibold text-acento hover:text-acento-fuerte disabled:opacity-60"
          >
            {TEXTS.redactor.limpiar}
          </button>
        ) : null}

        {/* Ejemplos del fixture, discretos y rotulados. */}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-pie text-tinta-tenue">
          {TEXTS.redactor.ejemplosAyuda}
          <button
            type="button"
            onClick={() => usarEjemplo(DEMO_MESSAGE)}
            disabled={deshabilitado}
            className="pildora min-h-[1.75rem]! px-3! text-pie! disabled:opacity-60"
          >
            {TEXTS.redactor.ejemploDemo}
          </button>
          <button
            type="button"
            onClick={() => usarEjemplo(AMBIGUOUS_MESSAGE)}
            disabled={deshabilitado}
            className="pildora min-h-[1.75rem]! px-3! text-pie! disabled:opacity-60"
          >
            {TEXTS.redactor.ejemploAmbiguo}
          </button>
        </span>
      </div>

      {/*
        La aclaración es parte del recorrido, no un callejón sin salida: se
        conserva el aviso escrito y cada opción completa el mensaje para poder
        reintentar sin volver a empezar.
      */}
      {aclaracion !== null ? (
        <section
          aria-labelledby="aclaracion-titulo"
          className="rounded-tarjeta border border-aviso bg-aviso-suave px-4 py-3 text-cuerpo-sm text-aviso-texto"
        >
          <h3 id="aclaracion-titulo" className="font-semibold">
            ? {TEXTS.redactor.aclaracionTitulo}
          </h3>
          <p className="mt-1 text-cuerpo text-tinta">{aclaracion.question}</p>
          <p className="mt-1 text-pie">{TEXTS.redactor.aclaracionCuerpo}</p>
          {aclaracion.options.length > 0 ? (
            <>
              <h4 className="rotulo mt-3">{TEXTS.redactor.aclaracionOpcionesTitulo}</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {aclaracion.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={deshabilitado}
                    onClick={() => {
                      setMensaje((previo) =>
                        `${previo.trim()}\n\n${TEXTS.redactor.aclaracionPrefijo} ${option}`.trim(),
                      );
                      limpiarRespuestas();
                    }}
                    className="pildora disabled:opacity-60"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <p className="mt-2 text-pie">{TEXTS.redactor.aclaracionFuente[aclaracion.source]}</p>
        </section>
      ) : null}

      {error !== null ? (
        <section
          aria-labelledby="error-interpretacion"
          className="rounded-tarjeta border border-alerta bg-alerta-suave px-4 py-3 text-cuerpo-sm text-alerta-texto"
        >
          <h3 id="error-interpretacion" className="font-semibold">
            ✗ {TEXTS.redactor.errorTitulo}
          </h3>
          <p className="mt-1">{error}</p>
          <p className="mt-1 text-pie">{TEXTS.redactor.errorManual}</p>
        </section>
      ) : null}

      {propuesta !== null ? (
        <ProposalReview
          proposal={propuesta}
          focus={focus}
          onApplied={(state, deduplicated) => {
            setPropuesta(null);
            setMensaje('');
            onApplied(state, deduplicated);
          }}
          onDiscard={() => setPropuesta(null)}
        />
      ) : null}
    </div>
  );
}
