import { describe, expect, it } from 'vitest';
import {
  addCents,
  applyBasisPoints,
  centsFromDatabase,
  formatCents,
  MoneyError,
  pesos,
} from '@/domain/money';

describe('centavos', () => {
  it('convierte pesos a centavos enteros', () => {
    expect(pesos(18_000)).toBe(1_800_000);
    expect(pesos(0.01)).toBe(1);
    expect(pesos(10_780)).toBe(1_078_000);
  });

  it('rechaza importes con mas de dos decimales', () => {
    expect(() => pesos(1.234)).toThrow(MoneyError);
  });

  it('rechaza no enteros al sumar', () => {
    expect(() => addCents(1, 2.5)).toThrow(MoneyError);
  });

  it('suma sin errores de coma flotante', () => {
    expect(addCents(pesos(0.1), pesos(0.2))).toBe(pesos(0.3));
  });

  it('convierte bigint de PostgreSQL comprobando rango', () => {
    expect(centsFromDatabase('1800000')).toBe(1_800_000);
    expect(() => centsFromDatabase('9007199254740993')).toThrow(MoneyError);
  });
});

describe('puntos base y redondeo', () => {
  it('reproduce el descuento del oraculo: 2 % sobre 11,000 = 220', () => {
    expect(applyBasisPoints(pesos(11_000), 200)).toBe(pesos(220));
  });

  it('redondea half-up sobre la magnitud', () => {
    // 100 centavos al 50 bps = 0.5 centavos -> 1
    expect(applyBasisPoints(100, 50)).toBe(1);
    // 100 centavos al 49 bps = 0.49 centavos -> 0
    expect(applyBasisPoints(100, 49)).toBe(0);
    // 300 centavos al 50 bps = 1.5 centavos -> 2
    expect(applyBasisPoints(300, 50)).toBe(2);
  });

  it('rechaza puntos base fuera de rango', () => {
    expect(() => applyBasisPoints(1_000, -1)).toThrow(MoneyError);
    expect(() => applyBasisPoints(1_000, 10_001)).toThrow(MoneyError);
    expect(() => applyBasisPoints(1_000, 1.5)).toThrow(MoneyError);
  });

  it('el neto siempre es importe menos costo', () => {
    const amount = pesos(11_000);
    const cost = applyBasisPoints(amount, 200);
    expect(amount - cost).toBe(pesos(10_780));
  });
});

describe('formato', () => {
  it('presenta importes en MXN con dos decimales', () => {
    expect(formatCents(pesos(1_234.5))).toContain('1,234.50');
  });

  it('formatea negativos sin perder el signo', () => {
    expect(formatCents(pesos(-7_000))).toMatch(/-/);
  });
});
