export interface ComponentContext<Props = Record<string, unknown>> {
  element: HTMLElement;
  props: Props;
  signal: AbortSignal;
}
/** Return a cleanup function, synchronously or asynchronously. Keep UI inside element. */
export type Mount<Props = Record<string, unknown>> = (
  context: ComponentContext<Props>,
) => void | (() => void) | Promise<void | (() => void)>;
