// Pure spatial relationship, alignment, relative geometry, and z-index extraction (R-008, R-016).
// Zero mutations, zero external dependencies (R-002, R-021, ADR-0002 D4, ADR-0010).
import {
  isRootId,
  SPATIAL_SCOPES,
  type BoundingBox,
  type RelativeParentGeometry,
  type ShapeId,
  type SpatialAlignments,
  type SpatialExtractionOptions,
  type SpatialRelationships,
  type ZIndexMetrics,
} from "@open-draw/contracts";
import {
  absoluteBoundingBox,
  ancestorsOf,
  childrenOf,
  shapeListInOrder,
  type Document,
  type Shape,
} from "@open-draw/document";

const DEFAULT_ALIGNMENT_TOLERANCE_PX = 2;
const DEFAULT_OVERLAP_MIN_IOA = 0.2;
const DEFAULT_CONTAINMENT_MIN_IOA = 0.95;

/**
 * Computes Intersection over Area (IoA): Area(A ∩ B) / Area(A).
 * Pinned to 4 decimal places.
 */
export function computeBoxIoa(boxA: BoundingBox, boxB: BoundingBox): number {
  const areaA = boxA.width * boxA.height;
  if (areaA <= 0) {
    return 0;
  }
  const xOverlap = Math.max(
    0,
    Math.min(boxA.x + boxA.width, boxB.x + boxB.width) - Math.max(boxA.x, boxB.x),
  );
  const yOverlap = Math.max(
    0,
    Math.min(boxA.y + boxA.height, boxB.y + boxB.height) - Math.max(boxA.y, boxB.y),
  );
  const intersectionArea = xOverlap * yOverlap;
  return Math.round((intersectionArea / areaA) * 10000) / 10000;
}

/**
 * Derives exact z-index metrics (siblingIndex, tree depth, and frontToBack pre-order traversal index).
 */
export function deriveZIndexMetrics(doc: Document, shapeId: ShapeId): ZIndexMetrics {
  const shape = doc.shapes[shapeId];
  if (shape === undefined) {
    throw new Error(`Shape not found: ${shapeId}`);
  }
  const siblings = childrenOf(doc, shape.parentId);
  const siblingIndex = siblings.findIndex((s) => s.id === shapeId);
  const depth = ancestorsOf(doc, shape).length + 1;
  const ordered = shapeListInOrder(doc);
  const frontToBack = ordered.findIndex((s) => s.id === shapeId) + 1;

  return {
    siblingIndex: siblingIndex >= 0 ? siblingIndex : 0,
    depth,
    frontToBack: frontToBack > 0 ? frontToBack : 1,
  };
}

/**
 * Derives parent-relative geometry ratios (widthRatio, heightRatio, xRatio, yRatio).
 * Returns null if the shape is an immediate child of ROOT_ID.
 */
export function deriveRelativeParentGeometry(
  doc: Document,
  shapeId: ShapeId,
): RelativeParentGeometry | null {
  const shape = doc.shapes[shapeId];
  if (shape === undefined || isRootId(shape.parentId)) {
    return null;
  }
  const parent = doc.shapes[shape.parentId];
  if (parent === undefined || parent.boundingBox.width <= 0 || parent.boundingBox.height <= 0) {
    return null;
  }

  const pWidth = parent.boundingBox.width;
  const pHeight = parent.boundingBox.height;

  return {
    widthRatio: Math.round((shape.boundingBox.width / pWidth) * 10000) / 10000,
    heightRatio: Math.round((shape.boundingBox.height / pHeight) * 10000) / 10000,
    xRatio: Math.round((shape.boundingBox.x / pWidth) * 10000) / 10000,
    yRatio: Math.round((shape.boundingBox.y / pHeight) * 10000) / 10000,
  };
}

function evaluateAlignments(
  targetBox: BoundingBox,
  candidateBox: BoundingBox,
  candidateId: ShapeId,
  tolerance: number,
  aligns: {
    left: ShapeId[];
    right: ShapeId[];
    top: ShapeId[];
    bottom: ShapeId[];
    centerX: ShapeId[];
    centerY: ShapeId[];
  },
): void {
  if (Math.abs(targetBox.x - candidateBox.x) <= tolerance) {
    aligns.left.push(candidateId);
  }
  if (
    Math.abs(targetBox.x + targetBox.width - (candidateBox.x + candidateBox.width)) <= tolerance
  ) {
    aligns.right.push(candidateId);
  }
  if (Math.abs(targetBox.y - candidateBox.y) <= tolerance) {
    aligns.top.push(candidateId);
  }
  if (
    Math.abs(targetBox.y + targetBox.height - (candidateBox.y + candidateBox.height)) <= tolerance
  ) {
    aligns.bottom.push(candidateId);
  }
  const targetCenterX = targetBox.x + targetBox.width / 2;
  const candidateCenterX = candidateBox.x + candidateBox.width / 2;
  if (Math.abs(targetCenterX - candidateCenterX) <= tolerance) {
    aligns.centerX.push(candidateId);
  }
  const targetCenterY = targetBox.y + targetBox.height / 2;
  const candidateCenterY = candidateBox.y + candidateBox.height / 2;
  if (Math.abs(targetCenterY - candidateCenterY) <= tolerance) {
    aligns.centerY.push(candidateId);
  }
}

/**
 * Derives comprehensive spatial relationships and alignments for a shape.
 */
export function deriveSpatialRelationships(
  doc: Document,
  shapeId: ShapeId,
  options?: SpatialExtractionOptions,
): SpatialRelationships {
  const shape = doc.shapes[shapeId];
  if (shape === undefined) {
    throw new Error(`Shape not found: ${shapeId}`);
  }

  const scope = options?.scope ?? SPATIAL_SCOPES.siblings;
  const tolerance = options?.alignmentTolerance ?? DEFAULT_ALIGNMENT_TOLERANCE_PX;
  const overlapMinIoa = options?.overlapMinIoa ?? DEFAULT_OVERLAP_MIN_IOA;
  const containmentMinIoa = options?.containmentMinIoa ?? DEFAULT_CONTAINMENT_MIN_IOA;

  const targetWorldBox = absoluteBoundingBox(doc, shape);
  const containedIn = isRootId(shape.parentId) ? null : shape.parentId;
  const contains = childrenOf(doc, shapeId).map((s) => s.id);

  const leftOf: ShapeId[] = [];
  const rightOf: ShapeId[] = [];
  const above: ShapeId[] = [];
  const below: ShapeId[] = [];
  const overlaps: ShapeId[] = [];

  const alignsLists = {
    left: [] as ShapeId[],
    right: [] as ShapeId[],
    top: [] as ShapeId[],
    bottom: [] as ShapeId[],
    centerX: [] as ShapeId[],
    centerY: [] as ShapeId[],
  };

  const parent = isRootId(shape.parentId) ? undefined : doc.shapes[shape.parentId];
  if (parent !== undefined) {
    const parentWorldBox = absoluteBoundingBox(doc, parent);
    const isProtruding =
      shape.boundingBox.x < 0 ||
      shape.boundingBox.y < 0 ||
      shape.boundingBox.x + shape.boundingBox.width > parent.boundingBox.width ||
      shape.boundingBox.y + shape.boundingBox.height > parent.boundingBox.height;

    const ioa = computeBoxIoa(targetWorldBox, parentWorldBox);
    if (isProtruding && ioa >= overlapMinIoa) {
      overlaps.push(parent.id);
    }

    // Check center alignments relative to parent
    const targetCenterX = targetWorldBox.x + targetWorldBox.width / 2;
    const parentCenterX = parentWorldBox.x + parentWorldBox.width / 2;
    if (Math.abs(targetCenterX - parentCenterX) <= tolerance) {
      alignsLists.centerX.push(parent.id);
    }
    const targetCenterY = targetWorldBox.y + targetWorldBox.height / 2;
    const parentCenterY = parentWorldBox.y + parentWorldBox.height / 2;
    if (Math.abs(targetCenterY - parentCenterY) <= tolerance) {
      alignsLists.centerY.push(parent.id);
    }
  }

  const candidates: Shape[] =
    scope === SPATIAL_SCOPES.all
      ? Object.values(doc.shapes).filter((s) => s.id !== shapeId && s.id !== shape.parentId)
      : childrenOf(doc, shape.parentId).filter((s) => s.id !== shapeId);

  for (const candidate of candidates) {
    const candidateWorldBox = absoluteBoundingBox(doc, candidate);

    if (targetWorldBox.x + targetWorldBox.width <= candidateWorldBox.x + tolerance) {
      leftOf.push(candidate.id);
    }
    if (targetWorldBox.x >= candidateWorldBox.x + candidateWorldBox.width - tolerance) {
      rightOf.push(candidate.id);
    }
    if (targetWorldBox.y + targetWorldBox.height <= candidateWorldBox.y + tolerance) {
      above.push(candidate.id);
    }
    if (targetWorldBox.y >= candidateWorldBox.y + candidateWorldBox.height - tolerance) {
      below.push(candidate.id);
    }

    evaluateAlignments(targetWorldBox, candidateWorldBox, candidate.id, tolerance, alignsLists);

    const ioa = computeBoxIoa(targetWorldBox, candidateWorldBox);
    if (ioa >= overlapMinIoa && ioa < containmentMinIoa) {
      overlaps.push(candidate.id);
    }
  }

  const aligns: SpatialAlignments = {
    ...(alignsLists.left.length > 0 ? { left: alignsLists.left } : {}),
    ...(alignsLists.right.length > 0 ? { right: alignsLists.right } : {}),
    ...(alignsLists.top.length > 0 ? { top: alignsLists.top } : {}),
    ...(alignsLists.bottom.length > 0 ? { bottom: alignsLists.bottom } : {}),
    ...(alignsLists.centerX.length > 0 ? { centerX: alignsLists.centerX } : {}),
    ...(alignsLists.centerY.length > 0 ? { centerY: alignsLists.centerY } : {}),
  };

  return {
    containedIn,
    contains,
    leftOf,
    rightOf,
    above,
    below,
    aligns,
    overlaps,
  };
}

export interface DocumentSpatialEntry {
  readonly worldBox: BoundingBox;
  readonly z: ZIndexMetrics;
  readonly relativeParent: RelativeParentGeometry | null;
  readonly spatial: SpatialRelationships;
}

/**
 * Derives spatial relationships, relative parent geometry, and z-index metrics
 * for every shape in the document in a single pass.
 */
export function deriveDocumentSpatialMap(
  doc: Document,
  options?: SpatialExtractionOptions,
): ReadonlyMap<ShapeId, DocumentSpatialEntry> {
  const map = new Map<ShapeId, DocumentSpatialEntry>();
  for (const shape of Object.values(doc.shapes)) {
    const worldBox = absoluteBoundingBox(doc, shape);
    const z = deriveZIndexMetrics(doc, shape.id);
    const relativeParent = deriveRelativeParentGeometry(doc, shape.id);
    const spatial = deriveSpatialRelationships(doc, shape.id, options);
    map.set(shape.id, {
      worldBox,
      z,
      relativeParent,
      spatial,
    });
  }
  return map;
}
