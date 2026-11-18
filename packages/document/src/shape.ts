// The shape union and validating constructors (ADR-0002 D3–D7, ADR-0003 D1–D5).
// Invariants live in types; constructors validate at the boundary and internal
// code trusts the result (R-006, R-008).
import type {
  BoundingBox,
  CustomShapeKind,
  FillStyle,
  PluginId,
  Point,
  ShapeId,
  ShapeKind,
} from "@open-draw/contracts";
import { ROOT_ID, SHAPE_KINDS, SHAPE_KIND_VALUES, isRootId } from "@open-draw/contracts";
import { DocumentError } from "./errors";
import { parseColor, parseFillStyle, parseStrokeWidth } from "./style-validation";

// `pluginData`: opaque forward-compatibility namespace (R-044, ADR-0003 D4).
export interface ShapeMeta {
  readonly pluginData?: Readonly<Record<PluginId, unknown>>;
  readonly [key: string]: unknown;
}

export interface BaseShape {
  readonly id: ShapeId;
  readonly kind: ShapeKind;
  readonly parentId: ShapeId;
  readonly boundingBox: BoundingBox;
  readonly label?: string;
  readonly content?: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly fillStyle?: FillStyle;
  readonly meta: ShapeMeta;
}

export const BASE_SHAPE_KEYS = {
  id: "id",
  kind: "kind",
  parentId: "parentId",
  boundingBox: "boundingBox",
  label: "label",
  content: "content",
  fill: "fill",
  stroke: "stroke",
  strokeWidth: "strokeWidth",
  fillStyle: "fillStyle",
  meta: "meta",
} as const satisfies Record<keyof BaseShape, string>;

export const BASE_SHAPE_KEY_SET: ReadonlySet<string> = new Set(Object.values(BASE_SHAPE_KEYS));

export interface RectShape extends BaseShape {
  readonly kind: (typeof SHAPE_KINDS)["rect"];
}

export interface EllipseShape extends BaseShape {
  readonly kind: (typeof SHAPE_KINDS)["ellipse"];
}

export interface LineShape extends BaseShape {
  readonly kind: (typeof SHAPE_KINDS)["line"];
  readonly start: Point;
  readonly end: Point;
}

export interface PenPathShape extends BaseShape {
  readonly kind: (typeof SHAPE_KINDS)["penPath"];
  readonly points: readonly Point[];
}

export interface TextShape extends BaseShape {
  readonly kind: (typeof SHAPE_KINDS)["text"];
}

export interface GroupShape extends BaseShape {
  readonly kind: (typeof SHAPE_KINDS)["group"];
}

export interface CustomShape extends BaseShape {
  readonly kind: CustomShapeKind;
  readonly customData?: Readonly<Record<string, unknown>>;
}

export type BuiltinShape =
  RectShape | EllipseShape | LineShape | PenPathShape | TextShape | GroupShape;

export type Shape = BuiltinShape | CustomShape;

export function isCustomShape(shape: Shape): shape is CustomShape {
  return !SHAPE_KIND_VALUES.has(shape.kind);
}

export interface ShapeInit {
  readonly parentId?: ShapeId;
  readonly parent?: ShapeId;
  readonly label?: string;
  readonly content?: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly fillStyle?: FillStyle;
  readonly meta?: ShapeMeta;
}

const DEFAULT_META: ShapeMeta = {};

function baseInit(
  id: ShapeId,
  kind: ShapeKind,
  boundingBox: BoundingBox,
  init: ShapeInit,
): BaseShape {
  if (isRootId(id)) {
    throw new DocumentError("invalidShape", `a shape may not use the root id: ${id}`);
  }
  if (
    !Number.isFinite(boundingBox.x) ||
    !Number.isFinite(boundingBox.y) ||
    !Number.isFinite(boundingBox.width) ||
    !Number.isFinite(boundingBox.height) ||
    boundingBox.width <= 0 ||
    boundingBox.height <= 0
  ) {
    throw new DocumentError(
      "invalidShape",
      "boundingBox must have finite position and positive dimensions",
    );
  }
  let fill: string | undefined;
  if (init.fill !== undefined) {
    fill = parseColor(init.fill, "fill");
  }
  let stroke: string | undefined;
  if (init.stroke !== undefined) {
    stroke = parseColor(init.stroke, "stroke");
  }
  let strokeWidth: number | undefined;
  if (init.strokeWidth !== undefined) {
    strokeWidth = parseStrokeWidth(init.strokeWidth);
  }
  let fillStyle: FillStyle | undefined;
  if (init.fillStyle !== undefined) {
    fillStyle = parseFillStyle(init.fillStyle);
  }
  return {
    id,
    kind,
    parentId: init.parentId ?? init.parent ?? ROOT_ID,
    boundingBox,
    ...(init.label === undefined ? {} : { label: init.label }),
    ...(init.content === undefined ? {} : { content: init.content }),
    ...(fill === undefined ? {} : { fill }),
    ...(stroke === undefined ? {} : { stroke }),
    ...(strokeWidth === undefined ? {} : { strokeWidth }),
    ...(fillStyle === undefined ? {} : { fillStyle }),
    meta: init.meta ?? DEFAULT_META,
  };
}

export function createGroup(
  id: ShapeId,
  boundingBox: BoundingBox,
  init: ShapeInit = {},
): GroupShape {
  return Object.freeze({
    ...baseInit(id, SHAPE_KINDS.group, boundingBox, init),
    kind: SHAPE_KINDS.group,
  });
}

export function createRect(id: ShapeId, boundingBox: BoundingBox, init: ShapeInit = {}): RectShape {
  return Object.freeze({
    ...baseInit(id, SHAPE_KINDS.rect, boundingBox, init),
    kind: SHAPE_KINDS.rect,
  });
}

export function createEllipse(
  id: ShapeId,
  boundingBox: BoundingBox,
  init: ShapeInit = {},
): EllipseShape {
  return Object.freeze({
    ...baseInit(id, SHAPE_KINDS.ellipse, boundingBox, init),
    kind: SHAPE_KINDS.ellipse,
  });
}

export function createLine(
  id: ShapeId,
  boundingBox: BoundingBox,
  start: Point,
  end: Point,
  init: ShapeInit = {},
): LineShape {
  return Object.freeze({
    ...baseInit(id, SHAPE_KINDS.line, boundingBox, init),
    kind: SHAPE_KINDS.line,
    start: Object.freeze({ x: start.x, y: start.y }),
    end: Object.freeze({ x: end.x, y: end.y }),
  });
}

export function createPenPath(
  id: ShapeId,
  boundingBox: BoundingBox,
  points: readonly Point[],
  init: ShapeInit = {},
): PenPathShape {
  return Object.freeze({
    ...baseInit(id, SHAPE_KINDS.penPath, boundingBox, init),
    kind: SHAPE_KINDS.penPath,
    points: Object.freeze(points.map((p) => Object.freeze({ x: p.x, y: p.y }))),
  });
}

export function createText(id: ShapeId, boundingBox: BoundingBox, init: ShapeInit = {}): TextShape {
  return Object.freeze({
    ...baseInit(id, SHAPE_KINDS.text, boundingBox, {
      ...init,
      content: init.content ?? "TEXT",
    }),
    kind: SHAPE_KINDS.text,
  });
}

export function createCustomShape(
  id: ShapeId,
  kind: CustomShapeKind,
  boundingBox: BoundingBox,
  customData: Readonly<Record<string, unknown>> = {},
  init: ShapeInit = {},
): CustomShape {
  return Object.freeze({
    ...baseInit(id, kind, boundingBox, init),
    kind,
    customData: Object.freeze({ ...customData }),
  });
}
