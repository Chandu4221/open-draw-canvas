// Incremental update mechanics for 2D STR R-Tree (R-002, R-008, R-010, R-016, ADR-0011).
// Provides sub-millisecond leaf mutation and ancestor box updates without full tree rebuilds.
import { SHAPE_KINDS, type BoundingBox, type ShapeId } from "@open-draw/contracts";
import { absoluteBoundingBox, isCustomShape, subtreeOf, type Document } from "@open-draw/document";
import {
  computeEnclosingFromItems,
  computeEnclosingFromNodes,
  spatialBoxesIntersect,
  toSpatialBox,
  type SpatialBoundingBox,
  type SpatialIndex,
  type SpatialIndexItem,
  type SpatialNode,
} from "./spatial-index";

export const DEFAULT_MAX_INCREMENTAL_BATCH = 64;

export interface SpatialIndexUpdateItem {
  readonly id: ShapeId;
  readonly box: BoundingBox;
  readonly zIndex?: number | undefined;
}

function updateNodeItem(
  node: SpatialNode,
  updatedItem: SpatialIndexUpdateItem,
  prevSpatialBox?: SpatialBoundingBox,
): { readonly node: SpatialNode; readonly updated: boolean } {
  if (node.isLeaf) {
    const items = node.items;
    let foundIndex = -1;
    for (let i = 0; i < items.length; i += 1) {
      if (items[i]!.id === updatedItem.id) {
        foundIndex = i;
        break;
      }
    }
    if (foundIndex === -1) {
      return { node, updated: false };
    }

    const existing = items[foundIndex]!;
    const nextItems = [...items];
    nextItems[foundIndex] = {
      id: updatedItem.id,
      box: updatedItem.box,
      zIndex:
        updatedItem.zIndex !== undefined && updatedItem.zIndex >= 0
          ? updatedItem.zIndex
          : existing.zIndex,
    };
    const nextBox = computeEnclosingFromItems(nextItems);
    return {
      node: {
        isLeaf: true,
        box: nextBox,
        items: nextItems,
      },
      updated: true,
    };
  }

  function spatialBoxEncloses(parent: SpatialBoundingBox, child: SpatialBoundingBox): boolean {
    return (
      parent.minX <= child.minX &&
      parent.maxX >= child.maxX &&
      parent.minY <= child.minY &&
      parent.maxY >= child.maxY
    );
  }

  // Internal node: search children
  const children = node.children;
  if (prevSpatialBox !== undefined) {
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      if (spatialBoxEncloses(child.box, prevSpatialBox)) {
        const res = updateNodeItem(child, updatedItem, prevSpatialBox);
        if (res.updated) {
          const nextChildren = [...children];
          nextChildren[i] = res.node;
          return {
            node: {
              isLeaf: false,
              box: computeEnclosingFromNodes(nextChildren),
              children: nextChildren,
            },
            updated: true,
          };
        }
      }
    }
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      if (
        !spatialBoxEncloses(child.box, prevSpatialBox) &&
        spatialBoxesIntersect(child.box, prevSpatialBox)
      ) {
        const res = updateNodeItem(child, updatedItem, prevSpatialBox);
        if (res.updated) {
          const nextChildren = [...children];
          nextChildren[i] = res.node;
          return {
            node: {
              isLeaf: false,
              box: computeEnclosingFromNodes(nextChildren),
              children: nextChildren,
            },
            updated: true,
          };
        }
      }
    }
  }

  // Fallback: check remaining children if not found or prevSpatialBox not provided
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]!;
    if (prevSpatialBox !== undefined && spatialBoxesIntersect(child.box, prevSpatialBox)) {
      continue;
    }
    const res = updateNodeItem(child, updatedItem, prevSpatialBox);
    if (res.updated) {
      const nextChildren = [...children];
      nextChildren[i] = res.node;
      return {
        node: {
          isLeaf: false,
          box: computeEnclosingFromNodes(nextChildren),
          children: nextChildren,
        },
        updated: true,
      };
    }
  }

  return { node, updated: false };
}

/**
 * Updates a single item's bounding box and preserves its z-index in the spatial index tree.
 * Recomputes enclosing boxes on the affected path up to root in O(log N) time.
 */
export function updateSpatialIndexItem(
  index: SpatialIndex,
  updatedItem: SpatialIndexItem | SpatialIndexUpdateItem,
  previousBox?: BoundingBox,
): SpatialIndex | null {
  if (index.root === null) return null;
  const prevSpatialBox = previousBox ? toSpatialBox(previousBox) : undefined;
  const result = updateNodeItem(index.root, updatedItem, prevSpatialBox);
  if (!result.updated) return null;
  return {
    root: result.node,
    count: index.count,
  };
}

/**
 * Compares two documents to find if changes are purely incremental bounding box / position updates.
 * Returns the list of affected shape IDs (including children if containers moved), or null if a full rebuild is required.
 */
export function findIncrementalSpatialChanges(
  prevDoc: Document,
  nextDoc: Document,
  maxBatch = DEFAULT_MAX_INCREMENTAL_BATCH,
): readonly ShapeId[] | null {
  const prevShapes = prevDoc.shapes;
  const nextShapes = nextDoc.shapes;

  const prevKeys = Object.keys(prevShapes);
  const nextKeys = Object.keys(nextShapes);
  if (prevKeys.length !== nextKeys.length) return null;
  // Sibling stacking order is derived from map insertion order (ADR-0002 D6).
  // Any key order divergence represents a z-order permutation requiring full rebuild.
  for (let i = 0; i < prevKeys.length; i += 1) {
    if (prevKeys[i] !== nextKeys[i]) return null;
  }

  const directlyChanged: ShapeId[] = [];
  for (let i = 0; i < prevKeys.length; i += 1) {
    const id = prevKeys[i] as ShapeId;
    const sNext = nextShapes[id]!;
    const sPrev = prevShapes[id]!;
    if (sPrev === sNext) continue;
    if (sPrev.parentId !== sNext.parentId) return null;

    const bPrev = sPrev.boundingBox;
    const bNext = sNext.boundingBox;
    if (
      bPrev.x !== bNext.x ||
      bPrev.y !== bNext.y ||
      bPrev.width !== bNext.width ||
      bPrev.height !== bNext.height
    ) {
      directlyChanged.push(id);
      if (directlyChanged.length > maxBatch) {
        return null;
      }
    }
  }

  if (directlyChanged.length === 0) return [];

  // Expand containers or custom shapes to include descendants
  const allAffected = new Set<ShapeId>();
  for (let i = 0; i < directlyChanged.length; i += 1) {
    const id = directlyChanged[i]!;
    allAffected.add(id);
    const shape = nextShapes[id]!;
    const mightHaveChildren =
      shape.kind === SHAPE_KINDS.group ||
      shape.kind === SHAPE_KINDS.rect ||
      shape.meta.isContainer === true ||
      shape.meta.container === true ||
      isCustomShape(shape);
    if (mightHaveChildren) {
      const subtree = subtreeOf(nextDoc, id);
      for (let s = 0; s < subtree.length; s += 1) {
        allAffected.add(subtree[s]!.id);
        if (allAffected.size > maxBatch) {
          return null;
        }
      }
    }
  }

  return Array.from(allAffected);
}

/**
 * Incrementally applies bounding box updates to a cached SpatialIndex from document state.
 */
export function updateSpatialIndexFromDocument(
  index: SpatialIndex,
  prevDoc: Document,
  nextDoc: Document,
  affectedShapeIds: readonly ShapeId[],
): SpatialIndex | null {
  let currentIndex = index;
  for (let i = 0; i < affectedShapeIds.length; i += 1) {
    const id = affectedShapeIds[i]!;
    const nextShape = nextDoc.shapes[id];
    const prevShape = prevDoc.shapes[id];
    if (nextShape === undefined || prevShape === undefined) return null;

    const nextAbsBox = absoluteBoundingBox(nextDoc, nextShape);
    const prevAbsBox = absoluteBoundingBox(prevDoc, prevShape);

    const nextIndex = updateSpatialIndexItem(
      currentIndex,
      {
        id,
        box: nextAbsBox,
      },
      prevAbsBox,
    );
    if (nextIndex === null) {
      return null;
    }
    currentIndex = nextIndex;
  }
  return currentIndex;
}
