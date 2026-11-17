// Gesture commit logic for standalone editor (R-004, R-008, R-018).
// Translates pointer completion into typed document commands.
import type { BoundingBox, Point, ShapeId } from "@open-draw/contracts";
import {
  CAPABILITIES,
  isRootId,
  MAX_COORDINATE_BOUND,
  MAX_PEN_PATH_POINTS,
  ROOT_ID,
} from "@open-draw/contracts";
import type { SnapGuide } from "./snap-solver";
import {
  absoluteBoundingBox,
  COMMANDS,
  computeReparentBoundingBox,
  createEllipse,
  createLine,
  createPenPath,
  createRect,
  createText,
  pickDropTarget,
  pruneSelectedDescendants,
  type Command,
  type Document,
  type EllipseShape,
  type RectShape,
} from "@open-draw/document";
import { deriveLineBoundingBox, derivePenPathBoundingBox } from "@open-draw/shapes";
import type { CanvasController } from "./create-canvas";
import type { HandleId } from "./handles";
import { normalizeBox, resizeBox } from "./geometry";
import { TOOLS, type ToolId } from "./tools";

export const DEFAULT_TEXT_SHAPE_DIMENSIONS = { width: 100, height: 32 } as const;

export type ShapeIdGenerator = (doc?: Document) => ShapeId;

export interface ShapeIdSequence {
  readonly nextShapeId: (doc?: Document) => ShapeId;
  readonly seed: (doc: Document) => void;
}

function seedFromInstance(instanceSeed?: number | string): number {
  if (typeof instanceSeed === "number" && Number.isFinite(instanceSeed)) {
    return Math.abs(Math.floor(instanceSeed)) % 0x1000;
  }
  if (typeof instanceSeed === "string" && instanceSeed.length > 0) {
    let hash = 0;
    for (let i = 0; i < instanceSeed.length; i++) {
      hash = (hash * 31 + instanceSeed.charCodeAt(i)) >>> 0;
    }
    return hash % 0x1000 || 1;
  }
  return 0;
}

export function createShapeIdGenerator(
  initialDoc?: Document,
  instanceSeed?: number | string,
): ShapeIdSequence {
  let seq = 0x7a00 + seedFromInstance(instanceSeed) * 0x1000;
  const seed = (doc: Document): void => {
    for (const shapeId of Object.keys(doc.shapes)) {
      const match = /^s-([0-9a-fA-F]+)$/.exec(shapeId);
      if (match !== null && match[1] !== undefined && match[1].length <= 12) {
        const val = parseInt(match[1], 16);
        if (Number.isFinite(val) && val > seq && val < Number.MAX_SAFE_INTEGER - 10000) {
          seq = val;
        }
      }
    }
  };
  if (initialDoc !== undefined) seed(initialDoc);
  const nextShapeId = (doc?: Document): ShapeId => {
    seq += 1;
    let id = `s-${seq.toString(16)}` as ShapeId;
    if (doc !== undefined) {
      while (doc.shapes[id] !== undefined) {
        seq += 1;
        id = `s-${seq.toString(16)}` as ShapeId;
      }
    }
    return id;
  };
  return { nextShapeId, seed };
}

export interface ActiveGesture {
  readonly pointerId: number;
  readonly kind: string;
  readonly startScreen: Point;
  readonly startWorld: Point;
  readonly shapeIds: readonly ShapeId[];
  readonly handleId: HandleId | null;
  readonly originalBox: BoundingBox | null;
  readonly parentHit: ShapeId | null;
  readonly targetShapeId: ShapeId | null;
  readonly points: readonly Point[];
  readonly snapGuides?: readonly SnapGuide[] | undefined;
  readonly snappedWorld?: Point | undefined;
}

export type NestingMode = "off" | "containers-only";

export function commitDragGesture(
  doc: Document,
  gesture: ActiveGesture,
  world: Point,
  execute: (commands: readonly Command[]) => void,
  nestingMode: NestingMode = "containers-only",
  hasContainerCapability?: (kind: string) => boolean,
): void {
  const dx = world.x - gesture.startWorld.x;
  const dy = world.y - gesture.startWorld.y;
  if (dx === 0 && dy === 0) {
    return;
  }
  const topLevelShapeIds = pruneSelectedDescendants(doc, gesture.shapeIds);
  const commands: Command[] = [];
  const sameParentMoves: ShapeId[] = [];

  for (const id of topLevelShapeIds) {
    const shape = doc.shapes[id];
    if (shape === undefined) continue;

    const currentWorldBox = absoluteBoundingBox(doc, shape);
    const droppedWorldBox: BoundingBox = {
      x: currentWorldBox.x + dx,
      y: currentWorldBox.y + dy,
      width: currentWorldBox.width,
      height: currentWorldBox.height,
    };
    const center: Point = {
      x: droppedWorldBox.x + droppedWorldBox.width / 2,
      y: droppedWorldBox.y + droppedWorldBox.height / 2,
    };
    const targetParentId =
      nestingMode === "containers-only"
        ? pickDropTarget(doc, center, topLevelShapeIds, hasContainerCapability)
        : shape.parentId;

    if (targetParentId !== shape.parentId) {
      const newBoundingBox = computeReparentBoundingBox(
        doc,
        shape,
        targetParentId,
        droppedWorldBox,
      );
      commands.push({
        type: COMMANDS.reparentShape,
        id,
        parentId: targetParentId,
        boundingBox: newBoundingBox,
      });
    } else {
      sameParentMoves.push(id);
    }
  }

  if (sameParentMoves.length > 0) {
    commands.push({
      type: COMMANDS.moveShapes,
      ids: sameParentMoves,
      dx,
      dy,
    });
  }

  if (commands.length > 0) {
    execute(commands);
  }
}

export function commitResizeGesture(
  doc: Document,
  canvas: CanvasController,
  gesture: ActiveGesture,
  world: Point,
  execute: (commands: readonly Command[]) => void,
): void {
  if (gesture.handleId === null || gesture.originalBox === null) return;
  const resized = resizeBox(gesture.originalBox, gesture.handleId, world);
  const orig = gesture.originalBox;
  if (
    orig.x === resized.x &&
    orig.y === resized.y &&
    orig.width === resized.width &&
    orig.height === resized.height
  ) {
    return;
  }
  const ids =
    gesture.shapeIds.length > 0
      ? gesture.shapeIds
      : gesture.targetShapeId !== null
        ? [gesture.targetShapeId]
        : canvas.getSelectedIds();
  if (ids.length === 0) return;

  const scaleX = orig.width > 0 ? resized.width / orig.width : 1;
  const scaleY = orig.height > 0 ? resized.height / orig.height : 1;
  const topLevelIds = pruneSelectedDescendants(doc, ids);
  const commands: Command[] = [];

  for (const id of topLevelIds) {
    const shape = doc.shapes[id];
    if (shape === undefined) continue;
    const absBox = absoluteBoundingBox(doc, shape);
    const parentShape = doc.shapes[shape.parentId];
    const parentOrigin =
      parentShape === undefined ? { x: 0, y: 0 } : absoluteBoundingBox(doc, parentShape);
    const newWorldX = resized.x + (absBox.x - orig.x) * scaleX;
    const newWorldY = resized.y + (absBox.y - orig.y) * scaleY;
    commands.push({
      type: COMMANDS.setShapeBoundingBox,
      id,
      boundingBox: {
        x: newWorldX - parentOrigin.x,
        y: newWorldY - parentOrigin.y,
        width: Math.max(1, absBox.width * scaleX),
        height: Math.max(1, absBox.height * scaleY),
      },
    });
  }

  if (commands.length > 0) execute(commands);
}

function clampCoord(n: number): number {
  return Math.max(-MAX_COORDINATE_BOUND, Math.min(MAX_COORDINATE_BOUND, n));
}

function clampBox(b: BoundingBox): BoundingBox {
  const x = clampCoord(b.x);
  const y = clampCoord(b.y);
  return {
    x,
    y,
    width: Math.max(1, Math.min(MAX_COORDINATE_BOUND, b.width)),
    height: Math.max(1, Math.min(MAX_COORDINATE_BOUND, b.height)),
  };
}

export function downsamplePoints(points: readonly Point[], maxPoints: number): Point[] {
  if (points.length <= maxPoints) return [...points];
  const result: Point[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const index = Math.min(Math.round(i * step), points.length - 1);
    result.push(points[index]!);
  }
  return result;
}

export function commitDrawGesture(
  doc: Document,
  canvas: CanvasController,
  gesture: ActiveGesture,
  world: Point,
  tool: ToolId,
  execute: (commands: readonly Command[]) => void,
  nestingMode: NestingMode = "containers-only",
  idGen: ShapeIdGenerator = (doc?: Document) => createShapeIdGenerator(doc).nextShapeId(doc),
): void {
  const startWorld = {
    x: clampCoord(gesture.startWorld.x),
    y: clampCoord(gesture.startWorld.y),
  };
  const worldPoint = {
    x: clampCoord(world.x),
    y: clampCoord(world.y),
  };
  const targetParentId =
    nestingMode === "containers-only"
      ? pickDropTarget(doc, startWorld, [], (kind) =>
          canvas.hasCapability(kind, CAPABILITIES.container),
        )
      : ROOT_ID;
  const targetParent = !isRootId(targetParentId) ? doc.shapes[targetParentId] : undefined;
  const parentBox =
    targetParent !== undefined ? absoluteBoundingBox(doc, targetParent) : { x: 0, y: 0 };

  if (tool === TOOLS.drawLine) {
    const { boundingBox, start, end } = deriveLineBoundingBox(startWorld, worldPoint);
    const line = createLine(
      idGen(doc),
      clampBox({
        x: boundingBox.x - parentBox.x,
        y: boundingBox.y - parentBox.y,
        width: boundingBox.width,
        height: boundingBox.height,
      }),
      { x: clampCoord(start.x), y: clampCoord(start.y) },
      { x: clampCoord(end.x), y: clampCoord(end.y) },
      { parent: targetParentId },
    );
    execute([{ type: COMMANDS.createShape, shape: line }]);
    canvas.select(line.id);
    return;
  }

  if (tool === TOOLS.drawPenPath) {
    let allPoints = gesture.points.length > 0 ? gesture.points : [startWorld, worldPoint];
    if (allPoints.length > MAX_PEN_PATH_POINTS) {
      allPoints = downsamplePoints(allPoints, MAX_PEN_PATH_POINTS);
    }
    const clampedPoints = allPoints.map((p) => ({
      x: clampCoord(p.x),
      y: clampCoord(p.y),
    }));
    const { boundingBox, points } = derivePenPathBoundingBox(clampedPoints);
    const pen = createPenPath(
      idGen(doc),
      clampBox({
        x: boundingBox.x - parentBox.x,
        y: boundingBox.y - parentBox.y,
        width: boundingBox.width,
        height: boundingBox.height,
      }),
      points.map((p) => ({ x: clampCoord(p.x), y: clampCoord(p.y) })),
      { parent: targetParentId },
    );
    execute([{ type: COMMANDS.createShape, shape: pen }]);
    canvas.select(pen.id);
    return;
  }

  if (tool === TOOLS.drawText) {
    const textShape = createText(
      idGen(doc),
      clampBox({
        x: startWorld.x - parentBox.x,
        y: startWorld.y - parentBox.y,
        width: DEFAULT_TEXT_SHAPE_DIMENSIONS.width,
        height: DEFAULT_TEXT_SHAPE_DIMENSIONS.height,
      }),
      { parentId: targetParentId },
    );
    execute([{ type: COMMANDS.createShape, shape: textShape }]);
    canvas.select(textShape.id);
    return;
  }

  const box = normalizeBox(startWorld, worldPoint);
  const localBox: BoundingBox = clampBox({
    x: box.x - parentBox.x,
    y: box.y - parentBox.y,
    width: box.width,
    height: box.height,
  });
  const shape: RectShape | EllipseShape =
    tool === TOOLS.drawEllipse
      ? createEllipse(idGen(doc), localBox, { parent: targetParentId })
      : createRect(idGen(doc), localBox, { parent: targetParentId });

  execute([{ type: COMMANDS.createShape, shape }]);
  canvas.select(shape.id);
}
