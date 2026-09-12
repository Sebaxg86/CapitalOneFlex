# Instrucciones de implementación

Trabaja en esta carpeta de prototipo. Lee PROYECTO.md y ARQUITECTURA.md completos antes de implementar. El usuario aprobó este alcance, incluida composición dinámica de UI. No modificar HackOS ni sus fuentes desde este trabajo.

## Objetivo

Construir y ejecutar una demo local verificable de Compromisos bajo presión. No detenerse en un mockup: motor real, persistencia Tiger Data e integración Gemini cuando estén disponibles las credenciales. Separar lo comprobado de lo pendiente.

## Forma de trabajar

- Documentos y comunicación en español. UI clara, breve y consistente, textos centralizados para futura traducción; no añadir un sistema multilingüe ahora.
- Usar el stack propuesto y resolver detalles rutinarios sin pedir confirmación a cada paso. Si el entorno exige un ajuste material, explicarlo antes de ampliar dependencias o alcance.
- Implementar por etapas de ARQUITECTURA.md. Empezar por fixture/motor y sus pruebas, luego persistencia, renderer y Gemini. Mostrar pronto el recorrido local.
- No añadir funciones fuera de alcance: banca/Nessie, préstamos, voz, WhatsApp, automatización de pagos, múltiples negocios, predicción financiera ni agentes que generen código ejecutable.
- No delegar ni crear una infraestructura multiagente por inferencia: un agente lógico del producto con interpretación y composición basta.
- Preservar cambios del usuario. No reemplazar documentos ni decisiones aprobadas con un resumen menos completo.

## Invariantes del producto

- Dinero en centavos; cálculo determinista. Gemini nunca es la autoridad sobre números o factibilidad.
- Solo aplicar novedades válidas tras confirmación humana; operaciones idempotentes y revisión de concurrencia.
- Planes hipotéticos y acuerdos pendientes no se convierten en movimientos liquidados.
- UI dinámica mediante JSON validado + seis componentes permitidos. No eval, HTML libre, scripts generados ni SQL del modelo.
- Datos, referencias y acciones de cada vista pertenecen al resultId vigente. Si llega una composición antigua, descartarla.
- La vista nunca oculta inviabilidad ni condiciones de aceptación. Controles esenciales estables.
- Conservar fallbacks explícitos sin atribuirlos a Gemini o Tiger Data. No falsificar logs, llamadas, métricas, ahorro ni validación con usuarios.

## Entorno y ejecución

- Inspeccionar herramientas disponibles y versiones antes de instalar. Fijar dependencias y lockfile; usar documentación oficial para Gemini y Tiger Data.
- Crear `.env.example` y `.gitignore` antes de manejar credenciales. Nunca exponer secretos al cliente, logs o Git. No solicitar claves pegadas en documentos: indicar variables locales necesarias.
- Si faltan claves, continuar motor/UI con adaptadores de fixtures rotulados. Entregar una lista breve de variables pendientes y pasos de prueba real. No afirmar integración completada.
- Implementar scripts npm descritos en arquitectura. Crear README con instalación, variables, migración/seed, ejecución, tests y reinicio exclusivo de datos demo.
- El seed debe ser idempotente y nunca borrar bases existentes. Usar una base/schema dedicado. No publicar, comprar servicios ni modificar infraestructura ajena como parte de esta tarea.
- Arrancar servidor local, comprobar una página/respuesta y dejar instrucciones concretas. Documentar URL y puerto realmente utilizados.

## Evidencia antes de entregar

- Tests del oráculo numérico, restricciones, descuentos/redondeo, acciones incompatibles y caso sin solución.
- Pruebas de esquema UI: campos desconocidos, referencias inventadas, importes no autorizados, composición antigua y fallback.
- Prueba de mensaje ambiguo y confirmación duplicada sin duplicar eventos.
- Recorrido de las tres situaciones con composición distinta, rechazos y reconstrucción temporal.
- Build y tests pertinentes pasan. Pruebas live solo cuando están configuradas; reportarlas por separado de mocks.
- Entrega breve: qué funciona, cómo abrirlo, qué se verificó y qué falta. No llamar producción lista a esta demo.

## Primer paso concreto

Implementar el caso numérico de la sección 3 de ARQUITECTURA.md en funciones puras y pruebas. Seguir con el recorrido vertical hasta que un mensaje confirmado cambie datos, produzca un resultado verificable y genere una composición válida. No gastar el tiempo inicial en branding o animaciones.

## Configuración e intervención humana

Leer `CONFIGURACION.md`: obtener claves, preparar `.env.local`, solicitar intervención temprana y verificar ambas integraciones reales. Aplicar su protocolo sin exponer secretos.
