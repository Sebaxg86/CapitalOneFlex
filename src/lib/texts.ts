/**
 * Todos los textos visibles de la interfaz, en un único objeto.
 *
 * Regla: ningún componente escribe cadenas sueltas. Esto mantiene el tono
 * consistente y deja el camino abierto a una traducción futura, sin añadir
 * ahora un sistema multilingüe.
 *
 * Excepciones deliberadas: los textos que vienen del motor o del dataset
 * (títulos de riesgo, descripciones de acciones, notas de alcance) se muestran
 * literalmente, porque son datos calculados y no copia de interfaz.
 */
import type { ConstraintKind, RiskItem } from '@/domain/types';

export const TEXTS = {
  /** Identidad del producto. */
  marca: {
    nombre: 'Flex',
    descriptor: 'Compromisos bajo presión',
  },

  metadatos: {
    titulo: 'Flex · Compromisos bajo presión',
    descripcion:
      'Demo local: calcula la caja de la semana, organiza la vista según el enfoque y espera tu confirmación antes de cambiar nada.',
  },

  shell: {
    saltarAlContenido: 'Saltar al contenido principal',
    encabezadoTitulo: 'Compromisos bajo presión',
    negocioEtiqueta: 'Negocio',
    monedaEtiqueta: 'Moneda',
    horizonteEtiqueta: 'Horizonte',
    horizonteSeparador: '–',
    hoyEtiqueta: 'Día de la demo',
    escenarioEtiqueta: 'Escenario',
    revisionEtiqueta: 'Revisión',
    saldoInicialEtiqueta: 'Saldo inicial',
    cajaMinimaEtiqueta: 'Dinero de reserva',
    almacenamientoEtiqueta: 'Los datos',
    almacenamiento: {
      'tiger-data': 'Se guardan de forma permanente',
      'memoria-local': 'Solo duran esta sesión',
    },
    avisosTitulo: 'Avisos importantes',
    controlesTitulo: 'Controles fijos',
    controlesAyuda: 'Estos controles siempre están aquí.',
    focoLeyenda: 'Enfoque de la vista',
    focoAyuda: 'Cambiar el enfoque reordena lo que ya se calculó. No vuelve a calcular nada.',
    volverBoton: 'Deshacer último cambio',
    volverAyuda: 'Vuelve al escenario anterior.',
    volverVacio: 'Todavía no hay nada que deshacer.',
    decisionesTitulo: 'Confirmar o descartar',
    zonaAdaptableTitulo: 'Vista compuesta',
    notaIntradiaTitulo: 'Cómo se calcula el saldo del día',
    estadoTrabajando: 'Calculando…',
    estadoListo: 'Listo.',
    tituloComposicion: 'Origen de la vista',
    composicionFuente: {
      gemini: 'Vista organizada por Gemini',
      fallback: 'Vista organizada por el sistema',
    },
    bienvenidaTitulo: 'Empieza pegando el aviso de un cliente',
    bienvenidaCuerpo: 'Nada cambia hasta que tú lo confirmes.',
    cambioAplicado: 'Cambio aplicado. El escenario se volvió a calcular.',
    datosFicticios: 'Negocio y mensajes de ejemplo: nada de esto es un cliente real.',
    sinPlanes: 'Ya no queda ningún plan que cubra el faltante.',
    planesRestantes: 'Quedan {n} planes posibles.',
  },

  /** Línea de estado del encabezado: una sola frase sobre cómo está la semana. */
  estado: {
    bloqueadoTitulo: 'Ningún plan cubre el faltante',
    bloqueadoResidual: 'Lo que seguiría faltando aun con el mejor plan',
    riesgoTitulo: 'Esta semana falta',
    riesgoDia: 'Día más ajustado',
    cubiertoTitulo: 'La semana queda cubierta',
    cubiertoDetalle: 'Saldo más bajo de la semana',
  },

  integraciones: {
    titulo: 'Integraciones',
    gemini: 'Gemini API',
    tigerData: 'Tiger Data',
    modeloEtiqueta: 'Modelo',
    estadoVerificado: 'Verificado en esta ejecución',
    estadoConfigurado: 'Configurado, sin comprobar contra el proveedor',
    estadoNoConfigurado: 'Sin conectar: datos de ejemplo',
    marcaVerificado: '● Verificado',
    marcaConfigurado: '◐ Sin comprobar',
    marcaNoConfigurado: '○ Sin conectar',
    fallbackTitulo: 'Esta vista no la organizó Gemini',
    fallbackCuerpo:
      'La organizó el propio sistema con su vista básica. No procede de Gemini.',
    fallbackMotivoEtiqueta: 'Motivo',
    fallbackSinMotivo: 'No se registró un motivo.',
  },

  renderer: {
    ajustesTitulo: 'Comprobaciones automáticas',
    ajustesAyuda:
      'Esta información se añade siempre, aunque la vista sugerida la omitiera: nunca se oculta un bloqueo ni una condición pendiente.',
    prioridadEtiqueta: 'Prioridad',
    prioridad: {
      high: 'alta',
      normal: 'normal',
      low: 'secundaria',
    },
    vacio: 'Todavía no hay nada que mostrar en esta vista.',
    verDetalle: 'Ver detalle',
    ocultarDetalle: 'Ocultar detalle',
  },

  riesgo: {
    faltanteTotalEtiqueta: 'Total que falta esta semana',
    saldoMinimoEtiqueta: 'Lo mínimo que te quedaría',
    saldoMinimoFechaEtiqueta: 'Día del saldo más bajo',
    sinRiesgoTitulo: 'La semana no presenta faltante',
    sinRiesgoCuerpo:
      'Con los compromisos registrados, ningún cierre del horizonte queda por debajo de la caja mínima.',
    listaTitulo: 'Compromisos afectados',
    diaEtiqueta: 'Día',
    faltanteEtiqueta: 'Falta ese día',
    severidadEtiqueta: 'Severidad',
    severidad: {
      high: 'alta',
      medium: 'media',
      low: 'baja',
    },
    bloqueoTitulo: 'Con estas opciones todavía falta dinero',
    bloqueoResidualEtiqueta: 'Lo que seguiría faltando aun con el mejor plan',
    bloqueoAlcanceEtiqueta: 'Alcance de esta conclusión',
    bloqueoMotivo: {
      no_solution: 'Sin solución con las acciones registradas y no rechazadas.',
      search_too_wide: 'Escenario demasiado amplio para enumerar las combinaciones permitidas.',
    },
    bloqueoCombinaciones: 'Combinaciones evaluadas',
    bloqueoRemite: 'No hay ninguna combinación que cubra el faltante. El detalle está en «Restricciones».',
    comparativa: 'El faltante pasó de {antes} a {después}',
  },

  calendario: {
    titulo: 'Tu dinero por día',
    tablaResumen:
      'Saldo de cierre de cada día del horizonte, con los cobros y pagos que lo componen.',
    colDia: 'Día',
    diasHorizonteEtiqueta: 'Días que revisamos',
    diasBajoMinimoEtiqueta: 'Días en los que no alcanza',
    colCobros: 'Cobros',
    colPagos: 'Pagos',
    colCierre: 'Saldo de cierre',
    colNivel: 'Nivel frente a la caja mínima',
    colEstado: 'Estado',
    estadoBajoMinimo: '▼ Bajo la caja mínima',
    estadoSobreMinimo: '✓ Sobre la caja mínima',
    lineaMinimaEtiqueta: 'Dinero que quieres reservar',
    lineaMinimaLeyenda: 'La línea vertical marca el nivel de caja mínima en cada barra.',
    pendientesTitulo: 'Pendiente para la próxima semana',
    pendientesAyuda:
      'Aplazar o dividir no elimina la obligación: estos importes siguen pendientes después del último día del horizonte.',
    pendientesVacio: 'No hay vencimientos registrados después del horizonte.',
    pendienteMovido: 'Salió del horizonte por una acción del plan',
    direccion: {
      inflow: 'Cobro',
      outflow: 'Pago',
    },
  },

  cobros: {
    titulo: 'Facturas relevantes',
    vacio: 'No hay facturas por cobrar registradas en este escenario.',
    sinRelevantes: 'Ninguna factura encaja con este enfoque.',
    dentroHorizonte: 'Esta semana',
    fueraHorizonte: 'Después de esta semana',
    importeEtiqueta: 'Importe',
    fechaEtiqueta: 'Fecha esperada',
    conceptoEtiqueta: 'Concepto',
    adelantoTitulo: 'Adelanto disponible',
    adelantoNetoEtiqueta: 'Neto que se recibiría',
    adelantoCostoEtiqueta: 'Costo del adelanto',
    adelantoFechaEtiqueta: 'Fecha de cobro adelantado',
    adelantoCondicion: 'Requiere que el cliente acepte: no es liquidez garantizada.',
    adelantoExcluido: '✗ Descartada por el usuario',
  },

  planes: {
    titulo: 'Tus opciones',
    costoEtiqueta: 'Costo',
    modificadosEtiqueta: 'Pagos que cambian',
    saldoMinimoEtiqueta: 'Mínimo en la semana',
    saldoMinimoFechaEtiqueta: 'Día del saldo mínimo',
    accionesTitulo: 'Acciones del plan',
    accionCostoEtiqueta: 'Costo de la acción',
    condicionalAviso: 'Depende de que acepten',
    condicionalCuerpo:
      'Este plan solo funciona si la otra parte acepta. Mientras tanto no cuentes con ese dinero.',
    condicionesTitulo: 'Condiciones pendientes',
    condicionAprobacion: {
      confirmed: 'Acuerdo ya registrado',
      requires_agreement: 'Por confirmar',
    },
    noCondicional: 'Sin condiciones pendientes: todas las acciones ya están registradas.',
    rechazarPrefijo: 'Descartar',
    excluirPrefijo: 'No puedo hacer esto con',
    rechazarAyuda:
      'Quitamos esta opción y buscamos otra. No se cancela ningún pago.',
    rechazando: 'Descartando…',
  },

  restricciones: {
    titulo: 'Qué puedes cambiar',
    vacio: 'No hay restricciones registradas para este escenario.',
    grupos: {
      essential_obligation: 'Compromisos esenciales',
      minimum_cash: 'Dinero de reserva',
      excluded_action: 'Acciones descartadas',
      requires_agreement: 'Condiciones pendientes',
      outside_horizon: 'Pagos para después de esta semana',
    } satisfies Record<ConstraintKind, string>,
    bloqueoTitulo: 'Escenario bloqueado',
    bloqueoResidualEtiqueta: 'Lo que aún falta',
    bloqueoAfectadas: 'Restricciones implicadas',
    importeEtiqueta: 'Importe',
    fechaEtiqueta: 'Fecha',
  },

  historial: {
    eventosContador: 'eventos registrados',
    verAnteriores: 'Ver los eventos anteriores',
    titulo: 'Historial antes/después',
    vacio: 'Aún no hay eventos registrados.',
    vacioAyuda: 'No se inventa historial: esta zona solo muestra eventos guardados.',
    tablaResumen:
      'Eventos del escenario en orden de registro, con la revisión anterior y la resultante.',
    colRegistro: 'Registrado (UTC)',
    colCambio: 'Cambio',
    colRevisiones: 'Antes → después',
    colTipo: 'Tipo de evento',
    colDetalle: 'Detalle',
    estadoInicial: 'estado inicial',
    revisionPrefijo: 'revisión',
    leyendaTitulo: 'Cómo leer estos eventos',
    leyenda: [
      'Una expectativa actualizada cambia la fecha esperada de un cobro. No es un cobro recibido.',
      'Un plan aceptado sigue siendo un escenario condicionado. No es un pago ejecutado.',
      'Solo los movimientos liquidados representan dinero que ya entró o salió.',
    ],
    tipos: {
      expectativa: { etiqueta: '◇ Expectativa actualizada', nota: 'Cambia lo previsto, no el dinero.' },
      liquidado: { etiqueta: '■ Movimiento liquidado', nota: 'Dinero que ya entró o salió.' },
      escenario: { etiqueta: '◆ Decisión de escenario', nota: 'Condicionada: no ejecuta pagos.' },
      resultado: { etiqueta: '▸ Resultado calculado', nota: 'Salida del motor determinista.' },
      otro: { etiqueta: '· Evento registrado', nota: 'Sin clasificación específica.' },
    },
  },

  redactor: {
    titulo: 'Aviso del cliente',
    ayuda:
      'Pega el mensaje recibido. Revisarlo no cambia ningún dato: siempre se confirma antes.',
    etiquetaTextarea: '¿Qué cambió?',
    marcador: 'Pega aquí el aviso del cliente…',
    interpretar: 'Ver qué cambia',
    interpretando: 'Revisando…',
    limpiar: 'Limpiar',
    ejemplosTitulo: 'Mensajes sintéticos de la demo',
    ejemplosAyuda: 'Ejemplos:',
    ejemploDemo: 'Retraso de factura',
    ejemploAmbiguo: 'Aviso ambiguo',
    vacio: 'Escribe o pega un mensaje antes de revisarlo.',
    aclaracionTitulo: 'Hace falta una aclaración',
    aclaracionCuerpo: 'No se cambió ningún dato. Responde y vuelve a enviar el mensaje.',
    aclaracionOpcionesTitulo: 'Elige una y vuelve a revisarlo',
    /** Se antepone a la opción elegida para completar el mensaje ya escrito. */
    aclaracionPrefijo: 'Se refiere a:',
    aclaracionFuente: {
      gemini: 'Pregunta planteada por Gemini.',
      fallback: 'Pregunta generada por el propio sistema, sin Gemini.',
    },
    errorTitulo: 'No se pudo interpretar el mensaje',
    errorManual:
      'Puedes aplicar el cambio a mano: el flujo de confirmación es el mismo y sigue necesitando tu aprobación.',
    errorRed: 'No hubo respuesta. Revisa la conexión e inténtalo otra vez.',
  },

  propuesta: {
    titulo: 'Cambios propuestos',
    resumenEtiqueta: 'Resumen',
    fuenteEtiqueta: 'Origen',
    fuente: {
      gemini: 'Interpretado por Gemini y comprobado antes de mostrarlo',
      manual: 'Capturado manualmente',
    },
    revisionBase: 'Revisión base',
    cambioTitulo: 'Cambio',
    diffEtiqueta: 'Antes y después',
    evidenciaEtiqueta: 'Fragmento del mensaje',
    confirmar: 'Aplicar el cambio',
    confirmando: 'Confirmando…',
    descartar: 'No aplicar',
    sinCambios: 'La propuesta no contiene cambios.',
    conflictoTitulo: 'El escenario cambió mientras lo revisabas',
    conflictoCuerpo:
      'Otra operación modificó el escenario. Vuelve a revisar la propuesta sobre la revisión vigente.',
    conflictoRevision: 'Revisión vigente',
    errorTitulo: 'No se pudo confirmar',
    duplicado: 'La operación ya se había aplicado con la misma clave: no se duplicó nada.',
    operaciones: {
      reschedule_receivable: 'Cambiar la fecha esperada de un cobro',
      exclude_action: 'Descartar una acción del escenario',
      set_minimum_cash: 'Ajustar la caja mínima',
    },
  },

  comunes: {
    si: 'Sí',
    no: 'No',
    cargando: 'Cargando…',
    errorGenerico: 'Ocurrió un error inesperado.',
    datosSinteticos: 'Datos sintéticos de la demo.',
  },
} as const;

/** Etiqueta en español de la severidad de un riesgo. */
export function severityLabel(severity: RiskItem['severity']): string {
  return TEXTS.riesgo.severidad[severity];
}
