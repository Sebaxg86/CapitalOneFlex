import { getWorkspaceState } from '@/server/workspace';
import Workspace from '@/components/workspace/Workspace';

/**
 * Página única de la demo. Es un Server Component: hace el fetch inicial del
 * estado llamando directamente a la función del servidor, sin pasar por HTTP.
 *
 * `getWorkspaceState(focus?: Focus): Promise<WorkspaceState>` la implementa la
 * capa de servidor (`src/server/workspace.ts`); aquí solo se consume.
 */
export const dynamic = 'force-dynamic';

export default async function Page() {
  const state = await getWorkspaceState();
  return <Workspace initialState={state} />;
}
