/**
 * Fechas economicas en formato YYYY-MM-DD sobre el calendario America/Monterrey.
 * No se usa el reloj del equipo: DEMO_TODAY llega del dataset/entorno.
 * Los timestamps de auditoria son UTC y viven en la capa de persistencia.
 */

/** Fecha economica `YYYY-MM-DD`. */
export type EconomicDate = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateError';
  }
}

export function isEconomicDate(value: unknown): value is EconomicDate {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const utc = new Date(Date.UTC(y, m - 1, d));
  return (
    utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d
  );
}

export function assertEconomicDate(value: unknown, label = 'fecha'): asserts value is EconomicDate {
  if (!isEconomicDate(value)) {
    throw new DateError(`${label}: se esperaba una fecha económica YYYY-MM-DD válida`);
  }
}

function toUtcMillis(date: EconomicDate): number {
  assertEconomicDate(date);
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMillis(ms: number): EconomicDate {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DAY_MS = 86_400_000;

/** Suma dias calendario. Las fechas economicas no tienen hora ni zona. */
export function addDays(date: EconomicDate, days: number): EconomicDate {
  if (!Number.isInteger(days)) throw new DateError('addDays: se esperaba un entero de días');
  return fromUtcMillis(toUtcMillis(date) + days * DAY_MS);
}

/** Diferencia en dias completos (b - a). */
export function diffDays(a: EconomicDate, b: EconomicDate): number {
  return Math.round((toUtcMillis(b) - toUtcMillis(a)) / DAY_MS);
}

export function compareDates(a: EconomicDate, b: EconomicDate): number {
  assertEconomicDate(a);
  assertEconomicDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Genera el horizonte inclusivo de `days` fechas a partir de `start`. */
export function buildHorizon(start: EconomicDate, days: number): EconomicDate[] {
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new DateError('buildHorizon: días fuera de rango razonable');
  }
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

export function isWithin(date: EconomicDate, start: EconomicDate, end: EconomicDate): boolean {
  return compareDates(date, start) >= 0 && compareDates(date, end) <= 0;
}

const LONG_FORMAT = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});

/** Etiqueta corta para UI. La fecha economica se interpreta como dia natural. */
export function formatEconomicDate(date: EconomicDate): string {
  assertEconomicDate(date);
  return LONG_FORMAT.format(new Date(toUtcMillis(date)));
}

/** Zona del calendario economico de la demo. */
export const DEMO_TIMEZONE = 'America/Monterrey';
