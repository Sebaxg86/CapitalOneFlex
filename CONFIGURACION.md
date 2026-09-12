# Configuración real e intervención humana

Gemini API y Tiger Data son obligatorios para completar la demo. Un modo local permite avanzar, pero no satisface esa entrega. No se han creado cuentas ni servicios desde esta documentación.

## Cuándo debe actuar Claude

1. Al comenzar, preparar adaptadores, validación de variables, `.env.example` y `.gitignore`. Verificar presencia de configuración sin imprimir valores. No sobrescribir archivos de entorno existentes.
2. Pedir temprano al usuario que prepare las dos cuentas en paralelo al desarrollo del motor/UI. No esperar hasta terminar el prototipo para descubrir que faltan accesos.
3. Solicitar intervención solo para login/consentimientos, elegir proyecto o servicio cuando sea ambiguo, obtener secretos, activar facturación si fuese necesaria o resolver permisos de cuenta. Las compras y cambios de plan requieren decisión explícita del usuario.
4. Mientras espera, continuar pruebas y componentes independientes con fixtures identificados. Cuando el usuario diga que guardó las variables, cargar el entorno y probar las conexiones. No pedir que copie claves al chat.
5. Una vez configurados los servicios, ejecutar migraciones no destructivas en el espacio dedicado y pruebas acotadas. Ante error, diagnosticar sin mostrar secretos y sin reintentos indefinidos.

## Gemini: pasos para el usuario

1. Abrir [Google AI Studio — API keys](https://aistudio.google.com/app/apikey) e iniciar sesión con Google.
2. Seleccionar o crear el proyecto del equipo y generar una clave mediante la opción de crear API key. Si un proyecto no aparece, revisar importación/permisos según la documentación oficial; no usar una cuenta ajena.
3. Revisar las condiciones y cuotas mostradas para esa cuenta. No se promete nivel gratuito ni disponibilidad de un modelo. Si pide facturación o requiere un cambio de plan, el usuario decide antes de activarlo.
4. Guardar la clave directamente en `.env.local` de la carpeta del prototipo, en `GEMINI_API_KEY`. No compartirla por chat, documentos, capturas o Git.
5. Claude debe identificar un modelo accesible compatible con salida estructurada y guardar su identificador exacto en `GEMINI_MODEL`. El usuario no necesita adivinar el nombre. Si hay que elegir un modelo con costo distinto, explicar la elección.

La clave de Gemini API se obtiene en AI Studio; no es una contraseña de Google ni una suscripción de chat. Referencia: [gestión oficial de claves](https://ai.google.dev/gemini-api/docs/api-key).

## Tiger Data: pasos para el usuario

1. Entrar a la consola desde [Tiger Data](https://www.tigerdata.com/), crear cuenta o iniciar sesión. Si el evento ofrece crédito o enlace de patrocinador, consultar sus instrucciones antes de contratar un servicio; la foto no confirma beneficios específicos.
2. Crear o seleccionar un servicio dedicado a esta demo con soporte Timescale. Revisar región, recursos y costo/trial antes de confirmar; Claude no debe comprar servicios ni asumir que son gratuitos.
3. Abrir los detalles de conexión del servicio. Obtener host, puerto, nombre de base, usuario y contraseña del servicio o copiar la URI de conexión que muestre la consola.
4. Guardar la URI completa en `DATABASE_URL` dentro de `.env.local`. La contraseña de la base puede ser distinta de la del portal. Conservarla al crear el servicio; si se perdió, usar el mecanismo de recuperación/restablecimiento de la consola, teniendo en cuenta otros consumidores si el servicio ya existía.
5. Confirmar a Claude que es el servicio dedicado del prototipo. No enviarle por chat la URI con contraseña.

Para las consultas de este proyecto NO se necesita una API key de administración de Tiger Data: se necesita conexión PostgreSQL. Referencias: [detalles de conexión](https://docs.tigerdata.com/use-timescale/latest/integrations/find-connection-details/) y [gestión del servicio](https://docs.tigerdata.com/use-timescale/latest/services/service-management).

## Archivo local y carga del entorno

Claude debe crear `.env.example` con los nombres de abajo y valores vacíos o placeholders; el usuario crea `.env.local` para los secretos. El bloque es ilustrativo, no credenciales utilizables:

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=
DATABASE_URL=
DEMO_TODAY=2026-09-12
```

Formato orientativo de URI: `postgresql://USUARIO:CLAVE_CODIFICADA@HOST:PUERTO/BASE?sslmode=require`. Preferir la URI del proveedor; si se construye, codificar caracteres reservados del usuario/contraseña. No imprimir la URI para comprobarla. Usar TLS conforme a las instrucciones del proveedor y del cliente pg, verificando certificados; no resolver errores desactivando verificación indiscriminadamente.

Next.js debe leer estas variables solo en servidor. Nunca usar prefijo NEXT_PUBLIC para secretos. Los scripts de migración, seed y pruebas que corren fuera de Next.js deben cargar explícitamente el mismo `.env.local` (por ejemplo, con el cargador de entorno de Next.js), no asumir que lo cargarán automáticamente. Reiniciar el proceso tras cambios.

`.gitignore` debe excluir `.env*` excepto `.env.example`; verificar que `.env.local` no esté versionado. Los errores de conexión pueden contener credenciales: sanitizarlos antes de mostrarlos. No volcar process.env.

## Qué debe verificar Claude al recibir “ya configuré las variables”

**Gemini:** autenticar con la clave, verificar identificador y ejecutar una prueba pequeña de salida estructurada con datos ficticios. Después comprobar interpretación y composición contra los contratos reales. Reportar modelo, resultado y uso si está disponible; nunca la clave. No sustituir por mock si falla y marcarlo como éxito.

**Tiger Data:** conectar al servicio configurado, realizar consulta simple, comprobar extensión Timescale y versión, aplicar migraciones en el espacio dedicado, verificar que financial_events sea realmente hypertable y ejecutar escritura/lectura y consulta por intervalo temporal. Usar seed idempotente y no borrar datos ajenos. Si faltan privilegios, indicar la operación exacta que el usuario debe habilitar; no sustituir silenciosamente por otra base.

**Recorrido integrado:** mensaje → propuesta → confirmación → evento y estado persistidos → motor → composición real → renderer. Reiniciar servidor y comprobar que el historial sobrevive. Rechazar acción y verificar escenario separado. Las pruebas con fixtures no sustituyen esta verificación.

## Mensaje concreto que Claude puede usar

“Ya puedo conectar las integraciones. Abre CONFIGURACION.md y guarda GEMINI_API_KEY y DATABASE_URL en .env.local. Yo comprobaré el modelo accesible y la conexión sin mostrar secretos. Avísame ‘variables listas’; mientras tanto continúo con el motor y la interfaz. Si el proveedor pide activar un plan de pago, dime cuál antes de contratarlo.”

## Cierre obligatorio

Informar por separado: Gemini real verificado / pendiente; Tiger Data real y hypertable verificados / pendientes; demo integrada verificada / pendiente. La entrega no está completa mientras alguna integración obligatoria solo funcione con fixtures. No afirmar funcionamiento por la mera presencia de una variable.
