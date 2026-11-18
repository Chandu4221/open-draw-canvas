import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_VALUES,
  isValidCustomShapeKind,
  isValidPluginId,
  MAX_DOCUMENT_DEPTH,
  MAX_HISTORY_DEPTH,
  MAX_DOCUMENT_SHAPE_COUNT,
  MAX_PEN_PATH_POINTS,
  MAX_DOCUMENT_BYTE_SIZE,
  parseCustomShapeKind,
  parsePluginId,
  SHAPE_KINDS,
  SHAPE_KIND_LABELS,
  SHAPE_KIND_VALUES,
  FILL_STYLES,
  FILL_STYLE_VALUES,
  SPATIAL_SCOPES,
} from "./index";

describe("capabilities", () => {
  it("exposes all defined capability identifiers", () => {
    expect(CAPABILITIES.resizable).toBe("resizable");
    expect(CAPABILITIES.movable).toBe("movable");
    expect(CAPABILITIES.textLabel).toBe("text-label");
    expect(CAPABILITIES.freehandPath).toBe("freehand-path");
    expect(CAPABILITY_VALUES.has("resizable")).toBe(true);
    expect(CAPABILITY_VALUES.has("unknown")).toBe(false);
  });
});

describe("plugin-contract", () => {
  it("validates well-formed plugin ids", () => {
    expect(isValidPluginId("vendor:my-plugin")).toBe(true);
    expect(isValidPluginId("custom-scope:tool-123")).toBe(true);
    expect(parsePluginId("vendor:my-plugin")).toBe("vendor:my-plugin");
  });

  it("rejects malformed plugin ids with loud error", () => {
    expect(isValidPluginId("no-colon")).toBe(false);
    expect(isValidPluginId("Uppercase:Plugin")).toBe(false);
    expect(isValidPluginId("")).toBe(false);
    expect(() => parsePluginId("invalid")).toThrow(/invalid plugin id/);
  });
});

describe("shape-kinds", () => {
  it("includes line and pen-path in built-in shape kinds and labels", () => {
    expect(SHAPE_KINDS.line).toBe("line");
    expect(SHAPE_KINDS.penPath).toBe("pen-path");
    expect(SHAPE_KIND_LABELS.line).toBe("Line");
    expect(SHAPE_KIND_LABELS["pen-path"]).toBe("Pen Path");
    expect(SHAPE_KIND_VALUES.has("line")).toBe(true);
    expect(SHAPE_KIND_VALUES.has("pen-path")).toBe(true);
  });

  it("includes text in built-in shape kinds and labels", () => {
    expect(SHAPE_KINDS.text).toBe("text");
    expect(SHAPE_KIND_LABELS.text).toBe("Text");
    expect(SHAPE_KIND_VALUES.has("text")).toBe(true);
  });

  it("validates namespaced custom shape kinds", () => {
    expect(isValidCustomShapeKind("vendor:star")).toBe(true);
    expect(isValidCustomShapeKind("open-draw:cloud")).toBe(true);
    expect(isValidCustomShapeKind("plain-name")).toBe(false);
    expect(isValidCustomShapeKind("vendor:Star")).toBe(false);
    expect(parseCustomShapeKind("vendor:star")).toBe("vendor:star");
    expect(() => parseCustomShapeKind("invalid")).toThrow(/invalid custom shape kind/);
  });
});

describe("document-limits", () => {
  it("exposes MAX_DOCUMENT_DEPTH as 256 per Ruling V1", () => {
    expect(MAX_DOCUMENT_DEPTH).toBe(256);
  });

  it("exposes MAX_HISTORY_DEPTH as 100 to prevent unbounded history growth", () => {
    expect(MAX_HISTORY_DEPTH).toBe(100);
  });

  it("exposes document envelope limits (MAX_DOCUMENT_SHAPE_COUNT, MAX_PEN_PATH_POINTS, MAX_DOCUMENT_BYTE_SIZE)", () => {
    expect(MAX_DOCUMENT_SHAPE_COUNT).toBe(10_000);
    expect(MAX_PEN_PATH_POINTS).toBe(2_000);
    expect(MAX_DOCUMENT_BYTE_SIZE).toBe(10 * 1024 * 1024);
  });
});

it("includes group in built-in shape kinds and labels", () => {
  expect(SHAPE_KINDS.group).toBe("group");
  expect(SHAPE_KIND_LABELS.group).toBe("Group");
  expect(SHAPE_KIND_VALUES.has("group")).toBe(true);
});

describe("fill-styles", () => {
  it("exposes closed registry of shape fill styles (R-005, R-007)", () => {
    expect(FILL_STYLES.none).toBe("none");
    expect(FILL_STYLES.subtle).toBe("subtle");
    expect(FILL_STYLES.solid).toBe("solid");
    expect(FILL_STYLES.hatch).toBe("hatch");
    expect(FILL_STYLE_VALUES.has("none")).toBe(true);
    expect(FILL_STYLE_VALUES.has("subtle")).toBe(true);
    expect(FILL_STYLE_VALUES.has("solid")).toBe(true);
    expect(FILL_STYLE_VALUES.has("hatch")).toBe(true);
    expect(FILL_STYLE_VALUES.has("unknown")).toBe(false);
  });
});

describe("spatial-contracts", () => {
  it("exposes closed registry of spatial scopes (R-005, R-007)", () => {
    expect(SPATIAL_SCOPES.siblings).toBe("siblings");
    expect(SPATIAL_SCOPES.all).toBe("all");
  });
});
