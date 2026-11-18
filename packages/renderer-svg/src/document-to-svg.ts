// SVG rendering of the canonical document (R-016: SVG is a rendering result,
// never truth; R-020: the renderer never holds canonical state; ADR-0003 D3).
// Pure Document → string (R-008). Presentation constants are registry data, not
// stringly internals (R-005).
import type { BoundingBox, BuiltinShapeKind, ShapeId } from "@open-draw/contracts";
import { isRootId, SHAPE_KINDS, SHAPE_KIND_LABELS } from "@open-draw/contracts";
import {
  absoluteBoundingBox,
  shapeListInOrder,
  type Document,
  type LineShape,
  type PenPathShape,
  type Shape,
} from "@open-draw/document";
import { escapeXml } from "./escape-xml";
import {
  CONTENT_FILL_FALLBACK,
  CONTENT_STROKE_FALLBACK,
  resolveShapeFill,
  type ResolvedFill,
} from "./resolve-fill";

export { resolveShapeFill, type ResolvedFill };

export const RENDER_STYLES = {
  contentFill: CONTENT_FILL_FALLBACK,
  contentStroke: CONTENT_STROKE_FALLBACK,
  selectionStroke: "#2563eb",
  selectionDasharray: "4 4",
  multiSelectionStroke: "#2563eb",
  handleFill: "#2563eb",
  fallbackFill: "none",
  fallbackStroke: "#94a3b8",
  fallbackDasharray: "4 4",
} as const;

export interface RendererFallbackEvent {
  readonly shapeId: ShapeId;
  readonly kind: string;
}

export type ShapeSvgRenderer = (shape: Shape, box: BoundingBox, options?: RenderOptions) => string;

export interface RenderOptions {
  readonly onFallback?: ((event: RendererFallbackEvent) => void) | undefined;
  readonly customRenderers?: Readonly<Record<string, ShapeSvgRenderer>> | undefined;
  readonly includeAnnotations?: boolean | undefined;
  readonly resolveDisplayName?: ((shape: Shape) => string) | undefined;
  readonly instanceId?: string | undefined;
  readonly visibleShapeIds?: ReadonlySet<ShapeId> | undefined;
  readonly wrapShapeId?: boolean | undefined;
}

function num(val: unknown, fallback = 0): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}

export function fallbackShapeToSvg(shape: Shape, box: BoundingBox): string {
  const label =
    shape.kind in SHAPE_KIND_LABELS
      ? SHAPE_KIND_LABELS[shape.kind as BuiltinShapeKind]
      : shape.kind;
  const safeLabel = escapeXml(label);
  const rect = `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${RENDER_STYLES.fallbackFill}" stroke="${RENDER_STYLES.fallbackStroke}" stroke-dasharray="${RENDER_STYLES.fallbackDasharray}" />`;
  const text = `<text x="${box.x + 8}" y="${box.y + 18}" font-family="sans-serif" font-size="12" fill="${RENDER_STYLES.fallbackStroke}" pointer-events="none" user-select="none">[${safeLabel}]</text>`;
  return rect + text;
}

export const DEFAULT_SHAPE_RENDERERS: Readonly<Record<string, ShapeSvgRenderer>> = Object.freeze({
  [SHAPE_KINDS.group]: (shape, box, options) => {
    if (shape.fill !== undefined || shape.stroke !== undefined) {
      const { fill, fillOpacity, defs } = resolveShapeFill(shape, "none", options);
      const stroke = shape.stroke ? ` stroke="${escapeXml(shape.stroke)}"` : "";
      const strokeWidthAttr =
        shape.strokeWidth !== undefined ? ` stroke-width="${num(shape.strokeWidth, 1)}"` : "";
      const fillOpacityAttr = fillOpacity !== undefined ? ` fill-opacity="${fillOpacity}"` : "";
      return `${defs ?? ""}<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width, 1)}" height="${num(box.height, 1)}" fill="${fill}"${stroke}${strokeWidthAttr}${fillOpacityAttr} />`;
    }
    return "";
  },
  [SHAPE_KINDS.rect]: (shape, box, options) => {
    const { fill, fillOpacity, defs } = resolveShapeFill(shape, RENDER_STYLES.contentFill, options);
    const stroke = escapeXml(shape.stroke ?? RENDER_STYLES.contentStroke);
    const strokeWidthAttr =
      shape.strokeWidth !== undefined ? ` stroke-width="${num(shape.strokeWidth, 1)}"` : "";
    const fillOpacityAttr = fillOpacity !== undefined ? ` fill-opacity="${fillOpacity}"` : "";
    return `${defs ?? ""}<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width, 1)}" height="${num(box.height, 1)}" fill="${fill}" stroke="${stroke}"${strokeWidthAttr}${fillOpacityAttr} />`;
  },
  [SHAPE_KINDS.ellipse]: (shape, box, options) => {
    const { fill, fillOpacity, defs } = resolveShapeFill(shape, RENDER_STYLES.contentFill, options);
    const stroke = escapeXml(shape.stroke ?? RENDER_STYLES.contentStroke);
    const strokeWidthAttr =
      shape.strokeWidth !== undefined ? ` stroke-width="${num(shape.strokeWidth, 1)}"` : "";
    const fillOpacityAttr = fillOpacity !== undefined ? ` fill-opacity="${fillOpacity}"` : "";
    return `${defs ?? ""}<ellipse cx="${num(box.x + box.width / 2)}" cy="${num(box.y + box.height / 2)}" rx="${num(box.width / 2, 1)}" ry="${num(box.height / 2, 1)}" fill="${fill}" stroke="${stroke}"${strokeWidthAttr}${fillOpacityAttr} />`;
  },
  [SHAPE_KINDS.line]: (shape, box) => {
    const line = shape as LineShape;
    const stroke = escapeXml(shape.stroke ?? RENDER_STYLES.contentStroke);
    const strokeWidth = num(shape.strokeWidth, 2);
    return `<line x1="${num(box.x + line.start.x)}" y1="${num(box.y + line.start.y)}" x2="${num(box.x + line.end.x)}" y2="${num(box.y + line.end.y)}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  },
  [SHAPE_KINDS.penPath]: (shape, box) => {
    const pen = shape as PenPathShape;
    const pointsStr = pen.points.map((p) => `${num(box.x + p.x)},${num(box.y + p.y)}`).join(" ");
    const stroke = escapeXml(shape.stroke ?? RENDER_STYLES.contentStroke);
    const strokeWidth = num(shape.strokeWidth, 2);
    const fill = escapeXml(shape.fill ?? "none");
    return `<polyline points="${pointsStr}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
  },
  [SHAPE_KINDS.text]: (shape, box) => {
    if (shape.fill !== undefined && shape.fill !== "none" && shape.fill !== "transparent") {
      const fill = escapeXml(shape.fill);
      const stroke = shape.stroke ? ` stroke="${escapeXml(shape.stroke)}"` : "";
      return `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width, 1)}" height="${num(box.height, 1)}" fill="${fill}"${stroke} />`;
    }
    return "";
  },
});

export function shapeToSvg(shape: Shape, box: BoundingBox, options?: RenderOptions): string {
  let renderer: ShapeSvgRenderer | undefined;

  if (options?.customRenderers?.[shape.kind] !== undefined) {
    renderer = options.customRenderers[shape.kind];
  } else {
    renderer = DEFAULT_SHAPE_RENDERERS[shape.kind];
  }

  let rendered: string;
  if (renderer !== undefined) {
    rendered = renderer(shape, box, options);
  } else {
    options?.onFallback?.({ shapeId: shape.id, kind: shape.kind });
    rendered = fallbackShapeToSvg(shape, box);
  }

  // Visible text on shapes (F2, ADR-0006 Option A / shape.content)
  if (shape.content !== undefined && shape.content !== null && shape.content.trim().length > 0) {
    const prefix = options?.instanceId ? `${escapeXml(options.instanceId)}-` : "";
    const clipId = `clip-${prefix}${escapeXml(shape.id)}`;
    const clip = `<defs><clipPath id="${clipId}"><rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width, 1)}" height="${num(box.height, 1)}" fill="none" /></clipPath></defs>`;
    const centerX = num(box.x + box.width / 2);
    const centerY = num(box.y + box.height / 2);
    const textColor = escapeXml(
      shape.stroke && shape.stroke !== "none" ? shape.stroke : RENDER_STYLES.contentStroke,
    );
    const text = `<text x="${centerX}" y="${centerY}" dominant-baseline="central" text-anchor="middle" font-family="sans-serif" font-size="14" fill="${textColor}" clip-path="url(#${clipId})" pointer-events="none" user-select="none">${escapeXml(shape.content)}</text>`;
    rendered = `${rendered}${clip}${text}`;
  }

  return rendered;
}

// Render a single shape to SVG with optional annotation/id wrapper.
export function renderSingleShapeSvg(
  document: Document,
  shape: Shape,
  options?: RenderOptions,
): string {
  const rendered = shapeToSvg(shape, absoluteBoundingBox(document, shape), options);

  if (options?.includeAnnotations === true) {
    const shapeIdAttr = `data-shape-id="${escapeXml(shape.id)}"`;
    const parentIdAttr = !isRootId(shape.parentId)
      ? ` data-parent-id="${escapeXml(shape.parentId)}"`
      : "";

    const displayName =
      options.resolveDisplayName?.(shape) ??
      (shape.label !== undefined && shape.label !== ""
        ? shape.label
        : shape.kind in SHAPE_KIND_LABELS
          ? SHAPE_KIND_LABELS[shape.kind as BuiltinShapeKind]
          : shape.kind);

    const safeA11yText = escapeXml(displayName);

    return `<g ${shapeIdAttr}${parentIdAttr} role="img" aria-label="${safeA11yText}"><title>${safeA11yText}</title>${rendered}</g>`;
  }

  if (options?.wrapShapeId === true) {
    return `<g data-shape-id="${escapeXml(shape.id)}">${rendered}</g>`;
  }

  return rendered;
}

// The whole document in pre-order walk order (structural order).
// Fallback emission surfaces via the pure options callback without singletons (R-008, ADR-0003 D3).
export function documentToSvg(document: Document, options?: RenderOptions): string {
  const ordered = shapeListInOrder(document);
  const shapes =
    options?.visibleShapeIds !== undefined
      ? ordered.filter((shape) => options.visibleShapeIds!.has(shape.id))
      : ordered;

  return shapes.map((shape) => renderSingleShapeSvg(document, shape, options)).join("");
}
