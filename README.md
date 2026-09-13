# Capital One Flex — HackMTY

Prototipo ejecutable de la especificación aprobada en `PROYECTO.md` y `ARQUITECTURA.md`.
Un espacio de decisiones financieras para una pyme sintética: interpreta una novedad,
recalcula alternativas con un motor determinista y **compone la pantalla** eligiendo
qué componentes mostrar, en qué orden y con qué protagonismo.

> Esto es una demo local con datos ficticios. **No es un producto listo para producción**
> y no se ha validado con usuarios reales, impacto comercial ni ahorro.

---

## Empezar en cinco minutos

Requiere **Node.js 24** y npm. El repositorio incluye `.nvmrc`.

```bash
git clone https://github.com/Sebaxg86/CapitalOneFlex.git
cd CapitalOneFlex
npm ci
npm run dev
```

Abre **http://localhost:3210**. Sin credenciales puedes probar el motor, la captura guiada y las vistas de respaldo con datos ficticios. Los datos se conservan solo mientras el servidor siga activo.

Si tu Node es anterior, puedes ejecutar los comandos con Node 24 sin cambiar la instalación global:

```bash
npm exec --yes --package=node@24 -- npm ci
npm exec --yes --package=node@24 -- npm run dev
```

## Documentación

- [Manual de usuario](MANUAL_USUARIO.md): botones, ejemplos, modales, deshacer y reiniciar.
- [Configuración](CONFIGURACION.md): credenciales de Gemini y Tiger Data, variables y comprobaciones.
- [Arquitectura aprobada](ARQUITECTURA.md) y [proyecto](PROYECTO.md): diseño base y alcance; se conservan como especificación original. Las funciones incorporadas después se resumen aquí.
- [Instrucciones de desarrollo](AGENTS.md) y [Claude](CLAUDE.md).
- [Referencia visual](design/CAPITAL_ONE.md): procedencia de logo, colores y tipografía.

## Qué puedes hacer hoy

- Seleccionar factura por folio, cliente e importe; registrar retraso, adelanto de fecha o corrección. También puedes pegar un mensaje para interpretarlo.
- Revisar **Antes / Después** antes de aplicar cualquier novedad.
- Comparar alternativas en un modal y cerrar para decidir después. Elegir una opción solo la marca para negociar: no confirma acuerdos ni ejecuta pagos.
- Explorar pantallas centradas en calendario, cobros, alternativas, bloqueos e historial. Gemini propone composición, énfasis y textos validados; el motor determina las cifras.
- Descartar acciones, deshacer decisiones del historial conservando cambios independientes y recalcular la situación financiera.
- **Reiniciar ejemplo** para volver a fechas, reserva y opciones originales. El historial anterior se conserva en almacenamiento, fuera del nuevo recorrido visible.

Las decisiones se guardan como escenarios separados. Estado, resultado, eventos e idempotencia se persisten juntos; las reversiones comprueban la revisión y los cambios posteriores del mismo dato.

## Integraciones

**Gemini:** interpretación de mensajes y composición declarativa. La captura guiada no necesita interpretación de IA. Sin clave se usa un lector local limitado y una vista básica identificada como tal.

**Tiger Data:** PostgreSQL y Timescale para escenarios, resultados, propuestas, caché de vistas e historial temporal. Sin conexión disponible se usa memoria local y se muestra el aviso correspondiente.

Consulta el estado actual en **Datos del ejemplo y conexiones** o ejecuta `npm run check:providers`. Este último usa servicios reales y puede consumir cuota. Las comprobaciones locales de interfaz y motor no acreditan el estado actual de los proveedores; los registros anteriores de desarrollo tampoco garantizan acceso para otra cuenta.

El nombre del modelo depende del acceso de la cuenta. Configura `GEMINI_MODEL` según `CONFIGURACION.md` o usa la detección implementada. Las claves nunca se incluyen en el cliente ni en Git.

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

### Reiniciar el recorrido

Para repetir la demostración, usa **Reiniciar ejemplo** en la cabecera. No necesitas borrar la base de datos.

### Limpieza de datos para desarrollo

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
npm test              # pruebas de dominio, contratos y recorrido (Vitest)
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

`demo:walkthrough` modifica el ejemplo. Usa primero **Reiniciar ejemplo** para partir de la semana inicial.

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
  ningún comparador vacío. Los ajustes se conservan en la respuesta validada. El estado financiero se muestra fuera de la composición.
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
src/lib/texts.ts            textos compartidos de la interfaz
fixtures/                   negocio sintético y oráculo numérico
scripts/                    migración, seed, verificación y recorrido
tests/                      pruebas de dominio y contratos (Vitest)
e2e/                        recorrido de interfaz (Playwright)
```

## Alcance cerrado

Un negocio, MXN, siete días, diez obligaciones. Acciones discretas: aplazar un pago,
dividir un pago o adelantar un cobro con descuento, solo si sus condiciones están
registradas.

**No implementado:** banca o Nessie, crédito nuevo, pagos reales,
negociación automática, WhatsApp, voz, múltiples negocios, modelos predictivos,
probabilidades de cobro inventadas, pantallas con código arbitrario ni una red de agentes.

### Verificación del rediseño

Verificación local del 13/09/2026: TypeScript y 167 pruebas correctas. Build y recorrido Playwright correctos en móvil 390×844 y revisión de desbordamiento a 1440 px: ambigüedad sin mutación, confirmación, condiciones, rechazo, deshacer selectivo, reinicio, captura guiada, modal de alternativas, sin solución e historial antes/después. Capturas revisadas visualmente. Esta ronda no ejecutó llamadas reales de Gemini ni modificó Tiger Data; las pruebas usan memoria y composición local explícitas.
