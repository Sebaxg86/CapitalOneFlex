/**
 * Pruebas del renderer sobre funciones puras (entorno node, sin DOM).
 *
 * Se comprueba que tres situaciones distintas producen composiciones distintas
 * mediante el mismo renderer, que un tipo fuera del catálogo se ignora y que la
 * descripción de una integración nunca miente sobre su verificación.
 */
import { describe, expect, it } from 'vitest';
import { computeEngineResult } from '@/domain/engine';
import { buildFallbackViewSpec, type ViewSpec } from '@/server/ai/viewspec';
import {
  DEFAULT_DEMO_TODAY,
  demoScenario,
  withDelayedInvoiceA,
  withExclusions,
} from '@fixtures/index';
import { selectBlocksForSpec } from '@/components/workspace/SectionRenderer';
import { describeIntegration } from '@/components/workspace/Shell';
import type { IntegrationStatus } from '@/lib/contracts';

const T = DEFAULT_DEMO_TODAY;

/** Nómina en riesgo: la factura A se retrasa y quedan planes condicionados. */
const resultadoRiesgo = computeEngineResult(withDelayedInvoiceA(demoScenario(T)));
/** Sin solución: se rechazan las dos acciones que resolvían el faltante. */
const resultadoBloqueado = computeEngineResult(
  withExclusions(withDelayedInvoiceA(demoScenario(T)), ['action:S', 'action:C', 'action:D']),
);

describe('selectBlocksForSpec', () => {
  it('produce listas de bloques distintas para tres situaciones distintas', () => {
    const riesgo = selectBlocksForSpec(buildFallbackViewSpec(resultadoRiesgo, 'payroll'));
    const cobros = selectBlocksForSpec(buildFallbackViewSpec(resultadoRiesgo, 'receivables'));
    const sinSolucion = selectBlocksForSpec(
      buildFallbackViewSpec(resultadoBloqueado, 'no_solution'),
    );

    // Cada situación debe aportar bloques reales.
    for (const lista of [riesgo, cobros, sinSolucion]) {
      expect(lista.length).toBeGreaterThan(0);
    }

    const firmas = [riesgo, cobros, sinSolucion].map((lista) => lista.join('|'));
    expect(new Set(firmas).size).toBe(3);

    // El foco de cobros pone las facturas primero; el bloqueo, las restricciones.
    expect(cobros[0]).toBe('receivables');
    expect(sinSolucion[0]).toBe('constraints');
    // Sin planes no puede aparecer el comparador.
    expect(resultadoBloqueado.plans).toHaveLength(0);
    expect(sinSolucion).not.toContain('plan_comparison');
    // Con planes, el comparador es obligatorio.
    expect(resultadoRiesgo.plans.length).toBeGreaterThan(0);
    expect(riesgo).toContain('plan_comparison');
  });

  it('ignora un tipo de sección fuera del catálogo', () => {
    const spec = {
      schemaVersion: 1,
      resultId: resultadoRiesgo.id,
      focus: 'payroll',
      sections: [
        { type: 'risk_summary', emphasis: 'high', refs: [] },
        { type: 'iframe_libre', emphasis: 'high', refs: [] },
        { type: 'script', emphasis: 'normal', refs: [] },
        { type: 'cash_calendar', emphasis: 'normal', refs: [] },
      ],
    } as unknown as ViewSpec;

    expect(selectBlocksForSpec(spec)).toEqual(['risk_summary', 'cash_calendar']);
  });

  it('no repite un bloque aunque la composición traiga el tipo dos veces', () => {
    const spec = {
      schemaVersion: 1,
      resultId: resultadoRiesgo.id,
      focus: 'overview',
      sections: [
        { type: 'constraints', emphasis: 'high', refs: [] },
        { type: 'constraints', emphasis: 'low', refs: [] },
      ],
    } as unknown as ViewSpec;

    expect(selectBlocksForSpec(spec)).toEqual(['constraints']);
  });
});

describe('describeIntegration', () => {
  const combinaciones: IntegrationStatus[] = [
    { configured: false, verified: false, detail: 'sin clave' },
    { configured: true, verified: false, detail: 'clave presente' },
    // Caso imposible por contrato, pero la función debe seguir sin mentir.
    { configured: false, verified: true, detail: 'incoherente' },
  ];

  it('nunca describe como verificado un proveedor sin verificación', () => {
    for (const status of combinaciones) {
      expect(status.verified && status.configured).toBe(false);
      expect(describeIntegration(status).toLowerCase()).not.toContain('verificado');
    }
  });

  it('describe como verificado solo cuando se comprobó de verdad', () => {
    const verificado = describeIntegration({
      configured: true,
      verified: true,
      detail: 'comprobado',
    });
    expect(verificado.toLowerCase()).toContain('verificado');
  });

  it('distingue los tres estados con textos diferentes', () => {
    const textos = new Set([
      describeIntegration({ configured: false, verified: false, detail: '' }),
      describeIntegration({ configured: true, verified: false, detail: '' }),
      describeIntegration({ configured: true, verified: true, detail: '' }),
    ]);
    expect(textos.size).toBe(3);
  });
});
