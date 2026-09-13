'use client';

import { useEffect, useRef, useState } from 'react';
import { AMBIGUOUS_MESSAGE, DEMO_MESSAGE } from '@fixtures/index';
import type {
  ApiError,
  Focus,
  InterpretResponse,
  PendingProposal,
  WorkspaceState,
} from '@/lib/contracts';
import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
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
  state: WorkspaceState;
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

function ClarificationModal({ clarification, onAccept }: {
  clarification: Aclaracion; onAccept: (option: string | null) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialogRef} onCancel={event => event.preventDefault()}
    aria-labelledby="aclaracion-titulo" aria-describedby="aclaracion-pregunta"
    className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border-0 bg-superficie p-0 text-tinta shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm">
    <div className="border-t-4 border-aviso p-5 sm:p-7">
      <h3 id="aclaracion-titulo" className="text-2xl font-semibold text-aviso-texto">{TEXTS.redactor.aclaracionTitulo}</h3>
      <p id="aclaracion-pregunta" className="mt-4 rounded-xl border border-aviso bg-aviso-suave p-4 text-aviso-texto text-cuerpo">{clarification.question}</p>
      <p className="mt-3 text-sm text-tinta-suave">{TEXTS.redactor.aclaracionCuerpo}</p>
      {clarification.options.length > 0 && <fieldset className="mt-4 space-y-2">
        <legend className="mb-2 text-sm font-semibold">{TEXTS.redactor.aclaracionOpcionesTitulo}</legend>
        {clarification.options.map(option => <label key={option} className="flex cursor-pointer items-start gap-3 rounded-xl border border-borde p-3 text-sm has-checked:border-aviso has-checked:bg-aviso-suave">
          <input type="radio" name="aclaracion-opcion" checked={selected === option} onChange={() => setSelected(option)} className="mt-1 accent-amber-700" />
          {option}
        </label>)}
      </fieldset>}
      <button type="button" className="boton-principal mt-5 w-full" onClick={() => onAccept(selected)}>Aceptar</button>
    </div>
  </dialog>;
}

export default function MessageComposer({
  scenarioId,
  state,
  focus,
  onApplied,
  busy,
}: MessageComposerProps) {
  const [mode, setMode] = useState<'guided' | 'message'>('guided');
  const [invoiceId, setInvoiceId] = useState('');
  const [action, setAction] = useState('delay');
  const [date, setDate] = useState('');
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
    if (mode === 'guided' && (!invoiceId || !date)) { setError('Selecciona la factura y la nueva fecha.'); return; }
    if (mode === 'message' && texto.length === 0) {
      limpiarRespuestas();
      setError(TEXTS.redactor.vacio);
      return;
    }

    setEnVuelo(true);
    limpiarRespuestas();
    try {
      const respuesta = await fetch(mode === 'guided' ? '/api/interpret/invoice' : '/api/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'guided' ? {scenarioId,baseRevision:state.scenario.revision,obligationId:invoiceId,action,newDate:date} : { message: texto, scenarioId }),
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
    setMode('message');
    setMensaje(texto);
    limpiarRespuestas();
  }

  const deshabilitado = enVuelo || busy === true;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2" aria-label="Cómo registrar el cambio">
        <button type="button" aria-pressed={mode === 'guided'} disabled={deshabilitado} onClick={()=>{setMode('guided');limpiarRespuestas();}} className={mode === 'guided' ? 'boton-principal' : 'boton-secundario'}>Elegir factura</button>
        <button type="button" aria-pressed={mode === 'message'} disabled={deshabilitado} onClick={()=>{setMode('message');limpiarRespuestas();}} className={mode === 'message' ? 'boton-principal' : 'boton-secundario'}>Pegar mensaje</button>
      </div>
      {mode === 'guided' ? <div className="space-y-3">
        <label className="block text-sm font-semibold">Factura pendiente de cobro
          <select className="campo mt-1" value={invoiceId} disabled={deshabilitado} onChange={e=>{setInvoiceId(e.target.value);setDate('');limpiarRespuestas();}}>
            <option value="">Selecciona una factura</option>
            {state.result.receivables.map(invoice=><option key={invoice.obligationId} value={invoice.obligationId}>{invoice.concept} · {invoice.counterparty} · {formatCents(invoice.amountCents)}</option>)}
          </select>
        </label>
        {state.result.receivables.find(invoice=>invoice.obligationId===invoiceId) && <p className="text-sm text-tinta-suave">Fecha actual: {formatEconomicDate(state.result.receivables.find(invoice=>invoice.obligationId===invoiceId)!.date)}</p>}
        <label className="block text-sm font-semibold">¿Qué pasará con el cobro?
          <select className="campo mt-1" value={action} disabled={deshabilitado} onChange={e=>{setAction(e.target.value);limpiarRespuestas();}}>
            <option value="delay">Se retrasará</option><option value="earlier">Se espera antes</option><option value="correct">Corregir la fecha esperada</option>
          </select>
        </label>
        <label className="block text-sm font-semibold">Nueva fecha esperada
          <input className="campo mt-1" type="date" min={state.scenario.demoToday} value={date} disabled={deshabilitado} onChange={e=>{setDate(e.target.value);limpiarRespuestas();}}/>
        </label>
        <p className="text-xs text-tinta-suave">Actualiza cuándo esperas cobrar. No registra dinero recibido ni un descuento.</p>
      </div> : <div>
        <label htmlFor="mensaje-cliente" className="text-cuerpo-sm font-semibold">
          {TEXTS.redactor.etiquetaTextarea}
        </label>
        <textarea
          id="mensaje-cliente"
          value={mensaje}
          onChange={(event) => setMensaje(event.target.value)}
          rows={2}
          placeholder={TEXTS.redactor.marcador}
          disabled={deshabilitado}
          className="campo mt-2 disabled:opacity-60"
        />
      </div>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={interpretar}
          disabled={deshabilitado}
          className="boton-principal w-full sm:w-auto"
        >
          {enVuelo ? TEXTS.redactor.interpretando : TEXTS.redactor.interpretar}
        </button>
        {mode === 'message' && mensaje.trim() !== '' ? (
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
        <details className="text-sm text-tinta-tenue"><summary>Probar con un ejemplo</summary><div className="mt-2 flex flex-wrap gap-2">
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
        </div></details>
      </div>

      {/*
        La aclaración es parte del recorrido, no un callejón sin salida: se
        conserva el aviso escrito y cada opción completa el mensaje para poder
        reintentar sin volver a empezar.
      */}
      {aclaracion !== null ? (
        <ClarificationModal clarification={aclaracion} onAccept={option => {
          if (option) setMensaje(previous => `${previous.trim()}\n\n${TEXTS.redactor.aclaracionPrefijo} ${option}`.trim());
          setAclaracion(null);
          requestAnimationFrame(() => document.getElementById('mensaje-cliente')?.focus());
        }} />
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
          {mode === 'message' && <p className="mt-1 text-pie">{TEXTS.redactor.errorManual}</p>}
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
