import { expect, test } from '@playwright/test';
import { TEXTS } from '../src/lib/texts';

// Un recorrido serial con datos locales: no toca Tiger Data ni consume Gemini.
test('móvil: interpretar, decidir, volver, sin solución e historial', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Marea Estudio'})).toBeVisible();
  await expect(page.getByText(TEXTS.estado.cubiertoTitulo)).toBeVisible();
  const noOverflow = async () => expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await noOverflow();
  await page.screenshot({path:'test-results/mobile-start.png',fullPage:true});
  await expect(page.locator('[data-abierta="si"]')).toHaveCount(1);
  await page.getByLabel('¿Qué cambió?').fill('Oigan, la factura de Arcadia se va a atrasar un poco, les aviso luego con calma.');
  await page.getByRole('button',{name:'Ver qué cambia',exact:true}).click();
  await expect(page.getByText(TEXTS.estado.cubiertoTitulo)).toBeVisible();
  await expect(page.getByRole('button',{name:TEXTS.propuesta.confirmar,exact:true})).toHaveCount(0);
  await page.getByLabel('¿Qué cambió?').fill('Hola, el pago de la factura F-1042 se programó para el 20 de septiembre.');
  await page.getByRole('button',{name:'Ver qué cambia',exact:true}).click();
  await page.getByRole('button',{name:TEXTS.propuesta.confirmar,exact:true}).click();
  await expect(page.getByRole('heading',{name:'Necesitas cubrir'})).toBeVisible();
  const compare=page.locator('[data-seccion="plan_comparison"]');
  async function openPlans() {
    if (await compare.getAttribute('data-abierta') !== 'si') await compare.getByRole('button').first().click();
  }
  await openPlans();
  await expect(compare.getByText(TEXTS.planes.condicionalAviso).first()).toBeVisible();
  await noOverflow();
  const reject = () => compare.getByRole('button',{name:new RegExp(TEXTS.planes.excluirPrefijo)}).first();
  await page.screenshot({path:'test-results/mobile-plans.png',fullPage:true});
  const before = await page.request.get('/api/scenario').then(r=>r.json());
  await reject().click();
  await expect.poll(async()=> (await page.request.get('/api/scenario').then(r=>r.json())).scenario.id).not.toBe(before.scenario.id);
  await page.getByRole('button',{name:'← Volver',exact:true}).click();
  await expect.poll(async()=> (await page.request.get('/api/scenario').then(r=>r.json())).scenario.id).toBe(before.scenario.id);
  // La UI restaurada puede seguir operando sobre el servidor, sin conflicto.
  for (let i=0;i<5;i++) {
    if (await page.getByRole('heading',{name:'Con estas opciones no alcanza'}).count()) break;
    await openPlans();
    await reject().click();
    await expect(page.getByText('Revisando tus opciones…')).toHaveCount(0);
  }
  await expect(page.getByRole('heading',{name:'Con estas opciones no alcanza'})).toBeVisible();
  await expect(page.locator('[data-seccion="plan_comparison"]')).toHaveCount(0);
  await noOverflow();
  await page.getByLabel('Quiero revisar').selectOption('history');
  const history=page.locator('[data-seccion="history"]');
  await expect(history).toHaveAttribute('data-abierta','si');
  await expect(history.getByText('Antes faltaban')).toBeVisible();
  await expect(history.getByText('Después faltan')).toBeVisible();
  await noOverflow();
  await page.screenshot({path:'test-results/mobile-final.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await noOverflow();
  await page.screenshot({path:'test-results/desktop-final.png',fullPage:true});
});
