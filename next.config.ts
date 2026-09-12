import type { NextConfig } from 'next';

/**
 * Configuración mínima de la demo local. No se publica nada: la aplicación se
 * ejecuta en el equipo del usuario contra datos sintéticos.
 */
const nextConfig: NextConfig = {
  // Las pruebas de interfaz compilan en su propia carpeta para poder correr
  // sin detener la demo que ya esta abierta en `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  // AGENTS.md es un documento aprobado del proyecto: `next dev` no debe
  // añadirle su propio bloque de instrucciones.
  agentRules: false,
};

export default nextConfig;
