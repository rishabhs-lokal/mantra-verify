/**
 * Placeholder connector for handing a chant off to its module.
 *
 * `mode` is the identifier collected from the user's tap ("solo" vs "astro_ved") —
 * this is what a real implementation would use to route to the right backend/module.
 * Today this just simulates connection latency; swap the body of
 * `connectToChantModule` for the real call once a module is wired up
 * (e.g. https://github.com/rishabhs-lokal/mantra-verify — POST /verify with
 * session_id/mantra_id/target_count, GET /count/{session_id} to poll progress).
 */

export type ChantMode = 'solo' | 'astro_ved';

export interface ChantModuleRequest {
  /** Which module to route to — the identifier captured from the tap. */
  mode: ChantMode;
  /** The mantra text being chanted (e.g. "Om Namah Shivaya"). */
  mantra: string;
  /** Jaap target for this session, if the module needs one (e.g. 12). */
  targetCount?: number;
}

export async function connectToChantModule(request: ChantModuleRequest): Promise<void> {
  void request; // unused until the real module call replaces this
  await new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
}
