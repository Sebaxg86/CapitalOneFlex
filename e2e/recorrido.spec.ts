/**
 * Recorrido de interfaz de las tres situaciones del producto.
 *
 * Comprueba la gramática de composición, que los controles críticos no se
 * mueven al recomponerse la zona central, y que la inviabilidad y las
 * condiciones de aceptación nunca se ocultan.
 *
 * Las pruebas comparten un único servidor y el escenario vive en la memoria de
 * ese proceso, así que el recorrido que muta el escenario es un solo caso
 * serializado: partir de la semana inicial es parte del contrato.
 */
import { expect, test, type Page } from '@playwright/test';
import { TEXTS } from '../src/lib/texts';

test.describe.configure({ mode: 'serial' });

const MENSAJE_DEMO =
  'Hola, les aviso que el pago de la factura F-1042 se nos recorre: tesoreria la programo para el 20 de septiembre. Disculpen la demora.';
const MENSAJE_AMBIGUO =
  'Oigan, la factura de Arcadia se va a atrasar un poco, les aviso luego con calma.';

/** La barra de acciones: su posición no puede depender de la composición. */
const BARRA = '[data-barra-acciones]';

/** Tipos de sección visibles, en el orden en que los pinta el renderer. */
async function seccionesVisibles(page: Page): Promise<string[]> {
  return page
    .locator('[data-seccion]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-seccion') ?? ''));
}

async function interpretar(page: Page, texto: string) {
  await page.getByLabel(TEXTS.redactor.etiquetaTextarea).fill(texto);
  await page.getByRole('button', { name: TEXTS.redactor.interpretar, exact: true }).click();
}

/** Posición en coordenadas del documento: inmune al desplazamiento. */
async function posicionEnDocumento(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY };
    });
}

const botonExcluir = (page: Page) =>
  page
    .locator('[data-seccion="plan_comparison"]')
    .getByRole('button', { name: new RegExp(TEXTS.planes.excluirPrefijo, 'i') });

test('la semana inicial se declara cubierta y el cascarón orienta al usuario', async ({ page }) => {
  await page.goto('/');

  // Accesibilidad básica.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Marea Estudio', level: 1 })).toBeVisible();

  // Línea de estado del motor: siempre presente, nunca la compone el modelo.
  await expect(page.getByText(TEXTS.estado.cubiertoTitulo)).toBeVisible();

  // Primer uso: hay una entrada evidente.
  await expect(page.getByText(TEXTS.shell.bienvenidaTitulo)).toBeVisible();
  await expect(
    page.getByRole('button', { name: TEXTS.redactor.interpretar, exact: true }),
  ).toBeVisible();

  // Sin credenciales, la interfaz declara que la vista no la organizó Gemini.
  await expect(page.getByText(TEXTS.shell.composicionFuente.fallback).first()).toBeVisible();

  const secciones = await seccionesVisibles(page);
  expect(secciones.length).toBeGreaterThan(0);
  // Una semana cubierta no muestra comparador de planes vacío.
  expect(secciones).not.toContain('plan_comparison');
});

test('la página cabe en un alto razonable y abre un solo detalle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  // El motivo del rediseño: antes eran ~5000 px de alto.
  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(alto, `la página mide ${alto}px`).toBeLessThan(2600);

  // Regla de apertura: exactamente un detalle abierto al cargar.
  const abiertas = await page.locator('[data-seccion][data-abierta="si"]').count();
  const total = await page.locator('[data-seccion]').count();
  expect(total).toBeGreaterThan(1);
  expect(abiertas).toBe(1);

  // La entrada del producto se ve sin desplazarse.
  const boton = page.getByRole('button', { name: TEXTS.redactor.interpretar, exact: true });
  const caja = await boton.boundingBox();
  expect(caja).not.toBeNull();
  expect(caja!.y + caja!.height).toBeLessThan(900);
});

test('la gramática de composición respeta orden y ancho', async ({ page }) => {
  await page.goto('/');

  const disposicion = await page.locator('[data-seccion]').evaluateAll((nodes) =>
    nodes.map((n) => ({
      tipo: n.getAttribute('data-seccion') ?? '',
      enfasis: n.getAttribute('data-enfasis') ?? '',
      ancho: Math.round(n.getBoundingClientRect().width),
    })),
  );

  // Comparador, calendario e historial llevan tabla o comparación en columnas:
  // siempre a ancho completo, sea cual sea el énfasis que pida el modelo.
  const anchoMaximo = Math.max(...disposicion.map((d) => d.ancho));
  for (const bloque of disposicion) {
    if (['plan_comparison', 'cash_calendar', 'history'].includes(bloque.tipo)) {
      expect(bloque.ancho, `${bloque.tipo} debe ocupar el ancho completo`).toBeGreaterThan(
        anchoMaximo * 0.9,
      );
    }
    // Un bloque destacado nunca se queda a media anchura.
    if (bloque.enfasis === 'high') {
      expect(bloque.ancho).toBeGreaterThan(anchoMaximo * 0.9);
    }
  }
});

test('riesgo, cobros y sin solución producen composiciones distintas', async ({ page }) => {
  await page.goto('/');
  const inicial = await seccionesVisibles(page);

  // --- 1. Aviso ambiguo: pide aclaración y no cambia nada -------------------
  await interpretar(page, MENSAJE_AMBIGUO);
  await expect(page.getByText(TEXTS.redactor.aclaracionTitulo)).toBeVisible();
  await expect(page.getByText(TEXTS.redactor.aclaracionCuerpo)).toBeVisible();
  expect(await seccionesVisibles(page)).toEqual(inicial);
  // El estado financiero sigue diciendo que la semana está cubierta.
  await expect(page.getByText(TEXTS.estado.cubiertoTitulo)).toBeVisible();

  // --- 2. Aviso concreto: propuesta con diff y cita literal -----------------
  await interpretar(page, MENSAJE_DEMO);
  await expect(page.getByText(TEXTS.propuesta.titulo)).toBeVisible();
  await expect(page.getByText(TEXTS.propuesta.evidenciaEtiqueta)).toBeVisible();
  await page.getByRole('button', { name: TEXTS.propuesta.confirmar, exact: true }).click();

  // --- 3. Nómina en riesgo --------------------------------------------------
  await expect(page.locator('[data-seccion="risk_summary"]')).toBeVisible();
  await expect(page.getByText(TEXTS.estado.riesgoTitulo)).toBeVisible();
  const nomina = await seccionesVisibles(page);
  expect(nomina).toContain('risk_summary');
  expect(nomina).toContain('plan_comparison');
  await expect(page.locator('[data-plan]')).toHaveCount(2);
  // Un plan condicionado nunca se presenta como dinero disponible.
  await expect(page.getByText(TEXTS.planes.condicionalAviso).first()).toBeVisible();

  const posicionRiesgo = await posicionEnDocumento(page, BARRA);

  // El cambio confirmado se registró una sola vez.
  const historial = await page.request.get('/api/history');
  const datos = (await historial.json()) as { entries: { eventType: string }[] };
  expect(datos.entries.filter((e) => e.eventType === 'receivable_rescheduled')).toHaveLength(1);

  // --- 4. "Enfócate en los cobros": otra composición del mismo resultado ----
  await page.locator('[data-foco="receivables"]').click();
  await expect(page.locator('[data-seccion="receivables"]')).toBeVisible();
  const cobros = await seccionesVisibles(page);
  expect(cobros).not.toEqual(nomina);
  expect(cobros[0]).toBe('receivables');

  // Invariante: recomponer la zona central no mueve los controles críticos.
  const posicionCobros = await posicionEnDocumento(page, BARRA);
  expect(Math.abs(posicionRiesgo.y - posicionCobros.y)).toBeLessThan(4);
  expect(Math.abs(posicionRiesgo.x - posicionCobros.x)).toBeLessThan(4);

  // --- 5. Excluir el aplazamiento del proveedor ----------------------------
  await botonExcluir(page).first().click();
  await expect(page.locator('[data-plan]')).toHaveCount(1);
  // El sistema dice QUÉ cambió, no solo que algo cambió.
  await expect(page.getByText(/falt|plan/i).first()).toBeVisible();

  // --- 6. Excluir también el adelanto: sin solución -------------------------
  await botonExcluir(page).first().click();
  await expect(page.locator('[data-seccion="constraints"]')).toBeVisible();
  await expect(page.locator('[data-plan]')).toHaveCount(0);
  await expect(page.getByText(TEXTS.estado.bloqueadoTitulo).first()).toBeVisible();

  const sinSolucion = await seccionesVisibles(page);
  expect(sinSolucion).not.toContain('plan_comparison');
  expect(sinSolucion).toContain('constraints');

  // La vista no puede ocultar el alcance real de «sin solución».
  await expect(
    page.getByText(/no es una conclusión sobre todas las opciones/i).first(),
  ).toBeVisible();

  // Las tres composiciones son efectivamente distintas entre sí.
  expect(new Set([nomina.join(), cobros.join(), sinSolucion.join()]).size).toBe(3);

  // --- 7. Deshacer ----------------------------------------------------------
  await page.getByRole('button', { name: new RegExp(TEXTS.shell.volverBoton, 'i') }).click();
  await expect(page.locator('[data-plan]')).toHaveCount(1);
});
