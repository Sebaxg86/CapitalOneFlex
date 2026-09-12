import type { ComposedView, IntegrationStatus, IntegrationsState } from '@/lib/contracts';
import { TEXTS } from '@/lib/texts';

/**
 * Estado honesto de los proveedores.
 *
 * El detalle técnico vive en el pie, lejos de las decisiones de negocio. El
 * aviso de que la vista NO la compuso Gemini se separa a propósito en
 * `AvisoVistaBasica`, porque tiene que aparecer junto al contenido al que
 * afecta, no escondido en el pie.
 */
export interface IntegrationBadgesProps {
  integrations: IntegrationsState;
  view: ComposedView;
  describir: (status: IntegrationStatus) => string;
}

type Nivel = 'verificado' | 'configurado' | 'fixture';

/** Nivel de confianza del estado. Nunca "verificado" si `verified` es false. */
function nivelDe(status: IntegrationStatus): Nivel {
  if (!status.configured) return 'fixture';
  return status.verified ? 'verificado' : 'configurado';
}

/** El color nunca es el único portador de significado: siempre hay símbolo y texto. */
const MARCA: Record<Nivel, string> = {
  verificado: TEXTS.integraciones.marcaVerificado,
  configurado: TEXTS.integraciones.marcaConfigurado,
  fixture: TEXTS.integraciones.marcaNoConfigurado,
};

const SIMBOLO: Record<Nivel, string> = {
  verificado: '●',
  configurado: '◐',
  fixture: '○',
};

const CLASES: Record<Nivel, string> = {
  verificado: 'text-ok-texto',
  configurado: 'text-aviso-texto',
  fixture: 'text-tinta-tenue',
};

function Badge({
  nombre,
  status,
  describir,
}: {
  nombre: string;
  status: IntegrationStatus;
  describir: (status: IntegrationStatus) => string;
}) {
  const nivel = nivelDe(status);
  return (
    <li className="min-w-0">
      <p className={`flex flex-wrap items-baseline gap-x-2 text-cuerpo-sm ${CLASES[nivel]}`}>
        <span aria-hidden="true">{SIMBOLO[nivel]}</span>
        <span className="font-semibold text-tinta">{nombre}</span>
        <span className="text-pie font-semibold uppercase tracking-wide">{MARCA[nivel]}</span>
      </p>
      <p className="mt-0.5 text-pie text-tinta-tenue">{describir(status)}</p>
      {status.model ? (
        <p className="mt-0.5 text-pie text-tinta-tenue">
          {TEXTS.integraciones.modeloEtiqueta}: <span className="font-mono">{status.model}</span>
        </p>
      ) : null}
    </li>
  );
}

/**
 * Aviso de vista básica. Va junto al contenido compuesto: si la composición no
 * vino del modelo, hay que decirlo donde el usuario mira, y nunca atribuirla
 * a Gemini.
 */
export function AvisoVistaBasica({ view }: { view: ComposedView }) {
  if (view.source !== 'fallback') return null;
  return (
    <div
      role="status"
      className="mb-3 rounded-tarjeta border border-aviso bg-aviso-suave px-4 py-3 text-cuerpo-sm text-aviso-texto"
    >
      <p className="font-semibold">⚠ {TEXTS.integraciones.fallbackTitulo}</p>
      <p className="mt-1">{TEXTS.integraciones.fallbackCuerpo}</p>
      <p className="mt-1 text-pie">
        {TEXTS.integraciones.fallbackMotivoEtiqueta}:{' '}
        {view.fallbackReason ?? TEXTS.integraciones.fallbackSinMotivo}
      </p>
    </div>
  );
}

export default function IntegrationBadges({ integrations, describir }: IntegrationBadgesProps) {
  return (
    <section aria-labelledby="integraciones-titulo">
      <h2 id="integraciones-titulo" className="rotulo">
        {TEXTS.integraciones.titulo}
      </h2>
      <ul className="mt-2 grid gap-4 sm:grid-cols-2">
        <Badge
          nombre={TEXTS.integraciones.gemini}
          status={integrations.gemini}
          describir={describir}
        />
        <Badge
          nombre={TEXTS.integraciones.tigerData}
          status={integrations.tigerData}
          describir={describir}
        />
      </ul>
    </section>
  );
}
