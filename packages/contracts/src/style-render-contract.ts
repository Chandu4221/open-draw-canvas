// Style rendering contracts (ADR-0005 D3, D4).
// Pure data types and registries, zero dependencies (R-002, R-005, R-021).

/**
 * Closed registry of shape fill styles (R-005, R-007).
 */
export const FILL_STYLES = {
  none: "none",
  subtle: "subtle",
  solid: "solid",
  hatch: "hatch",
} as const;

export type FillStyle = (typeof FILL_STYLES)[keyof typeof FILL_STYLES];

export const FILL_STYLE_VALUES: ReadonlySet<string> = new Set(Object.values(FILL_STYLES));

/**
 * Context provided to shape renderers.
 */
export interface StyleRenderContext {
  readonly seed?: number;
  readonly zoom?: number;
}

/**
 * Pure function rendering a shape (R-008, R-021).
 */
export type StyleShapeRenderer<TShape = unknown, TBox = unknown> = (
  shape: TShape,
  box: TBox,
  context?: StyleRenderContext,
) => string;

/**
 * Registry of shape renderers.
 */
export type StyleRendererMap<TShape = unknown, TBox = unknown> = Readonly<
  Record<string, StyleShapeRenderer<TShape, TBox>>
>;
