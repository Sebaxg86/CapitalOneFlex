# Compromisos bajo presión — demo local

Prototipo ejecutable de la especificación aprobada en `PROYECTO.md` y `ARQUITECTURA.md`.
Un espacio de decisiones financieras para una pyme sintética: interpreta una novedad,
recalcula alternativas con un motor determinista y **compone la pantalla** eligiendo
qué componentes mostrar, en qué orden y con qué protagonismo.

> Esto es una demo local con datos ficticios. **No es un producto listo para producción**
> y no se ha validado con usuarios reales, impacto comercial ni ahorro.

---

## Estado de las integraciones obligatorias

Ejecute `npm run check:providers` para el estado actual. Última verificación
realizada durante el desarrollo (12 de septiembre de 2026):

| Integración | Estado | Qué se comprobó |
|---|---|---|
| **Tiger Data** | **verificado** | PostgreSQL 18.6 + `timescaledb` 2.30.0, TLS con `sslmode=verify-full`, migraciones en el schema `compromisos`, `financial_events` confirmada como hypertable, escritura/lectura real, consulta por intervalo temporal, reconstrucción antes/después y persistencia tras reiniciar el servidor |
| **Gemini API** | **verificado** | Modelo `gemini-3.5-flash-lite`, salida estructurada real, interpretación del aviso (con cita literal del mensaje) y del aviso ambiguo (pide aclaración), y composición validada en las tres situaciones |

### Sobre el modelo de Gemini

Los identificadores caducan: en esta cuenta `gemini-2.5-flash` y `gemini-2.5-pro`
responden **404 «no longer available to new users»**, `gemini-pro-latest` y los
`*-pro-preview` dan cuota agotada, y `gemini-3.8-flash`/`gemini-3.7-flash`
devolvieron 503 por saturación. `gemini-3.5-flash-lite` respondió las cuatro
tareas reales en 1–3,5 s y es el que quedó fijado en `GEMINI_MODEL`.

Si ese identificador deja de servir, borre `GEMINI_MODEL` y ejecute
`npm run check:providers`: la detección prueba primero una lista de preferencia
y, si ninguno sirve, recorre los modelos que la propia cuenta declara.

Sin esas credenciales la aplicación **sigue funcionando**, pero en modo explícito:

- Sin `GEMINI_API_KEY`: la composición la calcula el servidor (vista básica
  determinista) y la lectura del mensaje la hace un adaptador local de reglas.
  La interfaz lo rotula y **nunca** lo atribuye a Gemini.
- Sin `DATABASE_URL`: el escenario vive en la memoria del proceso y se pierde al
  reiniciar el servidor.

**La entrega no está completa mientras alguna integración obligatoria solo funcione
con fixtures.** `npm run check:providers` sale con código 1 en ese caso.

---

## Requisitos

- Node.js **20.9+** (verificado con **24.19.0**) y npm (verificado con **11.17.0**).
- Para la modalidad real: una clave de Gemini API y un servicio Tiger Data con Timescale.

## Instalación

```bash
npm install
```

Versiones fijadas en `package-lock.json`. Las principales: Next.js 16.3.5, React 19.3.0,
TypeScript 5.9.3, Zod 4.6.2, `pg` 8.23.0, `@google/genai` 2.22.0, Vitest 5.0.0,
Playwright 1.63.0, Tailwind CSS 4.3.3.

## Variables de entorno

Copie `.env.example` a `.env.local` y rellénelo. **`.env.local` no se versiona**
(`.gitignore` excluye `.env*` salvo `.env.example`).

| Variable | Obligatoria | Para qué sirve |
|---|---|---|
| `GEMINI_API_KEY` | sí (modalidad real) | Clave de Google AI Studio. Solo servidor. |
| `GEMINI_MODEL` | recomendada | Identificador exacto del modelo. Si falta, el servidor busca uno accesible y `check:providers` sugiere cuál fijar. |
| `DATABASE_URL` | sí (modalidad real) | URI PostgreSQL del servicio Tiger Data dedicado a este prototipo. |
| `DEMO_TODAY` | no | Fecha económica D0 del dataset. Por defecto `2026-09-12`. |

Los pasos para obtener cada credencial están en `CONFIGURACION.md`. Nunca pegue una
clave en el chat, en un documento ni en Git; los mensajes de error se sanean antes
de mostrarse y el código no vuelca `process.env`.

## Base de datos (Tiger Data)

```bash
npm run db:migrate   # crea el schema "compromisos" y la hypertable; no borra nada
npm run db:seed      # siembra el negocio de la demo; idempotente
```

- Las migraciones son aditivas: **no hay `DROP TABLE`, `DROP DATABASE` ni `TRUNCATE`**.
- Todo vive en el schema dedicado `compromisos`, nunca en `public`.
- Si Timescale no está disponible, la migración **falla con un mensaje claro** en vez
  de dejar una tabla normal disfrazada de hypertable.
- Sin `DATABASE_URL`, ambos scripts avisan y salen con código 0 sin hacer nada.

### Reinicio exclusivo de los datos de la demo

```bash
npm run db:seed -- --reset-demo
```

Borra **solo** las filas cuyo `business_id` es `biz:marea` y vuelve a sembrarlas.
Sin esa bandera, el seed nunca borra nada.

## Ejecutar la demo

```bash
npm run dev
```

Abra **http://localhost:3210**. El puerto está fijado en los scripts `dev` y `start`.

Para el modo compilado:

```bash
npm run build
npm run start      # también en http://localhost:3210
```

## Pruebas

```bash
npm test              # 137 pruebas de dominio, contratos y recorrido (Vitest)
npm run test:e2e      # recorrido de interfaz con Playwright (build propio en :3211)
npm run typecheck     # tsc --noEmit
```

La primera vez, Playwright necesita su navegador: `npx playwright install chromium`.

`npm test` y `npm run test:e2e` **no llaman a ningún proveedor**: el recorrido de
interfaz compila en `.next-e2e` y corre con la composición determinista del
servidor y el escenario en memoria, para que sea reproducible y pueda ejecutarse
sin cerrar la demo abierta. La verificación contra Gemini y Tiger Data reales es
`npm run check:providers` y `npm run demo:walkthrough`, y se reporta por separado.

Scripts de evidencia adicionales:

```bash
npm run check:providers     # verifica Gemini y Tiger Data REALES; sale con 1 si falta alguno
npm run demo:walkthrough    # recorre las tres situaciones por la API contra el servidor local
```

`demo:walkthrough` requiere un servidor recién arrancado (parte de la semana inicial).

---

## Recorrido de la demo

1. **Semana viable.** Marea Estudio, 7 días, saldo inicial $20,000, caja mínima $3,000.
2. **Aviso ambiguo.** Pegue el mensaje sintético ambiguo: la herramienta pide una
   aclaración y **no cambia ningún dato**.
3. **Aviso concreto.** Pegue el mensaje de retraso de la factura F-1042: aparece una
   propuesta con el diff humano y el fragmento literal que lo respalda.
4. **Confirmación humana.** Al confirmar, el saldo del día 3 cae a −$7,000 y aparece un
   faltante de $10,000 frente a la caja mínima, con dos alternativas condicionadas.
5. **«Enfócate en los cobros».** Cambie el enfoque: el mismo resultado del motor produce
   otra composición, con las facturas en primer plano.
6. **«No puedo retrasar a ese proveedor».** Descarte la acción: se crea un escenario
   separado y queda una sola alternativa.
7. **Sin solución.** Descarte también el adelanto de cobro: desaparece el comparador,
   aparecen los bloqueos y el faltante mínimo residual de $10,000, con el alcance real
   de esa conclusión.
8. **Historial.** Los eventos distinguen expectativa actualizada, restricción de
   escenario y resultado calculado. Una novedad confirmada **no** es un cobro recibido;
   un plan aceptado **no** es un pago ejecutado.

## Qué garantiza el sistema

- **Todas las cifras vienen del motor.** Los textos del modelo no pueden contener dígitos:
  para citar una cantidad usan un token `{{fact:...}}` que resuelve el servidor.
- **Catálogo cerrado de seis componentes**: resumen de riesgo, calendario de caja,
  facturas relevantes, comparador de planes, restricciones/bloqueos e historial.
  Máximo seis secciones, sin duplicados, sin HTML, sin código, sin SQL.
- **Referencias verificadas.** Cada referencia de una composición debe pertenecer al
  resultado vigente; una composición de un resultado anterior se descarta.
- **Reglas que el servidor impone** aunque el modelo las omita: si hay riesgo, resumen de
  riesgo; si hay planes, comparación con sus condiciones; si no hay planes, bloqueos y
  ningún comparador vacío. La interfaz lista los ajustes aplicados.
- **Dinero en centavos enteros.** Redondeo half-up documentado, puntos base enteros.
- **Idempotencia y concurrencia.** Clave de operación global; confirmar dos veces no
  duplica el evento. Una propuesta sobre una revisión vieja devuelve 409.
- **Un plan condicionado nunca se presenta como liquidez garantizada.**

## Estructura

```
src/app/                    páginas y rutas de API
src/domain/                 dinero, fechas, tipos y motor determinista (puro)
src/server/ai/              adaptador Gemini, prompts, contratos y validación
src/server/db/              pool, migraciones, repositorios y consultas temporales
src/server/store/           almacén: Tiger Data o memoria del proceso
src/components/workspace/   cascarón estable y renderer
src/components/blocks/      los seis componentes
src/lib/texts.ts            todos los textos visibles, centralizados
fixtures/                   negocio sintético y oráculo numérico
scripts/                    migración, seed, verificación y recorrido
tests/                      pruebas de dominio y contratos (Vitest)
e2e/                        recorrido de interfaz (Playwright)
```

## Alcance cerrado

Un negocio, MXN, siete días, diez obligaciones. Acciones discretas: aplazar un pago,
dividir un pago o adelantar un cobro con descuento, solo si sus condiciones están
registradas.

**No incluye** (y no debe añadirse): banca o Nessie, crédito nuevo, pagos reales,
negociación automática, WhatsApp, voz, múltiples negocios, modelos predictivos,
probabilidades de cobro inventadas, pantallas con código arbitrario ni una red de agentes.
