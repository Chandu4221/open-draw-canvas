import { describe, expect, it } from "vitest";
import { parseShapeId, ROOT_ID } from "@open-draw/contracts";
import { createDocument } from "../../document";
import { DocumentError } from "../../errors";
import { createRect } from "../../shape";
import { shapeListInOrder } from "../../tree";
import { COMMANDS } from "../registry";
import { applyTransaction, createTransaction } from "../../transactions";
import { applyReorderShapes, REORDER_OPERATIONS } from "./index";

describe("ReorderShapes command", () => {
  const shapeA = parseShapeId("rect-a");
  const shapeB = parseShapeId("rect-b");
  const shapeC = parseShapeId("rect-c");
  const shapeD = parseShapeId("rect-d");
  const shapeE = parseShapeId("rect-e");

  function setupDoc() {
    return createDocument([
      createRect(shapeA, { x: 0, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
      createRect(shapeB, { x: 60, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
      createRect(shapeC, { x: 120, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
      createRect(shapeD, { x: 180, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
      createRect(shapeE, { x: 240, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
    ]);
  }

  it("brings a shape to the front among siblings and returns an exact lossless inverse", () => {
    const doc = setupDoc();
    const result = applyReorderShapes(doc, {
      type: COMMANDS.reorderShapes,
      ids: [shapeB],
      operation: REORDER_OPERATIONS.bringToFront,
    });

    const ordered = shapeListInOrder(result.document).map((s) => s.id);
    expect(ordered).toEqual([shapeA, shapeC, shapeD, shapeE, shapeB]);

    const txResult = applyTransaction(result.document, createTransaction(result.inverse));
    const restored = shapeListInOrder(txResult.document).map((s) => s.id);
    expect(restored).toEqual([shapeA, shapeB, shapeC, shapeD, shapeE]);
  });

  it("sends a shape to the back among siblings and returns an exact lossless inverse", () => {
    const doc = setupDoc();
    const result = applyReorderShapes(doc, {
      type: COMMANDS.reorderShapes,
      ids: [shapeD],
      operation: REORDER_OPERATIONS.sendToBack,
    });

    const ordered = shapeListInOrder(result.document).map((s) => s.id);
    expect(ordered).toEqual([shapeD, shapeA, shapeB, shapeC, shapeE]);

    const txResult = applyTransaction(result.document, createTransaction(result.inverse));
    const restored = shapeListInOrder(txResult.document).map((s) => s.id);
    expect(restored).toEqual([shapeA, shapeB, shapeC, shapeD, shapeE]);
  });

  it("brings a shape forward by one step among siblings", () => {
    const doc = setupDoc();
    const result = applyReorderShapes(doc, {
      type: COMMANDS.reorderShapes,
      ids: [shapeB],
      operation: REORDER_OPERATIONS.bringForward,
    });

    const ordered = shapeListInOrder(result.document).map((s) => s.id);
    expect(ordered).toEqual([shapeA, shapeC, shapeB, shapeD, shapeE]);

    const txResult = applyTransaction(result.document, createTransaction(result.inverse));
    const restored = shapeListInOrder(txResult.document).map((s) => s.id);
    expect(restored).toEqual([shapeA, shapeB, shapeC, shapeD, shapeE]);
  });

  it("sends a shape backward by one step among siblings", () => {
    const doc = setupDoc();
    const result = applyReorderShapes(doc, {
      type: COMMANDS.reorderShapes,
      ids: [shapeC],
      operation: REORDER_OPERATIONS.sendBackward,
    });

    const ordered = shapeListInOrder(result.document).map((s) => s.id);
    expect(ordered).toEqual([shapeA, shapeC, shapeB, shapeD, shapeE]);

    const txResult = applyTransaction(result.document, createTransaction(result.inverse));
    const restored = shapeListInOrder(txResult.document).map((s) => s.id);
    expect(restored).toEqual([shapeA, shapeB, shapeC, shapeD, shapeE]);
  });

  it("reorders multiple selected shapes simultaneously preserving relative order", () => {
    const doc = setupDoc();
    const result = applyReorderShapes(doc, {
      type: COMMANDS.reorderShapes,
      ids: [shapeB, shapeD],
      operation: REORDER_OPERATIONS.bringToFront,
    });

    const ordered = shapeListInOrder(result.document).map((s) => s.id);
    expect(ordered).toEqual([shapeA, shapeC, shapeE, shapeB, shapeD]);

    const txResult = applyTransaction(result.document, createTransaction(result.inverse));
    const restored = shapeListInOrder(txResult.document).map((s) => s.id);
    expect(restored).toEqual([shapeA, shapeB, shapeC, shapeD, shapeE]);
  });

  it("sets explicit sibling order using setOrder", () => {
    const doc = setupDoc();
    const newOrder = [shapeE, shapeD, shapeC, shapeB, shapeA];
    const result = applyReorderShapes(doc, {
      type: COMMANDS.reorderShapes,
      ids: newOrder,
      operation: REORDER_OPERATIONS.setOrder,
    });

    const ordered = shapeListInOrder(result.document).map((s) => s.id);
    expect(ordered).toEqual(newOrder);

    const txResult = applyTransaction(result.document, createTransaction(result.inverse));
    const restored = shapeListInOrder(txResult.document).map((s) => s.id);
    expect(restored).toEqual([shapeA, shapeB, shapeC, shapeD, shapeE]);
  });

  it("throws DocumentError when target shape does not exist", () => {
    const doc = setupDoc();
    const nonexistent = parseShapeId("ghost");
    expect(() =>
      applyReorderShapes(doc, {
        type: COMMANDS.reorderShapes,
        ids: [nonexistent],
        operation: REORDER_OPERATIONS.bringToFront,
      }),
    ).toThrow(DocumentError);
  });

  it("no-ops cleanly when shapes are already at limit or empty", () => {
    const doc = setupDoc();
    const result = applyReorderShapes(doc, {
      type: COMMANDS.reorderShapes,
      ids: [shapeE],
      operation: REORDER_OPERATIONS.bringToFront,
    });

    expect(result.inverse).toEqual([]);
  });
});
