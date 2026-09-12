/**
 * Dinero en centavos enteros (MXN). Nunca usar floats para importes.
 *
 * Regla de redondeo documentada y unica para todo el proyecto:
 * "half up" sobre magnitud (round-half-away-from-zero). Se aplica al
 * convertir puntos base a centavos. Cualquier otro calculo monetario es
 * suma o resta de enteros.
 */

/** Importe en centavos. Entero con signo. */
export type Cents = number;

/** Limite de seguridad: PostgreSQL usa bigint, JavaScript solo garantiza 2^53-1. */
export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Valida que un valor sea un importe en centavos utilizable. */
export function assertCents(value: unknown, label = 'importe'): asserts value is Cents {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new MoneyError(`${label}: se esperaba un entero de centavos`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label}: fuera del rango seguro de JavaScript`);
  }
}

/** Convierte pesos (solo para fixtures y literales de documentacion) a centavos. */
export function pesos(amount: number): Cents {
  if (!Number.isFinite(amount)) throw new MoneyError('pesos: valor no finito');
  const cents = Math.round(amount * 100);
  // Detecta entradas con mas de dos decimales, que serian una perdida silenciosa.
  if (Math.abs(amount * 100 - cents) > 1e-6) {
    throw new MoneyError(`pesos: ${amount} tiene más de dos decimales`);
  }
  assertCents(cents, 'pesos');
  return cents;
}

/** Suma segura de centavos. */
export function addCents(...values: Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
    assertCents(total, 'suma');
  }
  return total;
}

/**
 * Aplica puntos base enteros a un importe en centavos.
 * 1 punto base = 0.01 %. Redondeo half-up sobre la magnitud.
 * Ejemplo del oraculo: 1_100_000 centavos al 200 bps => 22_000 centavos.
 */
export function applyBasisPoints(amountCents: Cents, basisPoints: number): Cents {
  assertCents(amountCents, 'base de puntos base');
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new MoneyError('puntos base: se espera un entero entre 0 y 10000');
  }
  const sign = amountCents < 0 ? -1 : 1;
  const magnitude = Math.abs(amountCents);
  const product = magnitude * basisPoints;
  assertCents(product, 'producto de puntos base');
  const rounded = Math.floor((product + 5_000) / 10_000);
  return sign * rounded;
}

/** Convierte un bigint de PostgreSQL comprobando rango antes de usarlo. */
export function centsFromDatabase(value: string | number | bigint, label = 'importe'): Cents {
  const asBigInt = typeof value === 'bigint' ? value : BigInt(String(value));
  if (asBigInt > BigInt(MAX_SAFE_CENTS) || asBigInt < BigInt(-MAX_SAFE_CENTS)) {
    throw new MoneyError(`${label}: el bigint excede el rango seguro de JavaScript`);
  }
  return Number(asBigInt);
}

const MXN_FORMAT = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formato de presentacion. Solo para UI; nunca para calculo. */
export function formatCents(value: Cents): string {
  assertCents(value, 'formato');
  return MXN_FORMAT.format(value / 100);
}
