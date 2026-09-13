# Capital One Flex: guía rápida de la demo

La app responde: **si cambia un cobro, ¿cómo cubro mis pagos esta semana?** Trabaja con Marea Estudio, un negocio ficticio, y fechas de septiembre de 2026. No envía pagos ni contacta clientes.

## 1. Abre la app

Con el servidor encendido, entra a http://localhost:3210. Para encenderlo:

```bash
cd /Users/sebaschairez/Downloads/Prototipo
npm exec --yes --package=node@24 -- npm run dev
```

Arriba verás si la semana queda cubierta o cuánto dinero falta. Si ya hiciste pruebas, puede aparecer el último estado guardado: recargar la página no reinicia la demo.

### Empezar otra vez

Pulsa **Reiniciar ejemplo**, arriba a la derecha. Vuelves a los datos originales: fechas iniciales, reserva de $3,000 y ninguna opción descartada. Se limpian el mensaje, los pasos de deshacer y el historial visible del recorrido; los registros anteriores se conservan en el almacenamiento.

Para volver a ver las alternativas, usa **Probar con un ejemplo → Retraso de factura**, pulsa **Ver qué cambia** y **Aplicar el cambio**. Podrás decidir de nuevo qué opciones descartar. Puedes reiniciar cuantas veces quieras.

## 2. Prueba el recorrido principal

1. Abre **Cuéntanos qué pasó** o **Contar otro cambio**.
2. Selecciona **Pegar mensaje** y, en **¿Qué cambió?**, pega: «Hola, el pago de la factura F-1042 se programó para el 20 de septiembre de 2026». También puedes abrir **Probar con un ejemplo** → **Retraso de factura**.
3. Pulsa **Ver qué cambia**. Se abrirá un modal con tarjetas **Antes** y **Después**. Todavía no cambió el escenario. Escape y el clic fuera no lo cierran: debes elegir **Aplicar el cambio** o **No aplicar**. Si falta una fecha o factura, se abre un modal de aclaración. Pulsa **Aceptar** para regresar al mensaje y completarlo; si eliges una sugerencia, se añadirá al texto.
4. Revisa la factura y la fecha. Pulsa **Aplicar el cambio**, o **No aplicar** para descartarlo.
5. Si hay faltante, se abre un segundo modal con el dinero que necesitas y las alternativas. Puedes pulsar **Quiero intentar esta opción** para marcarla como pendiente de negociación, o **Cerrar y decidir después**. Las tarjetas siguen disponibles en la página. Desde el escenario inicial, ese retraso produce un faltante de **$10,000 MXN**, considerando la reserva. Si ya modificaste otros datos, el resultado puede ser diferente.
6. La app abre automáticamente la comparación para cubrir el faltante. Si estás explorando otra vista, pulsa **Comparar cómo cubrir el faltante**. Los títulos del contenido pueden variar cuando Gemini organiza la vista.
7. Compara **Costo**, **Saldo más bajo** y **Depende de que acepten**. Cada tarjeta muestra con quién hablar y qué cambio proponer. Abre **Ver fechas y costos** para consultar el desglose adicional.
8. Si una alternativa no es negociable, pulsa **No puedo hacer esto con…**. Se descarta esa acción y se buscan alternativas; no se cancela el pago real.
9. Pulsa **Deshacer último cambio**: debajo del botón aparece qué vas a deshacer. Se restaura el escenario anterior y **Qué cambió** muestra el faltante y las alternativas antes y después. Luego pulsa **Revisar mis cambios** para consultar el historial. **Ver todos los registros** abre los detalles técnicos.

Las opciones son simulaciones. Puedes marcar una opción para negociar durante esta sesión; eso no modifica los saldos ni registra un acuerdo. La marca se descarta cuando cambia el resultado o recargas la página. La app todavía no registra la aceptación de la contraparte ni ejecuta pagos.

### Registrar el cambio sin escribir un mensaje

1. Abre **Cuéntanos qué pasó** o **Contar otro cambio** y pulsa **Elegir factura**.
2. En **Factura pendiente de cobro**, elige el folio. La lista incluye cliente e importe; debajo aparece la fecha actual.
3. En **¿Qué pasará con el cobro?**, elige **Se retrasará**, **Se espera antes** o **Corregir la fecha esperada**.
4. Elige la **Nueva fecha esperada** y pulsa **Ver qué cambia**.
5. Revisa **Antes / Después** y pulsa **Aplicar el cambio**. Si existe faltante, aparecerá el modal de alternativas.

La captura guiada usa los datos elegidos directamente, sin interpretación de IA. Cambia la fecha esperada: no registra un cobro recibido ni un adelanto con descuento. Para el caso principal elige **Factura F-1042**, **Se retrasará** y **20 de septiembre de 2026**.

## 3. La pantalla se adapta al problema

- **Semana cubierta:** un calendario muestra cuánto cobras, pagas y conservas cada día.
- **Retraso confirmado:** se abre la comparación de alternativas con acciones, costos y condiciones.
- **Rechazo:** se recalculan las alternativas. Si solo queda una, pasa a ser la protagonista.
- **Sin alternativas suficientes:** aparecen las condiciones que tendrían que cambiar; no se inventa una solución.

En **¿Qué quieres entender?** hay botones con una explicación debajo:

| Botón | Para qué sirve |
|---|---|
| Ver mis próximos pagos | Consultar el calendario, incluso cuando hay un faltante. |
| Comparar cómo cubrir el faltante | Revisar las alternativas viables. Aparece cuando hay faltante y opciones. |
| Ver quién me debe | Consultar facturas, fechas y adelantos posibles. |
| Ver qué impide cubrir los pagos | Revisar las condiciones cuando no quedan alternativas suficientes. |
| Revisar mis cambios | Consultar el historial y comparar el dinero que falta. |

Al cambiar de vista, la página te lleva al panel principal. Estos botones no modifican los datos ni agregan pasos a **Deshacer**. Pueden solicitar una composición a Gemini si no existe una guardada para ese resultado y enfoque.

**Deshacer último cambio**, en la parte superior, usa los pasos de esta sesión de la página; recargar no conserva esa pila.

### Deshacer una acción desde el historial

1. Pulsa **Revisar mis cambios**.
2. Busca la decisión y pulsa **Deshacer esta acción**.
3. La app restaura el valor anterior de ese dato y recalcula el faltante, los saldos y las alternativas. Los cambios independientes posteriores se conservan.
4. Arriba verás el resultado en **Qué cambió**. La tarjeta queda marcada como **Acción deshecha**.

Si modificaste ese mismo dato después, primero debes deshacer el cambio más reciente. El botón explica por qué no está disponible si la acción ya fue deshecha, pertenece a otro escenario o no tiene un valor anterior verificable. Los cálculos automáticos no son decisiones y no tienen botón.

Esta reversión no borra el historial: queda registrada como otro cambio. Funciona después de recargar mientras el almacenamiento conserve los datos; Tiger Data los guarda de forma persistente y la memoria local solo durante la vida del servidor.

## 4. Más pruebas, sin tocar código

Hazlas de una en una. Usa **Deshacer último cambio** cuando quieras deshacer un cambio disponible.

| Prueba | Qué hacer | Qué esperar |
|---|---|---|
| Aviso incompleto | Pega «La factura de Arcadia se va a atrasar un poco». Pulsa **Ver qué cambia**. | Debe pedir una fecha concreta, sin modificar datos. |
| El cliente vuelve a pagar a tiempo | Después del retraso, pega «La factura F-1042 se pagará el 14 de septiembre de 2026». Revisa y aplica. | Se recalcula la semana. Sin otros cambios, desaparece el faltante del retraso. |
| Cambiar de opinión | Envía un cambio válido y pulsa **No aplicar**. | Se conserva el escenario anterior. |
| Sin alternativas aceptables | Tras el retraso, descarta sucesivamente las acciones ofrecidas. | Se agotan las opciones y la app muestra cuánto seguiría faltando. No debe inventar una solución. |
| Otra prioridad | Pulsa **Ver quién me debe** y después **Revisar mis cambios**. | El panel principal pasa de facturas a historial; los datos económicos se conservan. |
| Reservar más dinero — requiere interpretación de Gemini | Pega «Quiero mantener una reserva mínima de 5000 pesos». Revisa que proponga exactamente esa reserva antes de aplicar. | Recalcula qué alternativas conservan esa cantidad. El lector local sin Gemini no admite esta instrucción. |

No está limitada a dos mensajes, pero sí a los datos y operaciones implementados: reprogramar cobros existentes, ajustar la reserva y excluir acciones. Todavía no puedes cargar otro negocio o crear facturas desde la interfaz. Repetir una fecha que ya está registrada tampoco produce un cambio nuevo.

## 5. Qué hacen Gemini y Tiger Data

**Gemini** interpreta los mensajes y propone cómo organizar una vista usando seis módulos existentes: riesgo, calendario, cobros, planes, restricciones e historial. Puede elegir módulos, orden, énfasis y textos dentro del contrato permitido. El servidor valida la propuesta; el motor de cálculo determina los números. El módulo de mayor énfasis se convierte en protagonista, con presentación propia: calendario por días, comparación de planes, lista de facturas o condiciones. Los módulos secundarios conservan su orden y se consultan al abrirlos. Los títulos y explicaciones breves validados también pueden venir de Gemini. Los componentes están programados: no se genera código de interfaz desde cero.

Las composiciones se reutilizan por resultado, enfoque y versión del contrato. Por eso volver al mismo enfoque puede mostrar exactamente la misma vista sin otra llamada de composición.

**Tiger Data** guarda escenarios y revisiones, resultados, propuestas pendientes, vistas reutilizables y eventos. El historial consulta realmente la tabla temporal `financial_events` cuando se usa ese almacenamiento. También conserva el escenario activo y las claves para evitar aplicar dos veces una misma operación. No interpreta mensajes ni calcula los planes.

Abre **Datos del ejemplo y conexiones**, al final, para revisar el almacenamiento y los estados de las integraciones. **Configurado** no equivale a **Verificado**. Si aparece **Vista básica**, esa composición no procede de Gemini. Si los datos están en memoria local, no estás usando Tiger Data para conservar esa sesión.

Esta guía se contrastó con el código; no incluye una nueva comprobación en vivo de las credenciales o servicios.

## 6. Cómo leer la interfaz simplificada

- **Cada opción:** identifica a la contraparte, explica el cambio concreto y compara costo y saldo más bajo. Una opción viable cubre los pagos y la reserva solo si se cumplen sus condiciones.
- **Antes de guardar:** revisa el cambio. La propuesta muestra el antes y el después sin detalles técnicos de la interpretación.
- **Historial:** prioriza la última decisión sobre los registros automáticos del motor. Los detalles completos siguen disponibles en **Ver todos los registros**.
- **Conexiones:** consulta aquí los proveedores y datos del ejemplo. El aviso de vista básica sigue visible cuando Gemini no compuso la pantalla.

La adaptación sigue siendo una composición de módulos: no genera código de interfaz ni nuevos tipos de pantalla. Los acuerdos y pagos reales siguen fuera de esta demo.
