// SetShapeBoundingBox: replaces one shape's bounding box (resize, ADR-0002
// D4, ADR-0003 D5). The inverse restores the previous box. Geometry only — render
// styles never alter semantics (R-021). Named per R-039: explicit over short.
// For point-carrying kinds (line, pen-path), points are proportionally scaled to
// preserve geometry within the new bounding box.
import {
  type BoundingBox,
  MAX_COORDINATE_BOUND,
  type Point,
  type ShapeId,
  SHAPE_KINDS,
} from "@open-draw/contracts";
import type { Command, CommandResult } from "..";
import type { Document } from "../../document";
import { createDocument } from "../../document";
import { DocumentError } from "../../errors";
import { isCustomShape, type LineShape, type PenPathShape, type Shape } from "../../shape";
import { COMMANDS } from "../registry";

export interface SetShapeBoundingBox {
  readonly type: (typeof COMMANDS)["setShapeBoundingBox"];
  readonly id: ShapeId;
  readonly boundingBox: BoundingBox;
  readonly pointsSnapshot?: {
    readonly start?: Point;
    readonly end?: Point;
    readonly points?: readonly Point[];
  };
}

export type ShapeScaleHook = (shape: Shape, prevBox: BoundingBox, nextBox: BoundingBox) => Shape;

export function applySetShapeBoundingBox(
  document: Document,
  command: SetShapeBoundingBox,
  scaleHook?: ShapeScaleHook,
): CommandResult {
  const shape = document.shapes[command.id];
  if (shape === undefined) {
    throw new DocumentError("shapeNotFound", `no shape with id: ${command.id}`);
  }
  if (
    !Number.isFinite(command.boundingBox.x) ||
    !Number.isFinite(command.boundingBox.y) ||
    !Number.isFinite(command.boundingBox.width) ||
    !Number.isFinite(command.boundingBox.height) ||
    command.boundingBox.width <= 0 ||
    command.boundingBox.height <= 0
  ) {
    throw new DocumentError(
      "invalidShape",
      "boundingBox must have finite position and positive dimensions",
    );
  }
  const previousBox = shape.boundingBox;
  const targetBox: BoundingBox = {
    x: Math.max(-MAX_COORDINATE_BOUND, Math.min(MAX_COORDINATE_BOUND, command.boundingBox.x)),
    y: Math.max(-MAX_COORDINATE_BOUND, Math.min(MAX_COORDINATE_BOUND, command.boundingBox.y)),
    width: Math.min(MAX_COORDINATE_BOUND, Math.max(1, command.boundingBox.width)),
    height: Math.min(MAX_COORDINATE_BOUND, Math.max(1, command.boundingBox.height)),
  };

  const previousSnapshot =
    shape.kind === SHAPE_KINDS.line
      ? { start: (shape as LineShape).start, end: (shape as LineShape).end }
      : shape.kind === SHAPE_KINDS.penPath
        ? { points: (shape as PenPathShape).points }
        : undefined;

  let nextShape: Shape;
  if (scaleHook !== undefined) {
    nextShape = scaleHook(shape, previousBox, targetBox);
  } else if (!isCustomShape(shape)) {
    switch (shape.kind) {
      case SHAPE_KINDS.line: {
        if (
          command.pointsSnapshot?.start !== undefined &&
          command.pointsSnapshot?.end !== undefined
        ) {
          nextShape = {
            ...shape,
            boundingBox: targetBox,
            start: command.pointsSnapshot.start,
            end: command.pointsSnapshot.end,
          };
        } else {
          const scaleX = previousBox.width === 0 ? 1 : targetBox.width / previousBox.width;
          const scaleY = previousBox.height === 0 ? 1 : targetBox.height / previousBox.height;
          nextShape = {
            ...shape,
            boundingBox: targetBox,
            start: { x: shape.start.x * scaleX, y: shape.start.y * scaleY },
            end: { x: shape.end.x * scaleX, y: shape.end.y * scaleY },
          };
        }
        break;
      }
      case SHAPE_KINDS.penPath: {
        if (command.pointsSnapshot?.points !== undefined) {
          nextShape = {
            ...shape,
            boundingBox: targetBox,
            points: command.pointsSnapshot.points,
          };
        } else {
          const scaleX = previousBox.width === 0 ? 1 : targetBox.width / previousBox.width;
          const scaleY = previousBox.height === 0 ? 1 : targetBox.height / previousBox.height;
          nextShape = {
            ...shape,
            boundingBox: targetBox,
            points: shape.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })),
          };
        }
        break;
      }
      default: {
        nextShape = { ...shape, boundingBox: targetBox };
        break;
      }
    }
  } else {
    nextShape = { ...shape, boundingBox: targetBox };
  }

  // Replace in place, preserving map iteration order — the same z-stack rule
  // as MoveShapes (review round 2, Finding 3: filter-and-append would pop
  // the resized shape to the top of the sibling stack).
  const shapes = Object.values(document.shapes).map((entry): Shape =>
    entry.id === command.id ? nextShape : entry,
  );
  const next = createDocument(shapes);
  const inverse: readonly Command[] = [
    {
      type: COMMANDS.setShapeBoundingBox,
      id: command.id,
      boundingBox: previousBox,
      ...(previousSnapshot !== undefined ? { pointsSnapshot: previousSnapshot } : {}),
    },
  ];
  return { document: next, inverse };
}
