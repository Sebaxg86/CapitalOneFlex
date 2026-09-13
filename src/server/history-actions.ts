import { z } from 'zod';
import type { ScenarioInput } from '@/domain/types';
import type { ProposalOperation } from '@/lib/contracts';

export const undoPatchSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('date'), id:z.string(), before:z.string(), after:z.string()}),
  z.object({kind:z.literal('reserve'), before:z.number().int().nonnegative(), after:z.number().int().nonnegative()}),
  z.object({kind:z.literal('excluded'), id:z.string(), before:z.boolean(), after:z.boolean()}),
]);
export type UndoPatch = z.infer<typeof undoPatchSchema>;
export const patchKey = (p: UndoPatch) => p.kind === 'reserve' ? 'reserve' : p.kind + ':' + p.id;
export function patchForOperation(input: ScenarioInput, operation: ProposalOperation): UndoPatch {
  if (operation.op === 'reschedule_receivable') {
    const obligation = input.obligations.find(o => o.id === operation.obligationId);
    if (!obligation) throw new Error('factura inexistente');
    return {kind:'date', id:obligation.id, before:obligation.date, after:operation.newDate};
  }
  if (operation.op === 'exclude_action') return {kind:'excluded', id:operation.optionId, before:input.excludedActionIds.includes(operation.optionId), after:true};
  return {kind:'reserve', before:input.minimumCashCents, after:operation.amountCents};
}
export function matchesPatch(input: ScenarioInput, p: UndoPatch): boolean {
  if (p.kind === 'reserve') return input.minimumCashCents === p.after;
  if (p.kind === 'date') return input.obligations.find(o=>o.id===p.id)?.date === p.after;
  return input.obligations.some(o=>o.actions.some(a=>a.id===p.id)) && input.excludedActionIds.includes(p.id) === p.after;
}
export function reversePatch(input: ScenarioInput, p: UndoPatch): ScenarioInput {
  if (!matchesPatch(input,p)) throw new Error('El dato cambió después de esta acción');
  if (p.kind === 'reserve') return {...input, minimumCashCents:p.before};
  if (p.kind === 'date') return {...input, obligations:input.obligations.map(o=>o.id===p.id ? {...o,date:p.before} : o)};
  return {...input, excludedActionIds:p.before ? [...new Set([...input.excludedActionIds,p.id])].sort() : input.excludedActionIds.filter(id=>id!==p.id)};
}
