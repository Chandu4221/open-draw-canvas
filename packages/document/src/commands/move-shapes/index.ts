// MoveShapes: translates shapes by a parent-local delta (ADR-0002 D4 —
// parent-local coordinates). One gesture = one command batch (R-018). The
// inverse is the same batch negated — no snapshots (R-008).
import { MAX_COORDINATE_BOUND, type ShapeId } from "@open-draw/contracts";
import type { Command, CommandResult } from "..";
import type { Document } from "../../document";
import { createDocument } from "../../document";
import { DocumentError } from "../../errors";
import type { Shape } from "../../shape";
import { COMMANDS } from "../registry";

export interface MoveShapes {
  readonly type: (typeof COMMANDS)["moveShapes"];
  readonly ids: readonly ShapeId[];
  readonly dx: number;
  readonly dy: number;
}

export function applyMoveShapes(document: Document, command: MoveShapes): CommandResult {
  if (!Number.isFinite(command.dx) || !Number.isFinite(command.dy)) {
    throw new DocumentError("invalidCommand", "dx and dy must be finite numbers");
  }
  for (const id of command.ids) {
    if (document.shapes[id] === undefined) {
      throw new DocumentError("shapeNotFound", `no shape with id: ${id}`);
    }
  }
  // Replace in place, preserving map iteration order — rebuilding the map as
  // [others, moved] would pop moved shapes to the top of the z-stack
  // (review finding: sibling order IS map order).
  const movedIds = new Set<ShapeId>(command.ids);
  let allExactDeltasMatch = true;
  const shapes = Object.values(document.shapes).map((shape): Shape => {
    if (!movedIds.has(shape.id)) return shape;
    const newX = Math.max(
      -MAX_COORDINATE_BOUND,
      Math.min(MAX_COORDINATE_BOUND, shape.boundingBox.x + command.dx),
    );
    const newY = Math.max(
      -MAX_COORDINATE_BOUND,
      Math.min(MAX_COORDINATE_BOUND, shape.boundingBox.y + command.dy),
    );
    if (newX - shape.boundingBox.x !== command.dx || newY - shape.boundingBox.y !== command.dy) {
      allExactDeltasMatch = false;
    }
    return {
      ...shape,
      boundingBox: {
        ...shape.boundingBox,
        x: newX,
        y: newY,
      },
    };
  });
  const next = createDocument(shapes);
  const inverse: readonly Command[] = allExactDeltasMatch
    ? [{ type: COMMANDS.moveShapes, ids: command.ids, dx: -command.dx, dy: -command.dy }]
    : command.ids.map((id) => {
        const orig = document.shapes[id]!;
        const moved = next.shapes[id]!;
        return {
          type: COMMANDS.moveShapes,
          ids: [id],
          dx: -(moved.boundingBox.x - orig.boundingBox.x),
          dy: -(moved.boundingBox.y - orig.boundingBox.y),
        };
      });
  return { document: next, inverse };
}
