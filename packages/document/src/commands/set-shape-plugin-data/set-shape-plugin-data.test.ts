import { describe, expect, it } from "vitest";
import { type PluginId, parsePluginId, parseShapeId, ROOT_ID } from "@open-draw/contracts";
import { createDocument } from "../../document";
import { DocumentError } from "../../errors";
import { createRect } from "../../shape";
import { COMMANDS } from "../registry";
import { applySetShapePluginData } from "./index";
import { applyTransaction, createTransaction } from "../../transactions";

describe("SetShapePluginData command", () => {
  const shapeId = parseShapeId("rect-1");
  const pluginA = parsePluginId("open-draw:semantics");
  const pluginB = parsePluginId("vendor:analytics");

  function setupDoc() {
    const rect = createRect(
      shapeId,
      { x: 10, y: 10, width: 100, height: 100 },
      { parentId: ROOT_ID },
    );
    return createDocument([rect]);
  }

  it("sets new pluginData on a shape with exact inverse", () => {
    const doc = setupDoc();
    const data = { role: "button", variant: "primary" };

    const result = applySetShapePluginData(doc, {
      type: COMMANDS.setShapePluginData,
      id: shapeId,
      pluginId: pluginA,
      data,
    });

    const updated = result.document.shapes[shapeId];
    expect(updated).toBeDefined();
    expect(updated?.meta.pluginData?.[pluginA]).toEqual(data);
    expect(result.inverse).toEqual([
      {
        type: COMMANDS.setShapePluginData,
        id: shapeId,
        pluginId: pluginA,
        data: null,
      },
    ]);
  });

  it("updates existing pluginData and produces inverse that restores previous data", () => {
    const doc = setupDoc();
    const initialData = { role: "button" };
    const step1 = applySetShapePluginData(doc, {
      type: COMMANDS.setShapePluginData,
      id: shapeId,
      pluginId: pluginA,
      data: initialData,
    });

    const updatedData = { role: "card", elevated: true };
    const step2 = applySetShapePluginData(step1.document, {
      type: COMMANDS.setShapePluginData,
      id: shapeId,
      pluginId: pluginA,
      data: updatedData,
    });

    expect(step2.document.shapes[shapeId]?.meta.pluginData?.[pluginA]).toEqual(updatedData);
    expect(step2.inverse).toEqual([
      {
        type: COMMANDS.setShapePluginData,
        id: shapeId,
        pluginId: pluginA,
        data: initialData,
      },
    ]);
  });

  it("isolates different plugins under their respective namespaces", () => {
    const doc = setupDoc();
    const tx = createTransaction([
      {
        type: COMMANDS.setShapePluginData,
        id: shapeId,
        pluginId: pluginA,
        data: { tag: "heading" },
      },
      {
        type: COMMANDS.setShapePluginData,
        id: shapeId,
        pluginId: pluginB,
        data: { impressions: 42 },
      },
    ]);

    const txResult = applyTransaction(doc, tx);
    const shape = txResult.document.shapes[shapeId];
    expect(shape?.meta.pluginData?.[pluginA]).toEqual({ tag: "heading" });
    expect(shape?.meta.pluginData?.[pluginB]).toEqual({ impressions: 42 });

    // Undoing transaction reverses both
    const undoTx = createTransaction(txResult.inverse);
    const reverted = applyTransaction(txResult.document, undoTx);
    expect(reverted.document.shapes[shapeId]?.meta.pluginData).toBeUndefined();
  });

  it("removes plugin data when setting data to null", () => {
    const doc = setupDoc();
    const step1 = applySetShapePluginData(doc, {
      type: COMMANDS.setShapePluginData,
      id: shapeId,
      pluginId: pluginA,
      data: { tag: "nav" },
    });

    const step2 = applySetShapePluginData(step1.document, {
      type: COMMANDS.setShapePluginData,
      id: shapeId,
      pluginId: pluginA,
      data: null,
    });

    expect(step2.document.shapes[shapeId]?.meta.pluginData).toBeUndefined();
    expect(step2.inverse).toEqual([
      {
        type: COMMANDS.setShapePluginData,
        id: shapeId,
        pluginId: pluginA,
        data: { tag: "nav" },
      },
    ]);
  });

  it("preserves other meta fields (order, hiddenOn, etc.) untouched", () => {
    const rect = createRect(
      shapeId,
      { x: 0, y: 0, width: 50, height: 50 },
      {
        parentId: ROOT_ID,
        meta: {
          order: { desktop: 5 },
          hiddenOn: ["mobile"],
        },
      },
    );
    const doc = createDocument([rect]);

    const result = applySetShapePluginData(doc, {
      type: COMMANDS.setShapePluginData,
      id: shapeId,
      pluginId: pluginA,
      data: { key: "val" },
    });

    const shape = result.document.shapes[shapeId]!;
    expect(shape.meta.order).toEqual({ desktop: 5 });
    expect(shape.meta.hiddenOn).toEqual(["mobile"]);
    expect(shape.meta.pluginData?.[pluginA]).toEqual({ key: "val" });
  });

  it("throws DocumentError(shapeNotFound) if shape does not exist", () => {
    const doc = setupDoc();
    const missingId = parseShapeId("non-existent");
    expect(() =>
      applySetShapePluginData(doc, {
        type: COMMANDS.setShapePluginData,
        id: missingId,
        pluginId: pluginA,
        data: { test: true },
      }),
    ).toThrow(DocumentError);
  });

  it("throws loudly if pluginId is invalid syntax (R-006)", () => {
    const doc = setupDoc();
    expect(() =>
      applySetShapePluginData(doc, {
        type: COMMANDS.setShapePluginData,
        id: shapeId,
        pluginId: "invalid_unnamespaced" as unknown as PluginId,
        data: { test: true },
      }),
    ).toThrow(/parsePluginId/);
  });
});
