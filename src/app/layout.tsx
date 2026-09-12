import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { TEXTS } from '@/lib/texts';
import './globals.css';

const optimist = localFont({
  src: [
    { path: '../../public/fonts/Optimist-Rg.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/Optimist-SBd.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-optimist',
});

export const metadata: Metadata = {
  title: TEXTS.metadatos.titulo,
  description: TEXTS.metadatos.descripcion,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={optimist.variable}>
      <body className="min-h-screen bg-lienzo text-tinta antialiased">{children}</body>
    </html>
  );
}
