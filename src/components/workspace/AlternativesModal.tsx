'use client';
import { useEffect,useRef } from 'react';
import type { WorkspaceState } from '@/lib/contracts';
import { formatCents } from '@/domain/money';
import PlanComparison from '@/components/blocks/PlanComparison';

export default function AlternativesModal({state,busy,onClose,onReject,onSelect,selectedPlanId,rejectingOptionId}:{state:WorkspaceState;busy:boolean;onClose:()=>void;onReject:(id:string)=>void;onSelect:(id:string)=>void;selectedPlanId:string|null;rejectingOptionId:string|null}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=ref.current;const previous=document.body.style.overflow;
    dialog?.showModal();document.body.style.overflow='hidden';
    return ()=>{dialog?.close();document.body.style.overflow=previous;};
  },[]);
  const result=state.result;
  return <dialog ref={ref} onCancel={event=>{event.preventDefault();onClose();}} aria-labelledby="alternativas-titulo" className="m-auto w-[calc(100%-2rem)] max-w-3xl max-h-[90dvh] overflow-y-auto rounded-2xl border-0 bg-superficie p-0 text-tinta shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm">
    <div className="sticky top-0 z-10 flex justify-end border-b border-borde bg-superficie px-5 py-2"><button type="button" onClick={onClose} className="min-h-11 font-semibold text-acento">Cerrar y decidir después</button></div>
    <div className="p-5 sm:p-7">
      <h2 id="alternativas-titulo" className="text-2xl font-semibold text-acento-profundo">{result.infeasibility ? 'Todavía necesitas' : 'Necesitas'} {formatCents(result.infeasibility?.minimalResidualShortfallCents ?? result.baseline.shortfallCents)}</h2>
      <p className="mb-5 mt-2 text-sm text-tinta-suave">Para cubrir tus pagos y conservar tu reserva. Compara qué podrías negociar.</p>
      {busy && <p role="status" className="mb-3 text-sm text-acento">Actualizando las alternativas…</p>}
      {result.plans.length > 0 ? <PlanComparison result={result} section={{type:'plan_comparison',emphasis:'high',refs:result.plans.map(plan=>plan.id)}} parte="sintesis" onReject={onReject} onSelect={onSelect} selectedPlanId={selectedPlanId} rejectingOptionId={rejectingOptionId} busy={busy}/> : <p className="rounded-xl border border-aviso bg-aviso-suave p-4 text-aviso-texto">Con las opciones disponibles no alcanza. Cierra esta ventana para revisar las condiciones o deshacer un rechazo.</p>}
      <p className="mt-4 text-xs text-tinta-suave">Al cerrar, las opciones siguen en la pantalla. Elegir una opción no confirma acuerdos ni ejecuta pagos.</p>
    </div>
  </dialog>;
}
