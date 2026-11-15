// Shape fill resolution (R-005: as const registries, R-016: SVG presentation only, R-021: deterministic rendering).
import { FILL_STYLES } from "@open-draw/contracts";
import type { Shape } from "@open-draw/document";
import { escapeXml } from "./escape-xml";

export const CONTENT_FILL_FALLBACK = "#ffffff";
export const CONTENT_STROKE_FALLBACK = "#1f2933";

export interface ResolvedFill {
  readonly fill: string;
  readonly fillOpacity?: number | undefined;
  readonly defs?: string | undefined;
}

export interface ResolveFillOptions {
  readonly instanceId?: string | undefined;
}

/**
 * Resolves the effective SVG fill, fill-opacity, and defs for a shape based on its fillStyle and fill (R-005, R-021).
 */
export function resolveShapeFill(
  shape: Shape,
  defaultFill = CONTENT_FILL_FALLBACK,
  options?: ResolveFillOptions,
): ResolvedFill {
  const fillStyle = shape.fillStyle;
  if (fillStyle === FILL_STYLES.none) {
    return { fill: "none" };
  }
  if (fillStyle === FILL_STYLES.subtle) {
    const tintColor =
      shape.fill && shape.fill !== "none" && shape.fill !== "transparent"
        ? shape.fill
        : shape.stroke && shape.stroke !== "none"
          ? shape.stroke
          : CONTENT_STROKE_FALLBACK;
    return { fill: escapeXml(tintColor), fillOpacity: 0.1 };
  }
  if (fillStyle === FILL_STYLES.solid) {
    return { fill: escapeXml(shape.fill ?? defaultFill) };
  }
  if (fillStyle === FILL_STYLES.hatch) {
    const prefix = options?.instanceId ? `${escapeXml(options.instanceId)}-` : "";
    const patternId = `od-pattern-hatch-${prefix}${escapeXml(shape.id)}`;
    const strokeColor = escapeXml(
      shape.stroke && shape.stroke !== "none" ? shape.stroke : CONTENT_STROKE_FALLBACK,
    );
    const defs = `<defs><pattern id="${patternId}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45 0 0)"><line x1="0" y1="0" x2="0" y2="10" stroke="${strokeColor}" stroke-width="1.5" /></pattern></defs>`;
    return { fill: `url(#${patternId})`, defs };
  }
  if (shape.fill !== undefined) {
    return { fill: escapeXml(shape.fill) };
  }
  return { fill: escapeXml(defaultFill) };
}
