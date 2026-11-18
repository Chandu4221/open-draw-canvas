import { describe, expect, it } from "vitest";
import { isRootId, parseShapeId } from "@open-draw/contracts";
import {
  applyTransaction,
  COMMANDS,
  createDocument,
  createGroup,
  createRect,
  createTransaction,
  DocumentError,
  parseDocument,
  serializeDocument,
} from "./index";

describe("DuplicateShapes command (F5, ADR-0006 Option A)", () => {
  const rootGroupId = parseShapeId("group-root");
  const childGroupId = parseShapeId("group-child");
  const rectId = parseShapeId("rect-1");

  function createTestDoc() {
    return createDocument([
      createGroup(rootGroupId, { x: 0, y: 0, width: 800, height: 600 }),
      createGroup(
        childGroupId,
        { x: 50, y: 50, width: 300, height: 200 },
        {
          parent: rootGroupId,
        },
      ),
      createRect(
        rectId,
        { x: 10, y: 10, width: 100, height: 50 },
        {
          parent: childGroupId,
          label: "MyButton",
          fill: "#ff0000",
          stroke: "#000000",
          strokeWidth: 2,
          content: "Click me",
        },
      ),
    ]);
  }

  it("duplicates a single leaf shape with offset dx/dy", () => {
    const doc = createTestDoc();
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.duplicateShapes,
          ids: [rectId],
          dx: 20,
          dy: 30,
        },
      ]),
    );

    const shapes = Object.values(result.document.shapes);
    expect(shapes.length).toBe(4);

    const dup = shapes.find(
      (s) => s.id !== rootGroupId && s.id !== childGroupId && s.id !== rectId,
    );
    expect(dup).toBeDefined();
    expect(dup?.parentId).toBe(childGroupId);
    expect(dup?.kind).toBe("rect");
    expect(dup?.boundingBox).toEqual({ x: 30, y: 40, width: 100, height: 50 });
    expect(dup?.label).toBe("MyButton");
    expect(dup?.fill).toBe("#ff0000");
    expect(dup?.stroke).toBe("#000000");
    expect(dup?.strokeWidth).toBe(2);
    expect(dup?.content).toBe("Click me");

    // Must pass full document validation (no cycles, valid ids, etc.)
    expect(() => parseDocument(serializeDocument(result.document))).not.toThrow();
  });

  it("duplicates a root group with nested children, preserving subtree structure", () => {
    const doc = createTestDoc();
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.duplicateShapes,
          ids: [rootGroupId],
          dx: 50,
          dy: 50,
        },
      ]),
    );

    // Original had 3 shapes (root group, child group, rect). Duplicating root group duplicates all 3 -> 6 shapes.
    const shapes = Object.values(result.document.shapes);
    expect(shapes.length).toBe(6);

    const newRootGroups = shapes.filter(
      (s) => s.kind === "group" && s.id !== rootGroupId && isRootId(s.parentId),
    );
    expect(newRootGroups.length).toBe(1);
    const newRootGroup = newRootGroups[0]!;
    expect(newRootGroup.boundingBox).toEqual({ x: 50, y: 50, width: 800, height: 600 });

    const newChildGroups = shapes.filter(
      (s) => s.kind === "group" && s.id !== childGroupId && s.parentId === newRootGroup.id,
    );
    expect(newChildGroups.length).toBe(1);
    const newChildGroup = newChildGroups[0]!;
    expect(newChildGroup.boundingBox).toEqual({ x: 50, y: 50, width: 300, height: 200 });

    const newRects = shapes.filter((s) => s.kind === "rect" && s.id !== rectId);
    expect(newRects.length).toBe(1);
    const newRect = newRects[0]!;
    expect(newRect.parentId).toBe(newChildGroup.id);
    expect(newRect.boundingBox).toEqual({ x: 10, y: 10, width: 100, height: 50 });

    expect(() => parseDocument(serializeDocument(result.document))).not.toThrow();
  });

  it("prunes selected descendants so children are not duplicated twice if both parent and child are selected", () => {
    const doc = createTestDoc();
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.duplicateShapes,
          ids: [rootGroupId, childGroupId, rectId],
          dx: 20,
          dy: 20,
        },
      ]),
    );

    // Exactly 3 new shapes created (2 groups + 1 rect), total 6
    expect(Object.keys(result.document.shapes).length).toBe(6);
    expect(() => parseDocument(serializeDocument(result.document))).not.toThrow();
  });

  it("supports user-provided newShapeIds map", () => {
    const doc = createTestDoc();
    const customId = parseShapeId("custom-dup-1");
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.duplicateShapes,
          ids: [rectId],
          newShapeIds: { [rectId]: customId },
        },
      ]),
    );

    expect(result.document.shapes[customId]).toBeDefined();
    expect(result.document.shapes[customId]?.label).toBe("MyButton");
  });

  it("undo cleanly removes all duplicated shapes in one step, redo restores them", () => {
    const doc = createTestDoc();
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.duplicateShapes,
          ids: [rootGroupId],
          dx: 30,
          dy: 30,
        },
      ]),
    );

    expect(Object.keys(result.document.shapes).length).toBe(6);

    // Undo removes all 3 duplicated shapes
    const undone = applyTransaction(result.document, createTransaction(result.inverse));
    expect(Object.keys(undone.document.shapes).length).toBe(3);
    expect(undone.document.shapes[rootGroupId]).toBeDefined();
    expect(undone.document.shapes[childGroupId]).toBeDefined();
    expect(undone.document.shapes[rectId]).toBeDefined();
    expect(() => parseDocument(serializeDocument(undone.document))).not.toThrow();

    // Redo restores all 3 duplicated shapes
    const redone = applyTransaction(undone.document, createTransaction(undone.inverse));
    expect(Object.keys(redone.document.shapes).length).toBe(6);
    expect(() => parseDocument(serializeDocument(redone.document))).not.toThrow();
  });

  it("throws DocumentError when shape id does not exist", () => {
    const doc = createTestDoc();
    expect(() =>
      applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.duplicateShapes,
            ids: [parseShapeId("non-existent")],
          },
        ]),
      ),
    ).toThrow(DocumentError);
  });
});
