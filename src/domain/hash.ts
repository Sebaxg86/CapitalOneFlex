/**
 * Huella estable y determinista para entradas del motor.
 * Implementacion propia (FNV-1a de 64 bits sobre BigInt) para no depender de
 * modulos de Node en codigo que tambien se importa desde el bundle de React.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

export function stableHash(value: unknown): string {
  const json = canonicalJson(value);
  let hash = FNV_OFFSET;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= BigInt(json.charCodeAt(i) & 0xff);
    hash = (hash * FNV_PRIME) & MASK64;
    hash ^= BigInt(json.charCodeAt(i) >>> 8);
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash.toString(16).padStart(16, '0');
}

/** JSON con claves ordenadas: dos objetos equivalentes producen el mismo texto. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
}
