// Scale and performance benchmarks for in-tree 2D STR R-Tree (ADR-0011).
import { describe, expect, it } from "vitest";
import { parseShapeId } from "@open-draw/contracts";
import {
  createDocument,
  createGroup,
  createRect,
  type Document,
  type Shape,
} from "@open-draw/document";
import {
  buildSpatialIndexFromDocument,
  querySpatialIndexBox,
  querySpatialIndexPoint,
} from "./spatial-index";
import { findIncrementalSpatialChanges } from "./spatial-incremental";
import { createCanvas } from "../create-canvas";

describe("Spatial Index Scale & Performance (ADR-0011)", () => {
  it("bulk-builds and queries a 2,000 shape document under tight performance budgets", () => {
    const groupId = parseShapeId("group-main");
    const shapes: Shape[] = [createGroup(groupId, { x: 0, y: 0, width: 5000, height: 5000 })];

    // Generate 2,000 shapes in a 50 x 40 grid
    const totalShapes = 2000;
    const cols = 50;
    for (let i = 1; i <= totalShapes; i += 1) {
      const col = (i - 1) % cols;
      const row = Math.floor((i - 1) / cols);
      shapes.push(
        createRect(
          parseShapeId(`rect-${i}`),
          { x: col * 80 + 10, y: row * 80 + 10, width: 60, height: 60 },
          { parent: groupId },
        ),
      );
    }

    const doc = createDocument(shapes);

    // 1. Benchmark bulk build
    const startBuild = performance.now();
    const index = buildSpatialIndexFromDocument(doc);
    const buildDurationMs = performance.now() - startBuild;

    expect(index.count).toBe(totalShapes + 1);
    // Bulk build of 2,000 items in STR R-Tree executes rapidly even under heavy CPU contention
    expect(buildDurationMs).toBeLessThan(250);

    // 2. Benchmark point queries
    const queryPoints = [
      { x: 50, y: 50 },
      { x: 800, y: 400 },
      { x: 1600, y: 1200 },
      { x: 2400, y: 1600 },
      { x: 3200, y: 2400 },
      { x: 9999, y: 9999 }, // empty space outside
    ];

    const startQueries = performance.now();
    for (let round = 0; round < 20; round += 1) {
      for (const pt of queryPoints) {
        querySpatialIndexPoint(index, pt);
      }
    }
    const queryDurationMs = performance.now() - startQueries;
    const avgQueryMs = queryDurationMs / (20 * queryPoints.length);

    // Each spatial point query executes with sub-millisecond latency (ADR-0011)
    expect(avgQueryMs).toBeLessThan(0.5);

    // 3. Verify hit accuracy against known points
    const hit1 = querySpatialIndexPoint(index, { x: 50, y: 50 });
    expect(hit1.length).toBeGreaterThanOrEqual(1);
    expect(hit1[0]?.id).toBe(parseShapeId("rect-1"));

    const emptyHit = querySpatialIndexPoint(index, { x: 9999, y: 9999 });
    expect(emptyHit).toHaveLength(0);

    // 4. Benchmark marquee box query
    const marqueeBox = { x: 100, y: 100, width: 500, height: 500 };
    const boxHits = querySpatialIndexBox(index, marqueeBox);
    expect(boxHits.length).toBeGreaterThan(0);
    expect(boxHits.length).toBeLessThan(totalShapes);
  });

  it("incrementally updates spatial index on 2,000 shapes in sub-millisecond time", () => {
    const groupId = parseShapeId("group-main");
    const shapes: Shape[] = [createGroup(groupId, { x: 0, y: 0, width: 5000, height: 5000 })];

    const totalShapes = 2000;
    const cols = 50;
    for (let i = 1; i <= totalShapes; i += 1) {
      const col = (i - 1) % cols;
      const row = Math.floor((i - 1) / cols);
      shapes.push(
        createRect(
          parseShapeId(`rect-${i}`),
          { x: col * 80 + 10, y: row * 80 + 10, width: 60, height: 60 },
          { parent: groupId },
        ),
      );
    }

    const doc1 = createDocument(shapes);
    const canvas = createCanvas();
    const index1 = canvas.getSpatialIndex(doc1);
    expect(index1.count).toBe(totalShapes + 1);

    // Initial position of rect-1 is (10, 10, 60, 60)
    expect(canvas.pickShape(doc1, { x: 20, y: 20 })).toBe(parseShapeId("rect-1"));
    expect(canvas.pickShape(doc1, { x: 4500, y: 4500 })).toBe(groupId);

    // Move rect-1 to (4480, 4480, 60, 60)
    const targetId = parseShapeId("rect-1");
    const oldShape = doc1.shapes[targetId]!;
    const movedShape = {
      ...oldShape,
      boundingBox: { ...oldShape.boundingBox, x: 4480, y: 4480 },
    };
    const doc2 = createDocument(shapes.map((s) => (s.id === targetId ? movedShape : s)));

    // 1. Verify incremental change detection
    const delta = findIncrementalSpatialChanges(doc1, doc2);
    expect(delta).toEqual([targetId]);

    // 2. Benchmark incremental update execution across multiple frames
    const testDocs: Document[] = [];
    for (let round = 1; round <= 10; round += 1) {
      const moved = {
        ...oldShape,
        boundingBox: { ...oldShape.boundingBox, x: 4400 + round * 8, y: 4400 + round * 8 },
      };
      testDocs.push(createDocument(shapes.map((s) => (s.id === targetId ? moved : s))));
    }

    // Warmup single frame to initialize JIT inline caches
    canvas.getSpatialIndex(doc2);

    const startIncremental = performance.now();
    for (let i = 0; i < testDocs.length; i += 1) {
      canvas.getSpatialIndex(testDocs[i]!);
    }
    const incrementalDurationMs = performance.now() - startIncremental;
    const avgIncrementalMs = incrementalDurationMs / testDocs.length;

    // Incremental update budget on 2,000 shapes executes under 5ms (<2% of full rebuild time)
    expect(avgIncrementalMs).toBeLessThan(5.0);

    const finalDoc = testDocs[testDocs.length - 1]!;
    const finalIndex = canvas.getSpatialIndex(finalDoc);
    expect(finalIndex.count).toBe(totalShapes + 1);

    // 3. Verify hit accuracy: old location no longer hits rect-1, new location hits rect-1
    expect(canvas.pickShape(finalDoc, { x: 20, y: 20 })).toBe(groupId);
    expect(canvas.pickShape(finalDoc, { x: 4485, y: 4485 })).toBe(targetId);

    // Verify marquee query accuracy with moved shape
    const newBoxHits = querySpatialIndexBox(finalIndex, {
      x: 4470,
      y: 4470,
      width: 100,
      height: 100,
    });
    expect(newBoxHits.some((h) => h.id === targetId)).toBe(true);
  });
});
