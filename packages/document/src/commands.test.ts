import { describe, expect, it } from "vitest";
import { DEVICE_TYPES, parseShapeId, STYLE_PROFILES } from "@open-draw/contracts";
import {
  applyTransaction,
  COMMANDS,
  createDocument,
  createPage,
  createRect,
  createTransaction,
  DocumentError,
} from "./index";

describe("document commands (milestone 05)", () => {
  const pageId = parseShapeId("page-1");
  const rectId = parseShapeId("rect-1");

  function createBaseDoc() {
    return createDocument([
      createPage(pageId, { x: 0, y: 0, width: 1000, height: 1000 }),
      createRect(rectId, { x: 10, y: 10, width: 100, height: 50 }, { parent: pageId }),
    ]);
  }

  it("applies SetRootStyle on root pages and inverts cleanly", () => {
    const doc = createBaseDoc();
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.setRootStyle,
          id: pageId,
          style: STYLE_PROFILES.minimal,
        },
      ]),
    );

    expect(result.document.shapes[pageId]?.meta.style).toBe(STYLE_PROFILES.minimal);

    const undone = applyTransaction(result.document, createTransaction(result.inverse));
    expect(undone.document.shapes[pageId]?.meta.style).toBeUndefined();
  });

  it("rejects SetRootStyle on non-root shapes (R-026)", () => {
    const doc = createBaseDoc();
    expect(() =>
      applyTransaction(
        doc,
        createTransaction([
          {
            type: COMMANDS.setRootStyle,
            id: rectId,
            style: STYLE_PROFILES.minimal,
          },
        ]),
      ),
    ).toThrow(DocumentError);
  });

  it("applies SetShapeHiddenOn and inverts cleanly", () => {
    const doc = createBaseDoc();
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.setShapeHiddenOn,
          id: rectId,
          hiddenOn: [DEVICE_TYPES.mobile, DEVICE_TYPES.tablet],
        },
      ]),
    );

    expect(result.document.shapes[rectId]?.meta.hiddenOn).toEqual([
      DEVICE_TYPES.mobile,
      DEVICE_TYPES.tablet,
    ]);

    const undone = applyTransaction(result.document, createTransaction(result.inverse));
    expect(undone.document.shapes[rectId]?.meta.hiddenOn).toBeUndefined();
  });

  it("applies SetShapeOrder and inverts cleanly", () => {
    const doc = createBaseDoc();
    const result = applyTransaction(
      doc,
      createTransaction([
        {
          type: COMMANDS.setShapeOrder,
          id: rectId,
          deviceType: DEVICE_TYPES.mobile,
          order: 3,
        },
      ]),
    );

    expect(result.document.shapes[rectId]?.meta.order[DEVICE_TYPES.mobile]).toBe(3);

    const undone = applyTransaction(result.document, createTransaction(result.inverse));
    expect(undone.document.shapes[rectId]?.meta.order[DEVICE_TYPES.mobile]).toBeUndefined();
  });

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

  it("updates and clears shape content with clean inverse (SetShapeContent)", () => {
    const pageId = parseShapeId("page-1");
    const rectId = parseShapeId("rect-1");
    const doc = createDocument([
      createPage(pageId, { x: 0, y: 0, width: 800, height: 600 }),
      createRect(rectId, { x: 10, y: 10, width: 100, height: 100 }, { parent: pageId }),
    ]);

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
      createPage(parseShapeId("p-neg"), { x: 0, y: 0, width: 100, height: -10 }),
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
});
