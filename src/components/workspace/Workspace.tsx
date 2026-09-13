'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError, BeforeAfter, ComposedView, Focus, MutationResponse, WorkspaceState } from '@/lib/contracts';
import { formatCents } from '@/domain/money';
import { TEXTS } from '@/lib/texts';
import type { HistoryEntry } from '@/components/blocks/History';
import Shell from './Shell';
import AlternativesModal from './AlternativesModal';
import SectionRenderer from './SectionRenderer';
import MessageComposer from './MessageComposer';

/**
 * Estado del área de trabajo y única puerta hacia la API.
 *
 * Invariantes:
 * - Una composición cuyo `resultId` no coincide con el resultado vigente se
 *   descarta EN SILENCIO: es una respuesta tardía de una petición anterior.
 * - Redimensionar la ventana no dispara ninguna llamada: no hay listeners de
 *   `resize` ni efectos que dependan del tamaño de la ventana.
 * - "Volver" deshace el último cambio de enfoque o de escenario sin borrar el historial: reactiva el escenario del servidor y restaura el enfoque.
 */
export interface WorkspaceProps {
  initialState: WorkspaceState;
}

interface Snapshot {
  state: WorkspaceState;
  focus: Focus;
  label: string;
}

/** Lectura tolerante del historial: la forma exacta la fija la persistencia. */
function parseHistory(payload: unknown): HistoryEntry[] {
  const bruto: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { entries?: unknown })?.entries)
      ? ((payload as { entries: unknown[] }).entries ?? [])
      : [];

  const entradas: HistoryEntry[] = [];
  for (const [index, item] of bruto.entries()) {
    if (typeof item !== 'object' || item === null) continue;
    const registro = item as Record<string, unknown>;
    entradas.push({
      id: typeof registro.id === 'string' ? registro.id : `evento-${index}`,
      recordedAt: typeof registro.recordedAt === 'string' ? registro.recordedAt : '',
      revision: typeof registro.revision === 'number' ? registro.revision : 0,
      eventType: typeof registro.eventType === 'string' ? registro.eventType : '',
      label: typeof registro.label === 'string' ? registro.label : '',
      detail: typeof registro.detail === 'string' ? registro.detail : undefined,
      kind: typeof registro.kind === 'string' ? registro.kind : undefined,
      undo: registro.undo && typeof registro.undo === 'object' ? {available:(registro.undo as {available?:unknown}).available === true, reason:typeof (registro.undo as {reason?:unknown}).reason === 'string' ? (registro.undo as {reason:string}).reason : undefined} : undefined,
    });
  }
  return entradas;
}

/**
 * Cuenta QUÉ cambió, no solo que algo cambió. Es el momento en el que el
 * usuario entiende que rechazar una acción mueve el resultado del motor y no
 * solo el texto de la pantalla. Todas las cifras vienen del resultado.
 */
function describirCambio(previo: WorkspaceState, nuevo: WorkspaceState): string {
  const antes = previo.result.baseline.shortfallCents;
  const despues = nuevo.result.baseline.shortfallCents;

  if (nuevo.result.infeasibility && !previo.result.infeasibility) {
    return TEXTS.shell.sinPlanes;
  }
  if (antes !== despues) {
    return TEXTS.riesgo.comparativa
      .replace('{antes}', formatCents(antes))
      .replace('{después}', formatCents(despues));
  }
  if (previo.result.plans.length !== nuevo.result.plans.length) {
    return TEXTS.shell.planesRestantes.replace('{n}', String(nuevo.result.plans.length));
  }
  return TEXTS.shell.cambioAplicado;
}

export default function Workspace({ initialState }: WorkspaceProps) {
  const [state, setState] = useState<WorkspaceState>(initialState);
  const [focus, setFocus] = useState<Focus>(initialState.view.spec.focus);
  const [pila, setPila] = useState<Snapshot[]>([]);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [selection, setSelection] = useState<{resultId:string;planId:string} | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const resetKey = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [beforeAfter, setBeforeAfter] = useState<BeforeAfter[]>([]);
  const historySeq = useRef(0);
  const undoKeys = useRef(new Map<string,string>());
  const [rejectingOptionId, setRejectingOptionId] = useState<string | null>(null);

  // El estado vigente, accesible desde callbacks asíncronos sin recrearlos.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Secuencia de composición: solo interesa la respuesta más reciente.
  const composeSeqRef = useRef(0);
  const visibleViewRef = useRef({ resultId: state.result.id, focus });
  useEffect(() => {
    const previous = visibleViewRef.current;
    visibleViewRef.current = { resultId: state.result.id, focus };
    if (previous.resultId === state.result.id && previous.focus === focus) return;
    const target = previous.resultId !== state.result.id ? '[aria-label="Estado de tu semana"]' : '[data-vista]';
    document.querySelector(target)?.scrollIntoView({ block: 'start' });
  }, [state.result.id, focus]);


  const cargarHistorial = useCallback(async (scenarioId: string) => {
    const seq = ++historySeq.current;
    setHistoryEntries([]); setBeforeAfter([]);
    try {
      const respuesta = await fetch(
        `/api/history?scenarioId=${encodeURIComponent(scenarioId)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!respuesta.ok) return;
      const payload = await respuesta.json();
      if (seq !== historySeq.current) return;
      setHistoryEntries(parseHistory(payload));
      setBeforeAfter(payload.beforeAfter ?? []);
    } catch {
      // El historial es informativo: si no responde, se muestra vacío y honesto.
    }
  }, []);

  useEffect(() => {
    void cargarHistorial(state.scenario.id);
    // Depende del escenario y su revisión, nunca del tamaño de la ventana.
  }, [cargarHistorial, state.scenario.id, state.scenario.revision]);

  /** Guarda el estado actual para que "Volver" pueda restaurarlo. */
  const apilar = useCallback((label: string) => {
    const actual: Snapshot = { state: stateRef.current, focus, label };
    setPila((previa) => [...previa, actual]);
  }, [focus]);

  const aplicarEstado = useCallback((nuevo: WorkspaceState, mensaje: string | null) => {
    setState(nuevo);
    setFocus(nuevo.view.spec.focus);
    setStatusMessage(mensaje);
  }, []);

  async function cambiarFoco(siguiente: Focus) {
    if (busy || siguiente === focus) return;
    const resultIdPedido = stateRef.current.result.id;

    setBusy(true);
    setStatusMessage(null);
    const seq = composeSeqRef.current + 1;
    composeSeqRef.current = seq;

    try {
      const respuesta = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultId: resultIdPedido, focus: siguiente }),
      });
      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => null)) as ApiError | null;
        setStatusMessage(cuerpo?.error ?? TEXTS.comunes.errorGenerico);
        return;
      }
      const vista = (await respuesta.json()) as ComposedView;

      // Petición superada por otra más reciente.
      if (seq !== composeSeqRef.current) return;
      // Composición obsoleta o ajena: se descarta en silencio.
      if (vista?.spec?.resultId !== stateRef.current.result.id) return;

      setFocus(vista.spec.focus);
      setState((previo) => ({ ...previo, view: vista }));
      setStatusMessage(null);
    } catch {
      setStatusMessage(TEXTS.redactor.errorRed);
    } finally {
      if (seq === composeSeqRef.current) setBusy(false);
    }
  }

  async function volver() {
    if (pila.length === 0 || busy) return;
    const previous = pila[pila.length - 1];
    composeSeqRef.current += 1;
    setBusy(true);
    try {
      const response = await fetch(`/api/scenarios/${encodeURIComponent(previous.state.scenario.id)}/activate`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({focus: previous.focus}),
      });
      if (!response.ok) throw new Error('No se pudo volver. Inténtalo otra vez.');
      const payload = await response.json() as MutationResponse;
      aplicarEstado(payload.state, 'Deshecho: ' + previous.label + '. Faltante: ' + formatCents(stateRef.current.result.baseline.shortfallCents) + ' → ' + formatCents(payload.state.result.baseline.shortfallCents) + '. Alternativas: ' + stateRef.current.result.plans.length + ' → ' + payload.state.result.plans.length + '.');
      setPila(old=>old.slice(0,-1));
    } catch { setStatusMessage('No se pudo volver. Tu escenario sigue igual.'); }
    finally { setBusy(false); }
  }

  async function rechazarAccion(optionId: string) {
    if (busy || rejectingOptionId !== null) return;
    const actual = stateRef.current;
    setBusy(true);
    setRejectingOptionId(optionId);
    setStatusMessage(null);

    try {
      const respuesta = await fetch(
        `/api/scenarios/${encodeURIComponent(actual.scenario.id)}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            optionId,
            baseRevision: actual.scenario.revision,
            idempotencyKey: crypto.randomUUID(),
            focus: 'payroll',
          }),
        },
      );

      if (respuesta.status === 409) {
        setStatusMessage(TEXTS.propuesta.conflictoCuerpo);
        await recargarEscenario();
        return;
      }
      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => null)) as ApiError | null;
        setStatusMessage(cuerpo?.error ?? TEXTS.comunes.errorGenerico);
        return;
      }

      const cuerpo = (await respuesta.json()) as MutationResponse;
      const action = actual.result.plans.flatMap(plan => plan.actions).find(action => action.optionId === optionId);
      if (!cuerpo.deduplicated) apilar('Descartar ' + (action ? action.counterparty + ': ' + action.description : 'una alternativa'));
      aplicarEstado(
        cuerpo.state,
        cuerpo.deduplicated
          ? TEXTS.propuesta.duplicado
          : 'Descartaste ' + (action?.counterparty ?? 'esta acción') + '. ' + describirCambio(actual, cuerpo.state),
      );
    } catch {
      setStatusMessage(TEXTS.redactor.errorRed);
    } finally {
      setRejectingOptionId(null);
      setBusy(false);
    }
  }

  async function reiniciarEjemplo() {
    if (busy) return;
    const actual = stateRef.current;
    resetKey.current ??= crypto.randomUUID();
    setBusy(true);
    try {
      const response = await fetch('/api/scenario/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:actual.scenario.id,baseRevision:actual.scenario.revision,idempotencyKey:resetKey.current})});
      if (!response.ok) {
        const body = await response.json() as ApiError;
        if (response.status === 409) { await recargarEscenario(); resetKey.current = null; }
        setStatusMessage(body.error);
        return;
      }
      const payload = await response.json() as MutationResponse;
      composeSeqRef.current += 1;
      historySeq.current += 1;
      setShowAlternatives(false);
      setSelection(null);
      setPila([]);
      setHistoryEntries([]);
      setBeforeAfter([]);
      undoKeys.current.clear();
      setComposerKey(key=>key+1);
      aplicarEstado(payload.state,'Ejemplo reiniciado. Prueba «Retraso de factura» para volver a comparar y descartar opciones.');
      resetKey.current = null;
    } catch { setStatusMessage(TEXTS.redactor.errorRed); }
    finally { setBusy(false); }
  }

  async function deshacerHistorial(eventId: string) {
    if (busy) return;
    const actual = stateRef.current;
    const key = actual.scenario.id + ':' + eventId;
    if (!undoKeys.current.has(key)) undoKeys.current.set(key,crypto.randomUUID());
    setBusy(true);
    setStatusMessage(null);
    try {
      const response = await fetch('/api/history/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId,scenarioId:actual.scenario.id,baseRevision:actual.scenario.revision,idempotencyKey:undoKeys.current.get(key)})});
      if (!response.ok) {
        const body = await response.json() as ApiError;
        if (response.status === 409) { await recargarEscenario(); await cargarHistorial(stateRef.current.scenario.id); }
        setStatusMessage(body.error);
        return;
      }
      const payload = await response.json() as MutationResponse;
      if (!payload.deduplicated) apilar('Deshacer una acción del historial');
      aplicarEstado(payload.state,'Acción deshecha. Faltante: ' + formatCents(actual.result.baseline.shortfallCents) + ' → ' + formatCents(payload.state.result.baseline.shortfallCents) + '. Alternativas: ' + actual.result.plans.length + ' → ' + payload.state.result.plans.length + '.');
    } catch { setStatusMessage(TEXTS.redactor.errorRed); }
    finally { setBusy(false); }
  }

  async function recargarEscenario() {
    try {
      const respuesta = await fetch('/api/scenario', { headers: { Accept: 'application/json' } });
      if (!respuesta.ok) return;
      const nuevo = (await respuesta.json()) as WorkspaceState;
      setState(nuevo);
      setFocus(nuevo.view.spec.focus);
    } catch {
      // Se conserva el estado actual: no se inventa uno nuevo.
    }
  }

  function propuestaAplicada(nuevo: WorkspaceState, deduplicated: boolean) {
    setShowAlternatives(nuevo.result.baseline.shortfallCents > 0);
    const previo = stateRef.current;
    const changed = nuevo.result.receivables.find(item => previo.result.receivables.some(old => old.obligationId === item.obligationId && old.date !== item.date));
    if (!deduplicated) apilar(changed ? 'Cambiar la fecha de ' + changed.concept : 'Actualizar los datos del escenario');
    aplicarEstado(
      nuevo,
      deduplicated ? TEXTS.propuesta.duplicado : describirCambio(previo, nuevo),
    );
  }

  function elegirPlan(planId: string) {
    if (!state.result.plans.some(plan=>plan.id===planId)) return;
    setSelection({resultId:state.result.id,planId});
    setShowAlternatives(false);
    setStatusMessage('Opción elegida para negociar. Revisa sus condiciones: todavía no cambia tus pagos.');
  }
  const selectedPlanId = selection?.resultId === state.result.id ? selection.planId : null;
  return (
    <><Shell
      state={state}
      focus={focus}
      onFocusChange={(siguiente) => void cambiarFoco(siguiente)}
      onBack={volver}
      onReset={() => void reiniciarEjemplo()}
      canGoBack={pila.length > 0}
      undoLabel={pila.at(-1)?.label}
      busy={busy}
      statusMessage={statusMessage}
      decisions={
        <MessageComposer
          key={composerKey}
          state={state}
          scenarioId={state.scenario.id}
          focus="payroll"
          onApplied={propuestaAplicada}
          busy={busy}
        />
      }
    >
      <SectionRenderer
        onSelectPlan={elegirPlan}
        selectedPlanId={selectedPlanId}
        spec={state.view.spec}
        result={state.result}
        enforcement={state.view.enforcement}
        historyEntries={historyEntries}
        beforeAfter={beforeAfter}
        onUndoHistory={eventId => void deshacerHistorial(eventId)}
        onRejectAction={(optionId) => void rechazarAccion(optionId)}
        rejectingOptionId={rejectingOptionId}
        busy={busy}
      />
    </Shell>
    {showAlternatives && <AlternativesModal state={state} busy={busy} rejectingOptionId={rejectingOptionId} onReject={optionId=>void rechazarAccion(optionId)} onSelect={elegirPlan} selectedPlanId={selectedPlanId} onClose={()=>setShowAlternatives(false)}/>}
    </>
  );
}
