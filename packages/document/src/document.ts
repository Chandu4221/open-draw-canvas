// The Document value and its validating constructor (ADR-0002 D1–D2). The tree
// is derived, never stored twice; `createDocument` is the single place where
// the structural invariants (parent chains, cycle check, container rules) are
// enforced, so every document — parsed or built by commands — is valid.
import type { ShapeId } from "@open-draw/contracts";
import {
  MAX_DOCUMENT_DEPTH,
  MAX_DOCUMENT_SHAPE_COUNT,
  SHAPE_KINDS,
  isRootId,
} from "@open-draw/contracts";
import { DocumentError } from "./errors";
import type { Shape } from "./shape";

export const SCHEMA_VERSION = 1 as const;

export interface DocumentSchema {
  readonly version: typeof SCHEMA_VERSION;
}

export interface Document {
  readonly schema: DocumentSchema;
  readonly shapes: Readonly<Record<ShapeId, Shape>>;
}

export interface CreateDocumentOptions {
  readonly maxShapeCount?: number;
  readonly validateOnlyIds?: ReadonlySet<ShapeId> | readonly ShapeId[];
}

export const CONTAINER_KINDS: ReadonlySet<string> = new Set([SHAPE_KINDS.group, SHAPE_KINDS.rect]);

function validateStructure(
  shapes: Readonly<Record<ShapeId, Shape>>,
  maxShapeCount: number = MAX_DOCUMENT_SHAPE_COUNT,
  validateOnlyIds?: ReadonlySet<ShapeId> | readonly ShapeId[],
): void {
  const shapeCount = Object.keys(shapes).length;
  if (shapeCount > maxShapeCount) {
    throw new DocumentError(
      "documentShapeCountExceeded",
      `document shape count (${shapeCount}) exceeds maximum limit (${maxShapeCount})`,
    );
  }

  const shapesToValidate: Shape[] = [];
  if (validateOnlyIds !== undefined) {
    for (const id of validateOnlyIds) {
      const shape = shapes[id];
      if (shape !== undefined) {
        shapesToValidate.push(shape);
      }
    }
  } else {
    for (const shape of Object.values(shapes)) {
      shapesToValidate.push(shape);
    }
  }

  for (let i = 0; i < shapesToValidate.length; i++) {
    const shape = shapesToValidate[i]!;
    const b = shape.boundingBox;
    if (
      !Number.isFinite(b.x) ||
      !Number.isFinite(b.y) ||
      !Number.isFinite(b.width) ||
      !Number.isFinite(b.height) ||
      b.width <= 0 ||
      b.height <= 0
    ) {
      throw new DocumentError(
        "invalidShape",
        `shape ${shape.id} has invalid bounding box: coordinates must be finite and dimensions positive`,
      );
    }

    if (isRootId(shape.parentId)) {
      continue;
    }

    const visited = new Set<ShapeId>([shape.id]);
    let cursor = shape.parentId;
    let depth = 1;
    while (!isRootId(cursor)) {
      depth++;
      if (depth > MAX_DOCUMENT_DEPTH) {
        throw new DocumentError(
          "documentDepthExceeded",
          `document depth exceeds maximum of ${MAX_DOCUMENT_DEPTH}`,
        );
      }
      if (visited.has(cursor)) {
        throw new DocumentError("parentCycle", `parent chain cycles at: ${cursor}`);
      }
      visited.add(cursor);
      const parent = shapes[cursor];
      if (parent === undefined) {
        throw new DocumentError("unknownParent", `unknown parent: ${cursor} (of ${shape.id})`);
      }
      cursor = parent.parentId;
    }
  }
}

export function createDocumentFromMap(
  shapesMap: Record<ShapeId, Shape>,
  options?: CreateDocumentOptions,
): Document {
  validateStructure(shapesMap, options?.maxShapeCount, options?.validateOnlyIds);
  return Object.freeze({
    schema: Object.freeze({ version: SCHEMA_VERSION }),
    shapes: Object.freeze(shapesMap),
  });
}

export function createDocument(
  shapes: readonly Shape[] = [],
  options?: CreateDocumentOptions,
): Document {
  const shapesMap: Record<ShapeId, Shape> = {};
  for (const shape of shapes) {
    if (shapesMap[shape.id] !== undefined) {
      throw new DocumentError("duplicateShapeId", `duplicate shape id: ${shape.id}`);
    }
    shapesMap[shape.id] = shape;
  }
  return createDocumentFromMap(shapesMap, options);
}
