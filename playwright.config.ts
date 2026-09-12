import { defineConfig, devices } from '@playwright/test';

/**
 * Recorrido de interfaz contra un servidor de desarrollo propio.
 *
 * Se usa un puerto distinto al de `npm run dev` para no chocar con una demo ya
 * abierta, y cada ejecucion arranca un proceso nuevo: el almacen en memoria
 * parte siempre de la semana inicial.
 */
const PORT = Number(process.env.E2E_PORT ?? 3211);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: 'http://localhost:' + String(PORT),
    trace: 'retain-on-failure',
    locale: 'es-MX',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build propio en `.next-e2e`: Next no admite dos servidores de desarrollo
    // en la misma carpeta, y asi el recorrido corre sin cerrar la demo abierta.
    command: 'npx next build && npx next start -p ' + String(PORT),
    url: 'http://localhost:' + String(PORT),
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NEXT_DIST_DIR: '.next-e2e',
      DEMO_TODAY: process.env.DEMO_TODAY ?? '2026-09-12',
      // El recorrido de interfaz comprueba el renderer y los invariantes de la
      // vista, no al proveedor: corre siempre con la composicion determinista
      // del servidor y el escenario en memoria, para que sea reproducible.
      // La verificacion contra Gemini y Tiger Data reales vive en
      // `npm run check:providers` y `npm run demo:walkthrough`.
      GEMINI_API_KEY: '',
      DATABASE_URL: '',
    },
  },
});
