/**
 * La gramática espacial del renderer.
 *
 * El modelo decide selección, orden y énfasis. El renderer aplica una
 * gramática pública y determinista que debe funcionar para CUALQUIER
 * permutación de los seis componentes, sin convertirse en una plantilla fija.
 */
import { describe, expect, it } from 'vitest';
import {
  agruparEnFilas,
  indiceAbiertoInicial,
  ocupaFilaCompleta,
} from '@/components/workspace/SectionRenderer';
import { COMPONENT_TYPES, type ViewSpecSection, type Emphasis } from '@/server/ai/viewspec';

const s = (type: ViewSpecSection['type'], emphasis: Emphasis): ViewSpecSection => ({
  type,
  emphasis,
  refs: [],
});

const tipos = (filas: ViewSpecSection[][]) => filas.map((f) => f.map((x) => x.type));

describe('qué ocupa la fila entera', () => {
  it('cualquier sección destacada ocupa la fila', () => {
    for (const type of COMPONENT_TYPES) {
      expect(ocupaFilaCompleta(s(type, 'high'))).toBe(true);
    }
  });

  it('comparador, calendario e historial la ocupan con cualquier énfasis', () => {
    for (const type of ['plan_comparison', 'cash_calendar', 'history'] as const) {
      for (const emphasis of ['high', 'normal', 'low'] as const) {
        expect(ocupaFilaCompleta(s(type, emphasis))).toBe(true);
      }
    }
  });

  it('riesgo, cobros y restricciones admiten media anchura si no están destacados', () => {
    for (const type of ['risk_summary', 'receivables', 'constraints'] as const) {
      expect(ocupaFilaCompleta(s(type, 'normal'))).toBe(false);
      expect(ocupaFilaCompleta(s(type, 'low'))).toBe(false);
    }
  });
});

describe('agrupación en filas', () => {
  it('nunca reordena: el orden de salida es el de entrada', () => {
    const entrada = [
      s('constraints', 'low'),
      s('risk_summary', 'high'),
      s('receivables', 'normal'),
      s('cash_calendar', 'low'),
    ];
    expect(tipos(agruparEnFilas(entrada)).flat()).toEqual(entrada.map((x) => x.type));
  });

  it('un destacado al final se queda al final: protagonismo no es precedencia', () => {
    const entrada = [s('receivables', 'low'), s('constraints', 'low'), s('risk_summary', 'high')];
    const filas = agruparEnFilas(entrada);
    expect(tipos(filas)).toEqual([['receivables', 'constraints'], ['risk_summary']]);
  });

  it('dos medias anchuras consecutivas comparten fila', () => {
    const filas = agruparEnFilas([s('risk_summary', 'normal'), s('constraints', 'low')]);
    expect(tipos(filas)).toEqual([['risk_summary', 'constraints']]);
  });

  it('si el siguiente pide fila entera, el anterior ocupa la suya solo', () => {
    const filas = agruparEnFilas([s('receivables', 'normal'), s('plan_comparison', 'low')]);
    expect(tipos(filas)).toEqual([['receivables'], ['plan_comparison']]);
  });

  it('nunca busca un bloque posterior para rellenar un hueco', () => {
    const filas = agruparEnFilas([
      s('receivables', 'normal'),
      s('cash_calendar', 'normal'),
      s('constraints', 'normal'),
    ]);
    // `constraints` NO sube a compartir fila con `receivables`.
    expect(tipos(filas)).toEqual([['receivables'], ['cash_calendar'], ['constraints']]);
  });

  it('funciona si todo es destacado', () => {
    const entrada = COMPONENT_TYPES.map((t) => s(t, 'high'));
    const filas = agruparEnFilas(entrada);
    expect(filas.every((f) => f.length === 1)).toBe(true);
    expect(filas).toHaveLength(COMPONENT_TYPES.length);
  });

  it('funciona si todo es secundario', () => {
    const entrada = COMPONENT_TYPES.map((t) => s(t, 'low'));
    const filas = agruparEnFilas(entrada);
    expect(filas.flat()).toHaveLength(COMPONENT_TYPES.length);
    expect(tipos(filas).flat()).toEqual([...COMPONENT_TYPES]);
  });

  it('ninguna sección se pierde ni se duplica, en cualquier permutación', () => {
    const base = COMPONENT_TYPES.map((t, i) =>
      s(t, (['high', 'normal', 'low'] as const)[i % 3]),
    );
    // Rotaciones: seis órdenes distintos del mismo conjunto.
    for (let giro = 0; giro < base.length; giro += 1) {
      const entrada = [...base.slice(giro), ...base.slice(0, giro)];
      const salida = agruparEnFilas(entrada).flat();
      expect(salida.map((x) => x.type)).toEqual(entrada.map((x) => x.type));
    }
  });

  it('ninguna fila tiene más de dos columnas', () => {
    const entrada = COMPONENT_TYPES.map((t) => s(t, 'normal'));
    for (const fila of agruparEnFilas(entrada)) {
      expect(fila.length).toBeLessThanOrEqual(2);
    }
  });

  it('una composición vacía no produce filas', () => {
    expect(agruparEnFilas([])).toEqual([]);
  });
});

describe('regla de apertura: un solo detalle abierto', () => {
  it('abre el primer bloque con el mayor énfasis presente', () => {
    const entrada = [s('receivables', 'low'), s('constraints', 'high'), s('risk_summary', 'high')];
    expect(indiceAbiertoInicial(entrada)).toBe(1);
  });

  it('un destacado al final se abre allí: no sube de posición', () => {
    const entrada = [s('receivables', 'normal'), s('constraints', 'normal'), s('risk_summary', 'high')];
    expect(indiceAbiertoInicial(entrada)).toBe(2);
  });

  it('si no hay destacados, abre el primer normal', () => {
    const entrada = [s('receivables', 'low'), s('constraints', 'normal'), s('history', 'low')];
    expect(indiceAbiertoInicial(entrada)).toBe(1);
  });

  it('casos degenerados: todo igual abre el primero', () => {
    for (const nivel of ['high', 'normal', 'low'] as const) {
      const entrada = COMPONENT_TYPES.map((t) => s(t, nivel));
      expect(indiceAbiertoInicial(entrada)).toBe(0);
    }
  });

  it('con una sola sección, abre esa', () => {
    expect(indiceAbiertoInicial([s('history', 'low')])).toBe(0);
  });

  it('sin secciones no abre ninguna', () => {
    expect(indiceAbiertoInicial([])).toBe(-1);
  });

  it('siempre abre exactamente una, en cualquier permutación', () => {
    const base = COMPONENT_TYPES.map((t, i) => s(t, (['high', 'normal', 'low'] as const)[i % 3]));
    for (let giro = 0; giro < base.length; giro += 1) {
      const entrada = [...base.slice(giro), ...base.slice(0, giro)];
      const indice = indiceAbiertoInicial(entrada);
      expect(indice).toBeGreaterThanOrEqual(0);
      expect(indice).toBeLessThan(entrada.length);
      // Y es el primero de su nivel: ninguno anterior tiene más énfasis.
      const nivel = entrada[indice].emphasis;
      expect(entrada.slice(0, indice).every((x) => x.emphasis !== nivel)).toBe(true);
    }
  });
});
