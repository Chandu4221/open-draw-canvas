import { describe, expect, it } from "vitest";
import { FILL_STYLES, MAX_COORDINATE_BOUND, parseShapeId, ROOT_ID } from "@open-draw/contracts";
import {
  applySetShapeStyle,
  applyTransaction,
  COMMANDS,
  createDocument,
  createGroup,
  createRect,
  createTransaction,
  DocumentError,
} from "./index";

describe("document commands", () => {
  const rectId = parseShapeId("rect-1");

  function createBaseDoc() {
    return createDocument([createRect(rectId, { x: 10, y: 10, width: 100, height: 50 })]);
  }

  it("applies SetShapeStyle and inverts cleanly (F1)", () => {
    const doc = createBaseDoc();
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.setShapeStyle,
          id: rectId,
          fill: "#e0f2fe",
          stroke: "#0284c7",
          strokeWidth: 2,
        },
      ]),
    );

    expect(result.document.shapes[rectId]?.fill).toBe("#e0f2fe");
    expect(result.document.shapes[rectId]?.stroke).toBe("#0284c7");
    expect(result.document.shapes[rectId]?.strokeWidth).toBe(2);

    const undone = applyTransaction(result.document, createTransaction(result.inverse));
    expect(undone.document.shapes[rectId]?.fill).toBeUndefined();
    expect(undone.document.shapes[rectId]?.stroke).toBeUndefined();
    expect(undone.document.shapes[rectId]?.strokeWidth).toBeUndefined();
  });

  it("applies SetShapeStyle with fillStyle and inverts cleanly (R-005, R-016)", () => {
    const doc = createBaseDoc();
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.setShapeStyle,
          id: rectId,
          fillStyle: FILL_STYLES.none,
        },
      ]),
    );

    expect(result.document.shapes[rectId]?.fillStyle).toBe(FILL_STYLES.none);

    const undone = applyTransaction(result.document, createTransaction(result.inverse));
    expect(undone.document.shapes[rectId]?.fillStyle).toBeUndefined();

    // Update to hatch
    const hatchResult = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.setShapeStyle,
          id: rectId,
          fillStyle: FILL_STYLES.hatch,
        },
      ]),
    );
    expect(hatchResult.document.shapes[rectId]?.fillStyle).toBe(FILL_STYLES.hatch);

    // Clear fillStyle by setting null
    const clearResult = applyTransaction(
      hatchResult.document,
      createTransaction([
        {
          type: COMMANDS.setShapeStyle,
          id: rectId,
          fillStyle: null,
        },
      ]),
    );
    expect(clearResult.document.shapes[rectId]?.fillStyle).toBeUndefined();
  });

  it("short-circuits and returns empty inverse when applySetShapeStyle encounters identical styles (P2)", () => {
    const doc = createBaseDoc();
    const result1 = applySetShapeStyle(doc, {
      type: COMMANDS.setShapeStyle,
      id: rectId,
      fill: "#e0f2fe",
      stroke: "#0284c7",
      strokeWidth: 2,
      fillStyle: FILL_STYLES.hatch,
    });
    expect(result1.inverse).toHaveLength(1);
    expect(result1.document.shapes[rectId]?.fill).toBe("#e0f2fe");

    // Re-applying the exact same style should short-circuit: doc unmodified, inverse empty
    const result2 = applySetShapeStyle(result1.document, {
      type: COMMANDS.setShapeStyle,
      id: rectId,
      fill: "#e0f2fe",
      stroke: "#0284c7",
      strokeWidth: 2,
      fillStyle: FILL_STYLES.hatch,
    });
    expect(result2.document).toBe(result1.document);
    expect(result2.inverse).toEqual([]);
  });

  it("updates and clears shape content with clean inverse (SetShapeContent)", () => {
    const doc = createBaseDoc();

    // Set content
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.setShapeContent,
          id: rectId,
          content: "Hello World",
        },
      ]),
    );

    expect(result.document.shapes[rectId]?.content).toBe("Hello World");

    // Inverse restores undefined
    const undone = applyTransaction(result.document, createTransaction(result.inverse));
    expect(undone.document.shapes[rectId]?.content).toBeUndefined();

    // Clear content with null
    const cleared = applyTransaction(
      result.document,
      createTransaction([
        {
          type: COMMANDS.setShapeContent,
          id: rectId,
          content: null,
        },
      ]),
    );
    expect(cleared.document.shapes[rectId]?.content).toBeUndefined();

    // Inverse of clear restores "Hello World"
    const restored = applyTransaction(cleared.document, createTransaction(cleared.inverse));
    expect(restored.document.shapes[rectId]?.content).toBe("Hello World");
  });

  it("rejects SetShapeBoundingBox with non-positive or NaN dimensions", () => {
    const doc = createBaseDoc();
    expect(() =>
      applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.setShapeBoundingBox,
            id: rectId,
            boundingBox: { x: 10, y: 10, width: 0, height: 100 },
          },
        ]),
      ),
    ).toThrow(DocumentError);

    expect(() =>
      applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.setShapeBoundingBox,
            id: rectId,
            boundingBox: { x: 10, y: 10, width: -50, height: 100 },
          },
        ]),
      ),
    ).toThrow(DocumentError);

    expect(() =>
      applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.setShapeBoundingBox,
            id: rectId,
            boundingBox: { x: 10, y: 10, width: 100, height: NaN },
          },
        ]),
      ),
    ).toThrow(DocumentError);
  });

  it("rejects shape constructors with non-positive or NaN dimensions", () => {
    expect(() => createRect(parseShapeId("r-zero"), { x: 0, y: 0, width: 0, height: 100 })).toThrow(
      DocumentError,
    );

    expect(() =>
      createGroup(parseShapeId("g-neg"), { x: 0, y: 0, width: 100, height: -10 }),
    ).toThrow(DocumentError);
  });

  it("rejects shape constructors with string strokeWidth or invalid colors", () => {
    expect(() =>
      createRect(
        parseShapeId("r-stroke"),
        { x: 0, y: 0, width: 100, height: 100 },
        { strokeWidth: "2" as unknown as number },
      ),
    ).toThrow(DocumentError);

    expect(() =>
      createRect(parseShapeId("r-color"), { x: 0, y: 0, width: 100, height: 100 }, { fill: "red" }),
    ).toThrow(DocumentError);
  });

  it("rejects SetShapeStyle with string strokeWidth or invalid colors", () => {
    const doc = createBaseDoc();
    expect(() =>
      applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.setShapeStyle,
            id: rectId,
            strokeWidth: "2" as unknown as number,
          },
        ]),
      ),
    ).toThrow(DocumentError);

    expect(() =>
      applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.setShapeStyle,
            id: rectId,
            fill: "not-a-color",
          },
        ]),
      ),
    ).toThrow(DocumentError);
  });

  describe("bounds clamping and save/load integrity (P0-1)", () => {
    it("clamps MoveShapes so coordinates never exceed MAX_COORDINATE_BOUND", () => {
      const doc = createDocument([
        createRect(rectId, { x: 99_950, y: 99_950, width: 100, height: 100 }),
      ]);
      const result = applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.moveShapes,
            ids: [rectId],
            dx: 500,
            dy: 500,
          },
        ]),
      );
      const movedShape = result.document.shapes[rectId]!;
      expect(movedShape.boundingBox.x).toBeLessThanOrEqual(100_000);
      expect(movedShape.boundingBox.y).toBeLessThanOrEqual(100_000);
    });

    it("clamps SetShapeBoundingBox so dimensions and coordinates never exceed MAX_COORDINATE_BOUND", () => {
      const doc = createDocument([createRect(rectId, { x: 10, y: 10, width: 100, height: 100 })]);
      const result = applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.setShapeBoundingBox,
            id: rectId,
            boundingBox: { x: 150_000, y: 150_000, width: 200_000, height: 200_000 },
          },
        ]),
      );
      const resizedShape = result.document.shapes[rectId]!;
      expect(resizedShape.boundingBox.x).toBeLessThanOrEqual(100_000);
      expect(resizedShape.boundingBox.y).toBeLessThanOrEqual(100_000);
      expect(resizedShape.boundingBox.width).toBeLessThanOrEqual(100_000);
      expect(resizedShape.boundingBox.height).toBeLessThanOrEqual(100_000);
    });
  });

  describe("lossless undo inverses for point shapes (P0-2)", () => {
    it("restores exact line start and end points without floating point drift or collapse", () => {
      const lineId = parseShapeId("line-1");
      const line = {
        id: lineId,
        kind: "line" as const,
        parentId: ROOT_ID,
        boundingBox: { x: 10, y: 10, width: 100, height: 100 },
        start: { x: 10.333333, y: 20.666667 },
        end: { x: 90.123456, y: 80.654321 },
        meta: {},
      };
      const doc = createDocument([line]);
      const resized = applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.setShapeBoundingBox,
            id: lineId,
            boundingBox: { x: 20, y: 20, width: 300, height: 250 },
          },
        ]),
      );
      const undone = applyTransaction(resized.document, createTransaction(resized.inverse));
      const restoredLine = undone.document.shapes[lineId] as typeof line;
      expect(restoredLine.start).toEqual(line.start);
      expect(restoredLine.end).toEqual(line.end);
    });

    it("restores exact pen path points on undo without degenerate collapse", () => {
      const penId = parseShapeId("pen-1");
      const originalPoints = [
        { x: 0, y: 0 },
        { x: 25.12345, y: 50.6789 },
        { x: 100, y: 100 },
      ];
      const penShape = {
        id: penId,
        kind: "pen-path" as const,
        parentId: ROOT_ID,
        boundingBox: { x: 10, y: 10, width: 100, height: 100 },
        points: originalPoints,
        meta: {},
      };
      const doc = createDocument([penShape]);
      const resized = applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.setShapeBoundingBox,
            id: penId,
            boundingBox: { x: 50, y: 50, width: 500, height: 500 },
          },
        ]),
      );
      const undone = applyTransaction(resized.document, createTransaction(resized.inverse));
      const restoredPen = undone.document.shapes[penId] as typeof penShape;
      expect(restoredPen.points).toEqual(originalPoints);
    });

    it("clamps reparent bounding box within MAX_COORDINATE_BOUND", () => {
      const groupId = parseShapeId("group-parent");
      const childRectId = parseShapeId("rect-clamp");
      const doc = createDocument([
        createGroup(groupId, { x: 0, y: 0, width: 1000, height: 1000 }),
        createRect(childRectId, { x: 10, y: 10, width: 50, height: 50 }, { parent: groupId }),
      ]);
      const res = applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.reparentShape,
            id: childRectId,
            parentId: ROOT_ID,
            boundingBox: { x: 200_000, y: -200_000, width: 50, height: 50 },
          },
        ]),
      );
      const reparented = res.document.shapes[childRectId]!;
      expect(reparented.boundingBox.x).toBe(MAX_COORDINATE_BOUND);
      expect(reparented.boundingBox.y).toBe(-MAX_COORDINATE_BOUND);
      const undone = applyTransaction(res.document, createTransaction(res.inverse));
      expect(undone.document.shapes[childRectId]!.boundingBox).toEqual({
        x: 10,
        y: 10,
        width: 50,
        height: 50,
      });
    });

    it("rejects moveShapes when dx or dy is not finite", () => {
      const doc = createBaseDoc();
      expect(() =>
        applyTransaction(
          doc,
          createTransaction([
            {
              type: COMMANDS.moveShapes,
              ids: [rectId],
              dx: Number.NaN,
              dy: 10,
            },
          ]),
        ),
      ).toThrow(DocumentError);
      expect(() =>
        applyTransaction(
          doc,
          createTransaction([
            {
              type: COMMANDS.moveShapes,
              ids: [rectId],
              dx: 10,
              dy: Number.POSITIVE_INFINITY,
            },
          ]),
        ),
      ).toThrow(DocumentError);
    });
  });
});
