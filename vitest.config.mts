import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // El tsconfig de Next usa `jsx: "preserve"` porque la transformacion la hace Next.
  // El transformador de Vite no puede ejecutar eso, asi que aqui se pide la
  // transformacion automatica; sin ella no se pueden importar en pruebas las
  // funciones puras que viven en archivos .tsx (tests/renderer.test.ts).
  oxc: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Las pruebas live solo corren cuando estan configuradas de verdad.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@fixtures': fileURLToPath(new URL('./fixtures', import.meta.url)),
    },
  },
});
