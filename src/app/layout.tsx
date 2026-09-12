import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { TEXTS } from '@/lib/texts';
import './globals.css';

/**
 * Inter es la tipografía del sistema de diseño. Se sirve desde el propio
 * proyecto: no hay peticiones a terceros en tiempo de ejecución.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: TEXTS.metadatos.titulo,
  description: TEXTS.metadatos.descripcion,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="min-h-screen bg-lienzo text-tinta antialiased">{children}</body>
    </html>
  );
}
