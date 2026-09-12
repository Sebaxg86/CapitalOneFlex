'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError, BeforeAfter, ComposedView, Focus, MutationResponse, WorkspaceState } from '@/lib/contracts';
import { formatCents } from '@/domain/money';
import { TEXTS } from '@/lib/texts';
import type { HistoryEntry } from '@/components/blocks/History';
import Shell from './Shell';
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
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [beforeAfter, setBeforeAfter] = useState<BeforeAfter[]>([]);
  const historySeq = useRef(0);
  const [rejectingOptionId, setRejectingOptionId] = useState<string | null>(null);

  // El estado vigente, accesible desde callbacks asíncronos sin recrearlos.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Secuencia de composición: solo interesa la respuesta más reciente.
  const composeSeqRef = useRef(0);

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
  const apilar = useCallback(() => {
    const actual: Snapshot = { state: stateRef.current, focus };
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
    apilar();
    setFocus(siguiente);
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
      aplicarEstado(payload.state, 'Volviste al escenario anterior.');
      setPila(old=>old.slice(0,-1));
    } catch { setStatusMessage('No se pudo volver. Tu escenario sigue igual.'); }
    finally { setBusy(false); }
  }

  async function rechazarAccion(optionId: string) {
    if (busy || rejectingOptionId !== null) return;
    const actual = stateRef.current;
    apilar();
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
            focus,
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
      aplicarEstado(
        cuerpo.state,
        cuerpo.deduplicated
          ? TEXTS.propuesta.duplicado
          : describirCambio(actual, cuerpo.state),
      );
    } catch {
      setStatusMessage(TEXTS.redactor.errorRed);
    } finally {
      setRejectingOptionId(null);
      setBusy(false);
    }
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
    const previo = stateRef.current;
    apilar();
    aplicarEstado(
      nuevo,
      deduplicated ? TEXTS.propuesta.duplicado : describirCambio(previo, nuevo),
    );
  }

  return (
    <Shell
      state={state}
      focus={focus}
      onFocusChange={(siguiente) => void cambiarFoco(siguiente)}
      onBack={volver}
      canGoBack={pila.length > 0}
      busy={busy}
      statusMessage={statusMessage}
      decisions={
        <MessageComposer
          scenarioId={state.scenario.id}
          focus={focus}
          onApplied={propuestaAplicada}
          busy={busy}
        />
      }
    >
      <SectionRenderer
        spec={state.view.spec}
        result={state.result}
        enforcement={state.view.enforcement}
        historyEntries={historyEntries}
        beforeAfter={beforeAfter}
        onRejectAction={(optionId) => void rechazarAccion(optionId)}
        rejectingOptionId={rejectingOptionId}
        busy={busy}
      />
    </Shell>
  );
}
