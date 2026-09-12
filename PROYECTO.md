# Compromisos bajo presión

Especificación aprobada para la demo de HackMTY · 12 septiembre 2026.
Este documento y ARQUITECTURA.md definen el alcance actual. No acreditan implementación. Sustituyen, para este prototipo, el plan anterior de HackOS que todavía no incluía composición dinámica de pantallas.

## La promesa

Un espacio de decisiones financieras que se adapta al problema del negocio. Ante un cobro retrasado, entiende el cambio, calcula alternativas permitidas y compone una vista que explica qué está en riesgo, qué opciones existen y qué cambia al decidir.

El momento wow: «No puedo retrasar a ese proveedor» → se recalculan las alternativas → la pantalla reorganiza la comparación y destaca la restricción. Si no existe solución, cambia a una explicación del faltante, sin inventar un plan.

## Para quién

Una sola pyme ficticia para la demo: agencia B2B de servicios que cobra mediante facturas y debe cubrir nómina y proveedores. Esta persona es una hipótesis de diseño, no validación comercial. El producto se adapta a sus situaciones; no intenta resolver todas las industrias.

## Lo que realmente funciona

- Motor determinista de saldos diarios y combinaciones de acciones permitidas.
- Interpretación de novedades y prioridades con Gemini API, seguida de validación y confirmación humana.
- Pantallas compuestas por Gemini con componentes disponibles: decide selección, orden y protagonismo, no solamente textos.
- Persistencia e historial temporal en Tiger Data: reconstrucción del antes y después de un cambio confirmado.
- Rechazo de alternativas, recálculo y reconocimiento de casos sin solución.

Los datos son ficticios; cálculos, consultas e integraciones de la modalidad real deben ser reales. Nunca presentar una respuesta simulada como llamada al proveedor.

## Roles de la tecnología

**Gemini:** un agente lógico con dos tareas delimitadas. Primero interpreta mensajes en cambios estructurados. Después recibe resultados calculados y compone la presentación, incluyendo explicaciones referenciadas. No ejecuta código, pagos ni SQL; tampoco determina importes, probabilidades o factibilidad por sí solo.

**Motor:** comprueba restricciones, calcula saldos y costos, enumera combinaciones pequeñas y ordena resultados. Toda cifra visible procede del motor o de datos confirmados.

**Tiger Data:** guarda obligaciones, condiciones y escenarios en PostgreSQL y eventos con fecha en Timescale. Permite consultar qué cambió, cuándo se confirmó y por qué el escenario actual difiere del anterior. Simular una alternativa nunca registra un pago real.

**Interfaz:** una aplicación de una pantalla, con un área central adaptable. Renderiza una composición declarativa validada, sin ejecutar HTML, React o JavaScript generado. Los controles esenciales y el contexto del negocio permanecen estables.

## Pantallas que se adaptan

Seis componentes reutilizables: resumen de riesgo, calendario de caja, facturas relevantes, comparador de planes, restricciones/bloqueos e historial antes/después.

| Situación | Composición esperada, no plantilla fija |
|---|---|
| Nómina en riesgo | Riesgo destacado, comparación de planes, calendario y restricciones. |
| Cobros pendientes | Facturas relevantes, costos de adelanto y comparación. |
| Sin solución | Bloqueos y faltante protagonistas; historial y calendario; sin planes ficticios. |

El agente puede seleccionar, ordenar y dar énfasis dentro de ese catálogo. El usuario conserva controles estables para confirmar, rechazar, cambiar enfoque y volver. El servidor exige mostrar advertencias y condiciones relevantes aunque el agente las omita.

## Demo principal

1. Abrir negocio sintético con semana inicialmente viable.
2. Pegar aviso de un cliente: se retrasa una factura.
3. Gemini identifica factura y fecha; pregunta si es ambiguo. El usuario confirma antes de cambiar datos.
4. El motor muestra el faltante y dos alternativas condicionadas. Gemini compone la vista de riesgo.
5. Pedir «enfócate en los cobros»: presenta facturas y alternativas de adelanto de forma prominente.
6. Rechazar el aplazamiento del proveedor: el motor lo excluye; nueva composición con las opciones restantes.
7. Excluir también el adelanto: mostrar que no existe solución dentro de las acciones permitidas y el faltante mínimo residual.
8. Abrir el historial: ver el cobro original, el aviso confirmado y las decisiones sobre escenarios, claramente diferenciados.

## Alcance cerrado

Un negocio, una moneda MXN, siete días, aproximadamente diez obligaciones. Acciones discretas: aplazar un pago, dividir un pago o adelantar un cobro con descuento, solo si sus condiciones están registradas. Planes ordenados por costo y cantidad de compromisos modificados. Negociaciones pendientes se muestran como condiciones, nunca como acuerdos.

No incluir: Nessie/banca, crédito nuevo, pagos reales, negociación automática, WhatsApp, voz, múltiples negocios, modelos predictivos, probabilidades de cobro inventadas, pantallas con código arbitrario ni red de agentes. PDF es opcional después del flujo central y queda fuera de la primera entrega. No incorporar dependencias extra para perseguir premios.

## Cómo saber que está logrado

- El ejemplo numérico y casos límite coinciden con resultados calculados automáticamente.
- Una novedad ambigua no modifica datos y confirmar dos veces no duplica el evento.
- Rechazar una acción cambia la solución del motor, no solo el texto.
- Tres situaciones producen composiciones diferentes mediante el mismo renderer.
- No se pueden mostrar importes o planes inventados por la IA.
- El historial consultado a Tiger Data reproduce los estados antes/después.
- Un fallo de Gemini mantiene disponible una vista básica del resultado; la interfaz informa que no se obtuvo composición de IA.
- Demo completa ensayada con integraciones reales; cualquier parte pendiente queda identificada.

La captura del premio Tiger Data anuncia «Best Use of Tiger Data», sin rúbrica completa. No se garantiza elegibilidad ni premio de Tiger Data o Gemini. No se han validado impacto comercial, ahorro real ni usuarios reales.
