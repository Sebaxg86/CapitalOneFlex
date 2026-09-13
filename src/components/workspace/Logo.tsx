import Image from 'next/image';

/** Recurso SVG original del encabezado público de capitalone.com. */
export default function Logo() {
  return <span className="inline-flex items-center gap-3 sm:gap-4">
    <Image src="/brand/capital-one.svg" alt="Capital One" width={418} height={150} className="h-auto w-[118px] sm:w-[140px]" priority unoptimized/>
    <span aria-hidden="true" className="h-7 w-px bg-borde"/><span className="text-[28px] font-semibold leading-none tracking-tight text-acento-profundo sm:text-[32px]">Flex</span>
  </span>;
}
