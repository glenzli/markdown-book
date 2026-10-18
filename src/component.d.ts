export type ExperimentValue =
  | null
  | boolean
  | number
  | string
  | ExperimentValue[]
  | { [key: string]: ExperimentValue };
/** Optional local, per-book/chapter/component-instance state. Save finite JSON only (8 KiB).
 * Validate schema/version and ranges after load. Restored playback must stay paused.
 * describe supplies a bounded JSON snapshot for a user-reviewed discussion draft.
 */
export interface ExperimentSession {
  load(): ExperimentValue | undefined;
  save(value: ExperimentValue): void;
  describe(capture: () => ExperimentValue): void;
}
export interface ComponentContext<Props = Record<string, unknown>> {
  element: HTMLElement;
  props: Props;
  signal: AbortSignal;
  session?: ExperimentSession;
}
/** Return a cleanup function, synchronously or asynchronously. Keep UI inside element. */
export type Mount<Props = Record<string, unknown>> = (
  context: ComponentContext<Props>,
) => void | (() => void) | Promise<void | (() => void)>;
