import { TEXTS } from '@/lib/texts';

/**
 * Marca del producto. Dibujada aquí como SVG: no hay archivo que descargar ni
 * marca ajena implicada.
 *
 * El símbolo repite el gesto que el usuario ya reconoce del calendario: la
 * línea de caja mínima y las barras de saldo cruzándola, una por debajo y dos
 * por encima. Es el producto explicado en veinte píxeles.
 */
export function Isotipo({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={TEXTS.marca.nombre}
      className={className}
      focusable="false"
    >
      <rect width="32" height="32" rx="7" fill="var(--color-acento)" />
      {/* Barras de saldo: la primera cae bajo la línea, las otras la superan. */}
      <rect x="7" y="17" width="4" height="8" rx="1.4" fill="#ffffff" opacity="0.55" />
      <rect x="14" y="11" width="4" height="14" rx="1.4" fill="#ffffff" />
      <rect x="21" y="7" width="4" height="18" rx="1.4" fill="#ffffff" />
      {/* Línea de caja mínima. */}
      <rect x="4" y="15.1" width="24" height="1.8" rx="0.9" fill="#ffffff" opacity="0.95" />
    </svg>
  );
}

/** Isotipo + nombre. El bloque de marca del encabezado. */
export default function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <Isotipo className="h-8 w-8 shrink-0" />
      <span className="text-titular-md font-bold tracking-tight text-acento-profundo">
        {TEXTS.marca.nombre}
      </span>
    </span>
  );
}
