// Tests for 2D STR R-Tree spatial index (R-015, ADR-0011).
import { describe, expect, it } from "vitest";
import { parseShapeId } from "@open-draw/contracts";
import { createDocument, createGroup, createRect, type Document } from "@open-draw/document";
import { createCanvas } from "../create-canvas";
import {
  buildSpatialIndexFromDocument,
  computeEnclosingSpatialBox,
  createSpatialIndex,
  pointInSpatialBox,
  querySpatialIndexBox,
  querySpatialIndexPoint,
  spatialBoxesIntersect,
  toSpatialBox,
  type SpatialIndexItem,
} from "./spatial-index";
import {
  findIncrementalSpatialChanges,
  updateSpatialIndexFromDocument,
  updateSpatialIndexItem,
} from "./spatial-incremental";

describe("toSpatialBox and bounding utilities", () => {
  it("converts BoundingBox to min/max format correctly", () => {
    const box = { x: 10, y: 20, width: 30, height: 40 };
    expect(toSpatialBox(box)).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 60 });
  });

  it("detects box intersection correctly", () => {
    const a = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
    const b = { minX: 25, minY: 25, maxX: 75, maxY: 75 };
    const c = { minX: 60, minY: 60, maxX: 100, maxY: 100 };
    expect(spatialBoxesIntersect(a, b)).toBe(true);
    expect(spatialBoxesIntersect(a, c)).toBe(false);
  });

  it("detects point containment with and without tolerance", () => {
    const box = { minX: 10, minY: 10, maxX: 50, maxY: 50 };
    expect(pointInSpatialBox(box, { x: 20, y: 20 })).toBe(true);
    expect(pointInSpatialBox(box, { x: 55, y: 20 })).toBe(false);
    expect(pointInSpatialBox(box, { x: 55, y: 20 }, 8)).toBe(true);
  });

  it("computes enclosing bounding box across multiple boxes", () => {
    const boxes = [
      { minX: 10, minY: 20, maxX: 30, maxY: 40 },
      { minX: 5, minY: 15, maxX: 50, maxY: 60 },
    ];
    expect(computeEnclosingSpatialBox(boxes)).toEqual({
      minX: 5,
      minY: 15,
      maxX: 50,
      maxY: 60,
    });
  });
});

describe("createSpatialIndex", () => {
  it("returns empty index for empty items array", () => {
    const index = createSpatialIndex([]);
    expect(index.root).toBeNull();
    expect(index.count).toBe(0);
  });

  it("creates single leaf root when count is within capacity", () => {
    const items: SpatialIndexItem[] = [
      { id: parseShapeId("s1"), box: { x: 10, y: 10, width: 20, height: 20 }, zIndex: 0 },
      { id: parseShapeId("s2"), box: { x: 50, y: 50, width: 30, height: 30 }, zIndex: 1 },
    ];
    const index = createSpatialIndex(items, 4);
    expect(index.count).toBe(2);
    expect(index.root).not.toBeNull();
    expect(index.root?.isLeaf).toBe(true);
    if (index.root?.isLeaf) {
      expect(index.root.items).toHaveLength(2);
      expect(index.root.box).toEqual({ minX: 10, minY: 10, maxX: 80, maxY: 80 });
    }
  });

  it("partitions items into multi-level tree when count exceeds capacity", () => {
    const items: SpatialIndexItem[] = [];
    for (let i = 0; i < 25; i += 1) {
      items.push({
        id: parseShapeId(`shape-${i}`),
        box: { x: (i % 5) * 40, y: Math.floor(i / 5) * 40, width: 30, height: 30 },
        zIndex: i,
      });
    }

    const index = createSpatialIndex(items, 4);
    expect(index.count).toBe(25);
    expect(index.root?.isLeaf).toBe(false);
  });
});

describe("querySpatialIndexPoint", () => {
  it("returns empty array when index is empty", () => {
    const index = createSpatialIndex([]);
    expect(querySpatialIndexPoint(index, { x: 10, y: 10 })).toEqual([]);
  });

  it("finds all shapes covering a point and orders by zIndex descending", () => {
    const items: SpatialIndexItem[] = [
      { id: parseShapeId("bottom"), box: { x: 0, y: 0, width: 100, height: 100 }, zIndex: 0 },
      { id: parseShapeId("middle"), box: { x: 10, y: 10, width: 50, height: 50 }, zIndex: 1 },
      { id: parseShapeId("top"), box: { x: 20, y: 20, width: 30, height: 30 }, zIndex: 2 },
      { id: parseShapeId("other"), box: { x: 200, y: 200, width: 50, height: 50 }, zIndex: 3 },
    ];

    const index = createSpatialIndex(items, 2);
    const hits = querySpatialIndexPoint(index, { x: 25, y: 25 });
    expect(hits.map((h) => h.id)).toEqual([
      parseShapeId("top"),
      parseShapeId("middle"),
      parseShapeId("bottom"),
    ]);
  });

  it("returns empty array when query point is in empty space", () => {
    const items: SpatialIndexItem[] = [
      { id: parseShapeId("s1"), box: { x: 10, y: 10, width: 20, height: 20 }, zIndex: 0 },
    ];
    const index = createSpatialIndex(items, 4);
    expect(querySpatialIndexPoint(index, { x: 500, y: 500 })).toEqual([]);
  });
});

describe("querySpatialIndexBox", () => {
  it("returns intersecting items across multi-level tree", () => {
    const items: SpatialIndexItem[] = [
      { id: parseShapeId("s1"), box: { x: 0, y: 0, width: 50, height: 50 }, zIndex: 0 },
      { id: parseShapeId("s2"), box: { x: 40, y: 40, width: 50, height: 50 }, zIndex: 1 },
      { id: parseShapeId("s3"), box: { x: 200, y: 200, width: 50, height: 50 }, zIndex: 2 },
    ];
    const index = createSpatialIndex(items, 2);

    const hits = querySpatialIndexBox(index, { x: 30, y: 30, width: 20, height: 20 });
    const hitIds = hits.map((h) => h.id);
    expect(hitIds).toContain(parseShapeId("s1"));
    expect(hitIds).toContain(parseShapeId("s2"));
    expect(hitIds).not.toContain(parseShapeId("s3"));
  });
});

describe("buildSpatialIndexFromDocument", () => {
  it("builds index from canonical document with correct zIndex ordering", () => {
    const groupId = parseShapeId("group-1");
    const rectA = parseShapeId("rect-a");
    const rectB = parseShapeId("rect-b");

    const doc = createDocument([
      createGroup(groupId, { x: 0, y: 0, width: 800, height: 600 }),
      createRect(rectA, { x: 10, y: 10, width: 100, height: 100 }, { parent: groupId }),
      createRect(rectB, { x: 50, y: 50, width: 100, height: 100 }, { parent: groupId }),
    ]);

    const index = buildSpatialIndexFromDocument(doc);
    expect(index.count).toBe(3);

    const hits = querySpatialIndexPoint(index, { x: 60, y: 60 });
    expect(hits[0]?.id).toBe(rectB);
    expect(hits[1]?.id).toBe(rectA);
    expect(hits[2]?.id).toBe(groupId);
  });
});

describe("updateSpatialIndexItem", () => {
  it("updates item bounding box and preserves its zIndex", () => {
    const items: SpatialIndexItem[] = [
      { id: parseShapeId("s1"), box: { x: 0, y: 0, width: 50, height: 50 }, zIndex: 0 },
      { id: parseShapeId("s2"), box: { x: 60, y: 60, width: 50, height: 50 }, zIndex: 1 },
    ];
    const index = createSpatialIndex(items);

    const updated = updateSpatialIndexItem(index, {
      id: parseShapeId("s1"),
      box: { x: 100, y: 100, width: 50, height: 50 },
      zIndex: -1,
    });
    expect(updated).not.toBeNull();

    const oldHits = querySpatialIndexPoint(updated!, { x: 25, y: 25 });
    expect(oldHits).toHaveLength(0);

    const newHits = querySpatialIndexPoint(updated!, { x: 125, y: 125 });
    expect(newHits).toHaveLength(1);
    expect(newHits[0]?.id).toBe(parseShapeId("s1"));
    expect(newHits[0]?.zIndex).toBe(0);
  });

  it("returns null when item is not found in spatial index (P2 failure mode)", () => {
    const items: SpatialIndexItem[] = [
      { id: parseShapeId("s1"), box: { x: 0, y: 0, width: 50, height: 50 }, zIndex: 0 },
    ];
    const index = createSpatialIndex(items);

    const updated = updateSpatialIndexItem(index, {
      id: parseShapeId("non-existent"),
      box: { x: 100, y: 100, width: 50, height: 50 },
    });
    expect(updated).toBeNull();
  });

  it("preserves existing zIndex when zIndex is omitted from update item without using negative sentinels", () => {
    const items: SpatialIndexItem[] = [
      { id: parseShapeId("s1"), box: { x: 0, y: 0, width: 50, height: 50 }, zIndex: 42 },
    ];
    const index = createSpatialIndex(items);

    const updated = updateSpatialIndexItem(index, {
      id: parseShapeId("s1"),
      box: { x: 100, y: 100, width: 50, height: 50 },
    });
    expect(updated).not.toBeNull();
    const hits = querySpatialIndexPoint(updated!, { x: 125, y: 125 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.zIndex).toBe(42);
  });
});

describe("findIncrementalSpatialChanges & updateSpatialIndexFromDocument", () => {
  it("detects incremental bounding box move and updates document spatial index", () => {
    const groupId = parseShapeId("p1");
    const rect1 = parseShapeId("r1");
    const doc1 = createDocument([
      createGroup(groupId, { x: 0, y: 0, width: 800, height: 600 }),
      createRect(rect1, { x: 10, y: 10, width: 50, height: 50 }, { parent: groupId }),
    ]);

    const doc2 = createDocument([
      createGroup(groupId, { x: 0, y: 0, width: 800, height: 600 }),
      createRect(rect1, { x: 200, y: 200, width: 50, height: 50 }, { parent: groupId }),
    ]);

    const changes = findIncrementalSpatialChanges(doc1, doc2);
    expect(changes).toEqual([rect1]);

    const initialIndex = buildSpatialIndexFromDocument(doc1);
    const updatedIndex = updateSpatialIndexFromDocument(initialIndex, doc1, doc2, changes!);
    expect(updatedIndex).not.toBeNull();

    expect(querySpatialIndexPoint(updatedIndex!, { x: 20, y: 20 })).toHaveLength(1); // hits group only
    expect(querySpatialIndexPoint(updatedIndex!, { x: 210, y: 210 })[0]?.id).toBe(rect1);
  });

  it("returns null when updateSpatialIndexFromDocument encounters missing shape or unindexed item", () => {
    const groupId = parseShapeId("p1");
    const rect1 = parseShapeId("r1");
    const doc1 = createDocument([
      createGroup(groupId, { x: 0, y: 0, width: 800, height: 600 }),
      createRect(rect1, { x: 10, y: 10, width: 50, height: 50 }, { parent: groupId }),
    ]);
    const doc2 = createDocument([
      createGroup(groupId, { x: 0, y: 0, width: 800, height: 600 }),
      createRect(rect1, { x: 200, y: 200, width: 50, height: 50 }, { parent: groupId }),
    ]);

    // Build index that does NOT have rect1
    const incompleteIndex = createSpatialIndex([
      { id: groupId, box: { x: 0, y: 0, width: 800, height: 600 }, zIndex: 0 },
    ]);
    const res = updateSpatialIndexFromDocument(incompleteIndex, doc1, doc2, [rect1]);
    expect(res).toBeNull();
  });

  it("updates spatial index incrementally through canvas controller when shape moves", () => {
    const groupId = parseShapeId("p1");
    const rect1 = parseShapeId("r1");
    const doc1 = createDocument([
      createGroup(groupId, { x: 0, y: 0, width: 800, height: 600 }),
      createRect(rect1, { x: 10, y: 10, width: 50, height: 50 }, { parent: groupId }),
    ]);

    const canvas = createCanvas();
    // Warm up spatial index
    expect(canvas.pickShape(doc1, { x: 20, y: 20 })).toBe(rect1);

    // Simulate moving rect1 to (200, 200)
    const doc2 = createDocument([
      createGroup(groupId, { x: 0, y: 0, width: 800, height: 600 }),
      createRect(rect1, { x: 200, y: 200, width: 50, height: 50 }, { parent: groupId }),
    ]);

    // Query with new doc without calling invalidateSpatialIndex
    expect(canvas.pickShape(doc2, { x: 20, y: 20 })).toBe(groupId);
    expect(canvas.pickShape(doc2, { x: 210, y: 210 })).toBe(rect1);
  });

  it("falls back to clean full rebuild when incremental spatial update fails and preserves query correctness (P2)", () => {
    const groupId = parseShapeId("p1");
    const rect1 = parseShapeId("r1");
    const doc1 = createDocument([
      createGroup(groupId, { x: 0, y: 0, width: 800, height: 600 }),
      createRect(rect1, { x: 10, y: 10, width: 50, height: 50 }, { parent: groupId }),
    ]);

    const canvas = createCanvas();
    canvas.getSpatialIndex(doc1);

    // Corrupt cached index by manually replacing it with an index missing rect1
    const canvasInternal = canvas as unknown as { cachedSpatialIndex?: unknown };
    if ("cachedSpatialIndex" in canvasInternal) {
      canvasInternal.cachedSpatialIndex = createSpatialIndex([]);
    }

    // Move rect1 to (200, 200)
    const doc2 = createDocument([
      createGroup(groupId, { x: 0, y: 0, width: 800, height: 600 }),
      createRect(rect1, { x: 200, y: 200, width: 50, height: 50 }, { parent: groupId }),
    ]);

    // Should detect failed incremental update and fall back to clean full rebuild
    expect(canvas.pickShape(doc2, { x: 210, y: 210 })).toBe(rect1);
    expect(canvas.pickShape(doc2, { x: 20, y: 20 })).toBe(groupId);
  });

  it("returns null when shapes key iteration order is permuted (stacking order permutation requires full rebuild)", () => {
    const groupId = parseShapeId("p1");
    const rect1 = parseShapeId("r1");
    const rect2 = parseShapeId("r2");

    const group = createGroup(groupId, { x: 0, y: 0, width: 800, height: 600 });
    const r1 = createRect(rect1, { x: 10, y: 10, width: 50, height: 50 }, { parent: groupId });
    const r2 = createRect(rect2, { x: 100, y: 100, width: 50, height: 50 }, { parent: groupId });

    // doc1 keys order: p1, r1, r2
    const doc1 = createDocument([group, r1, r2]);

    // doc2 keys order: r2, r1, p1 (permuted key order), with r1 moved
    const r1Moved = createRect(
      rect1,
      { x: 200, y: 200, width: 50, height: 50 },
      { parent: groupId },
    );
    const doc2: Document = {
      schema: doc1.schema,
      shapes: {
        [rect2]: r2,
        [rect1]: r1Moved,
        [groupId]: group,
      },
    };

    const changes = findIncrementalSpatialChanges(doc1, doc2);
    expect(changes).toBeNull();
  });
});
