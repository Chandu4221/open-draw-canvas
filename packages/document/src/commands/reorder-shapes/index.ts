// ReorderShapes: reorders sibling shapes in z-order (map iteration order, R-016, R-018).
// Produces an exact lossless inverse using setOrder.
import type { ShapeId } from "@open-draw/contracts";
import type { Command, CommandResult } from "..";
import type { Document } from "../../document";
import { createDocumentFromMap } from "../../document";
import { DocumentError } from "../../errors";
import type { Shape } from "../../shape";
import { COMMANDS } from "../registry";

export const REORDER_OPERATIONS = {
  bringToFront: "bringToFront",
  sendToBack: "sendToBack",
  bringForward: "bringForward",
  sendBackward: "sendBackward",
  setOrder: "setOrder",
} as const;

export type ReorderOperation = (typeof REORDER_OPERATIONS)[keyof typeof REORDER_OPERATIONS];

export interface ReorderShapes {
  readonly type: (typeof COMMANDS)["reorderShapes"];
  readonly ids: readonly ShapeId[];
  readonly operation: ReorderOperation;
}

function areArraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function reorderSiblings(
  current: readonly ShapeId[],
  targetIds: readonly ShapeId[],
  operation: ReorderOperation,
): readonly ShapeId[] {
  if (operation === REORDER_OPERATIONS.setOrder) {
    if (areArraysEqual(current, targetIds)) {
      return current;
    }
    const currentSet = new Set(current);
    if (targetIds.length !== current.length || !targetIds.every((id) => currentSet.has(id))) {
      return current;
    }
    return targetIds;
  }

  const targetSet = new Set(targetIds);

  if (operation === REORDER_OPERATIONS.bringToFront) {
    const unselected = current.filter((id) => !targetSet.has(id));
    const selected = current.filter((id) => targetSet.has(id));
    return [...unselected, ...selected];
  }

  if (operation === REORDER_OPERATIONS.sendToBack) {
    const unselected = current.filter((id) => !targetSet.has(id));
    const selected = current.filter((id) => targetSet.has(id));
    return [...selected, ...unselected];
  }

  if (operation === REORDER_OPERATIONS.bringForward) {
    const next = [...current];
    for (let i = next.length - 2; i >= 0; i -= 1) {
      const currentId = next[i]!;
      const nextId = next[i + 1]!;
      if (targetSet.has(currentId) && !targetSet.has(nextId)) {
        next[i] = nextId;
        next[i + 1] = currentId;
      }
    }
    return next;
  }

  if (operation === REORDER_OPERATIONS.sendBackward) {
    const next = [...current];
    for (let i = 1; i < next.length; i += 1) {
      const currentId = next[i]!;
      const prevId = next[i - 1]!;
      if (targetSet.has(currentId) && !targetSet.has(prevId)) {
        next[i] = prevId;
        next[i - 1] = currentId;
      }
    }
    return next;
  }

  return current;
}

export function applyReorderShapesToMap(
  shapes: Record<ShapeId, Shape>,
  command: ReorderShapes,
): readonly Command[] {
  if (command.ids.length === 0) {
    return [];
  }

  for (const id of command.ids) {
    if (shapes[id] === undefined) {
      throw new DocumentError("shapeNotFound", `no shape with id: ${id}`);
    }
  }

  const parentSiblings = new Map<ShapeId, ShapeId[]>();
  for (const shape of Object.values(shapes)) {
    const list = parentSiblings.get(shape.parentId);
    if (list === undefined) {
      parentSiblings.set(shape.parentId, [shape.id]);
    } else {
      list.push(shape.id);
    }
  }

  const affectedParents = new Set<ShapeId>();
  for (const id of command.ids) {
    const parentId = shapes[id]!.parentId;
    affectedParents.add(parentId);
  }

  const nextOrderPerParent = new Map<ShapeId, readonly ShapeId[]>();
  const inverses: Command[] = [];

  for (const parentId of affectedParents) {
    const currentOrder = parentSiblings.get(parentId) ?? [];
    const targetInParent = command.ids.filter((id) => shapes[id]?.parentId === parentId);
    const nextOrder = reorderSiblings(currentOrder, targetInParent, command.operation);

    if (!areArraysEqual(currentOrder, nextOrder)) {
      nextOrderPerParent.set(parentId, nextOrder);
      inverses.push({
        type: COMMANDS.reorderShapes,
        ids: currentOrder,
        operation: REORDER_OPERATIONS.setOrder,
      });
    }
  }

  if (nextOrderPerParent.size === 0) {
    return [];
  }

  const parentPointers = new Map<ShapeId, number>();
  for (const parentId of nextOrderPerParent.keys()) {
    parentPointers.set(parentId, 0);
  }

  const nextShapesMap: Record<ShapeId, Shape> = {};
  for (const shape of Object.values(shapes)) {
    const reordered = nextOrderPerParent.get(shape.parentId);
    if (reordered !== undefined) {
      const idx = parentPointers.get(shape.parentId)!;
      const nextId = reordered[idx]!;
      parentPointers.set(shape.parentId, idx + 1);
      nextShapesMap[nextId] = shapes[nextId]!;
    } else {
      nextShapesMap[shape.id] = shape;
    }
  }

  for (const key of Object.keys(shapes)) {
    delete shapes[key as ShapeId];
  }
  Object.assign(shapes, nextShapesMap);

  return inverses;
}

export function applyReorderShapes(document: Document, command: ReorderShapes): CommandResult {
  const shapes: Record<ShapeId, Shape> = { ...document.shapes };
  const inverse = applyReorderShapesToMap(shapes, command);
  const nextDoc = createDocumentFromMap(shapes);
  return { document: nextDoc, inverse };
}
