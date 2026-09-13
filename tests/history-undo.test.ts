import { beforeEach, expect, it } from 'vitest';
import { activateScenario, confirmProposal, getHistory, getStore, getWorkspaceState, interpret, rejectAction, resetStoreForTests, undoHistoryAction } from '@/server/workspace';
import { DEMO_MESSAGE, DEFAULT_DEMO_TODAY } from '@fixtures/index';

beforeEach(()=>{ delete process.env.GEMINI_API_KEY; delete process.env.DATABASE_URL; process.env.DEMO_TODAY=DEFAULT_DEMO_TODAY; resetStoreForTests(); });
async function change(message=DEMO_MESSAGE) {
  const initial=await getWorkspaceState();
  const reply=await interpret(message);
  if(reply.kind!=='proposal') throw new Error('Falta propuesta');
  return (await confirmProposal(reply.proposal.id,initial.scenario.revision,crypto.randomUUID())).state;
}
async function undo(id:string,key:string=crypto.randomUUID()) {
  const current=await getWorkspaceState();
  return undoHistoryAction(id,current.scenario.id,current.scenario.revision,key);
}
it('deshace una fecha antigua conservando un rechazo posterior; no duplica el efecto',async()=>{
  const delayed=await change();
  const date=(await getHistory()).entries.find(e=>e.eventType==='receivable_rescheduled')!;
  const action=delayed.result.plans[0].actions[0].optionId;
  await rejectAction(delayed.scenario.id,action,delayed.scenario.revision,'reject');
  expect((await getHistory()).entries.find(e=>e.id===date.id)?.undo?.available).toBe(true);
  const result=await undo(date.id,'undo-date');
  expect(result.state.result.baseline.shortfallCents).toBe(0);
  expect(result.state.result.excludedActionIds).toContain(action);
  const count=(await getHistory()).entries.length;
  expect((await undo(date.id,'undo-date')).deduplicated).toBe(true);
  expect((await getHistory()).entries).toHaveLength(count);
  expect((await getHistory()).entries.find(e=>e.id===date.id)?.undo?.reason).toBe('Acción deshecha.');
  await expect(undo(date.id)).rejects.toThrow();
});
it('protege cambios más recientes del mismo dato y permite deshacerlos en orden',async()=>{
  await change();
  const first=(await getHistory()).entries.find(e=>e.eventType==='receivable_rescheduled')!;
  await change('La factura F-1042 se pagará el 21 de septiembre de 2026.');
  let entries=(await getHistory()).entries;
  expect(entries.find(e=>e.id===first.id)?.undo?.available).toBe(false);
  await expect(undo(first.id)).rejects.toThrow();
  const latest=entries.filter(e=>e.eventType==='receivable_rescheduled').at(-1)!;
  await undo(latest.id);
  entries=(await getHistory()).entries;
  expect(entries.find(e=>e.id===first.id)?.undo?.available).toBe(true);
  expect((await undo(first.id)).state.result.baseline.shortfallCents).toBe(0);
});
it('recupera la alternativa descartada sin alterar la fecha retrasada',async()=>{
  const delayed=await change();
  const action=delayed.result.plans[0].actions[0].optionId;
  await rejectAction(delayed.scenario.id,action,delayed.scenario.revision,'reject');
  const event=(await getHistory()).entries.find(e=>e.eventType==='scenario_constraint' && e.undo)!;
  const restored=(await undo(event.id)).state;
  expect(restored.result.excludedActionIds).not.toContain(action);
  expect(restored.result.baseline.shortfallCents).toBe(1_000_000);
  expect(restored.result.plans.map(p=>p.id)).toEqual(delayed.result.plans.map(p=>p.id));
});
it('revierte una reserva y conserva los cambios independientes',async()=>{
  const initial=await getWorkspaceState();
  const store=await getStore();
  await store.savePendingProposal({id:'reserve',scenarioId:initial.scenario.id,baseRevision:0,source:'manual',summary:'Reserva',changes:[{operation:{op:'set_minimum_cash',amountCents:500_000},evidence:'5000',humanDiff:'Reserva de 3000 a 5000'}]});
  await confirmProposal('reserve',0,'reserve-key');
  const event=(await getHistory()).entries.find(e=>e.undo)!;
  await change();
  const restored=(await undo(event.id)).state;
  expect(restored.result.minimumCashCents).toBe(300_000);
  expect(restored.result.receivables.find(r=>r.obligationId==='inv-a')?.date).toBe('2026-09-20');
});
it('una rama restaurada no permite deshacer acciones de otra rama',async()=>{
  const initial=await getWorkspaceState();
  await change();
  const event=(await getHistory()).entries.find(e=>e.undo)!;
  const restored=(await activateScenario(initial.scenario.id)).state;
  expect(restored.result.baseline.shortfallCents).toBe(0);
  expect((await getHistory()).entries.find(e=>e.id===event.id)).toBeUndefined();
  await expect(undo(event.id)).rejects.toThrow();
});
it('dos reversiones simultáneas no pisan datos y una fallida no consume la clave',async()=>{
  const delayed=await change();
  const action=delayed.result.plans[0].actions[0].optionId;
  const current=(await rejectAction(delayed.scenario.id,action,delayed.scenario.revision,'reject')).state;
  const decisions=(await getHistory()).entries.filter(e=>e.undo?.available);
  const responses=await Promise.allSettled(decisions.map((e,i)=>undoHistoryAction(e.id,current.scenario.id,current.scenario.revision,'parallel-'+i)));
  expect(responses.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const rejected=responses.findIndex(r=>r.status==='rejected');
  expect(await (await getStore()).getOperationRef('parallel-'+rejected)).toBeNull();
  expect((await undo(decisions[rejected].id,'parallel-'+rejected)).deduplicated).toBe(false);
});
it('reconstruye un cambio antiguo solo con su resultado anterior guardado',async()=>{
  await change();
  const store=await getStore();
  const current=await getWorkspaceState();
  const events=await store.listEvents(current.business.id);
  const event=events.find(e=>e.eventType==='receivable_rescheduled')!;
  delete event.payload.undo;
  expect((await getHistory()).entries.find(e=>e.id===event.eventId)?.undo?.available).toBe(true);
  expect((await undo(event.eventId)).state.result.baseline.shortfallCents).toBe(0);
});
