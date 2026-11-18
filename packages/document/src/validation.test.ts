import { describe, expect, it } from "vitest";
import { parseShapeId, ROOT_ID } from "@open-draw/contracts";
import type { Shape } from "./shape";
import { createEllipse, createGroup, createRect, createText } from "./shape";
import { DocumentError } from "./errors";
import { serializeDocument } from "./serialize-document";
import { parseDocument } from "./validation";

function serialize(shapes: readonly Shape[]): unknown {
  return JSON.parse(
    JSON.stringify({
      schema: { version: 1 },
      shapes: Object.fromEntries(shapes.map((shape) => [shape.id, shape])),
    }),
  );
}

const rootGroup = createGroup(parseShapeId("group-1"), { x: 0, y: 0, width: 1440, height: 900 });
const subGroup = createGroup(
  parseShapeId("group-2"),
  { x: 0, y: 0, width: 1400, height: 120 },
  {
    parentId: parseShapeId("group-1"),
  },
);
const rect = createRect(
  parseShapeId("rect-1"),
  { x: 10, y: 10, width: 200, height: 80 },
  {
    parentId: parseShapeId("group-2"),
    label: "Hero",
  },
);

describe("parseDocument", () => {
  it("parses a valid document and preserves shape data", () => {
    const document = parseDocument(serialize([rootGroup, subGroup, rect]));
    expect(document.schema.version).toBe(1);
    expect(document.shapes[parseShapeId("rect-1")]?.label).toBe("Hero");
    expect(document.shapes[parseShapeId("rect-1")]?.parentId).toBe("group-2");
  });

  it("rejects a schema with the wrong version", () => {
    const input = serialize([rootGroup]) as { schema: { version: number } };
    input.schema.version = 2;
    expect(() => parseDocument(input)).toThrow(DocumentError);
  });

  it("rejects an unknown kind", () => {
    const input = serialize([rootGroup]) as { shapes: Record<string, Record<string, unknown>> };
    input.shapes["group-1"]!.kind = "pentagon";
    expect(() => parseDocument(input)).toThrow(DocumentError);
  });

  it("rejects a record key that does not match the shape id", () => {
    const input = serialize([rootGroup]) as { shapes: Record<string, Record<string, unknown>> };
    input.shapes["wrong-key"] = input.shapes["group-1"]!;
    delete input.shapes["group-1"];
    expect(() => parseDocument(input)).toThrow(DocumentError);
  });

  it("rejects a parent chain that cycles", () => {
    const input = serialize([rootGroup, subGroup]) as {
      shapes: Record<string, Record<string, unknown>>;
    };
    input.shapes["group-1"]!.parentId = "group-2";
    delete input.shapes["group-1"]!.parent;
    expect(() => parseDocument(input)).toThrow(DocumentError);
  });

  it("allows structural hierarchy under any shape at the data layer", () => {
    const ellipse = createEllipse(
      parseShapeId("ellipse-1"),
      { x: 10, y: 10, width: 50, height: 50 },
      { parentId: parseShapeId("group-2") },
    );
    const nested = createRect(
      parseShapeId("rect-2"),
      { x: 0, y: 0, width: 10, height: 10 },
      {
        parentId: parseShapeId("ellipse-1"),
      },
    );
    const doc = parseDocument(serialize([rootGroup, subGroup, ellipse, nested]));
    expect(doc.shapes[parseShapeId("rect-2")]?.parentId).toBe("ellipse-1");
  });

  it("allows a nested rectangle to contain child shapes for N-level nesting", () => {
    const nested = createRect(
      parseShapeId("rect-2"),
      { x: 0, y: 0, width: 10, height: 10 },
      {
        parentId: parseShapeId("rect-1"),
      },
    );
    const doc = parseDocument(serialize([rootGroup, subGroup, rect, nested]));
    expect(doc.shapes[parseShapeId("rect-2")]?.parentId).toBe("rect-1");
  });

  it("accepts shapes parented directly to ROOT_ID as freestanding shapes on canvas", () => {
    const stray = createRect(
      parseShapeId("stray-1"),
      { x: 0, y: 0, width: 10, height: 10 },
      {
        parentId: ROOT_ID,
      },
    );
    const doc = parseDocument(serialize([stray]));
    expect(doc.shapes[parseShapeId("stray-1")]?.kind).toBe("rect");
    expect(doc.shapes[parseShapeId("stray-1")]?.parentId).toBe(ROOT_ID);
  });

  it("allows a root rectangle to contain child shapes", () => {
    const rootRect = createRect(
      parseShapeId("root-rect-1"),
      { x: 0, y: 0, width: 640, height: 480 },
      { parent: ROOT_ID },
    );
    const childRect = createRect(
      parseShapeId("child-rect-1"),
      { x: 10, y: 10, width: 100, height: 50 },
      { parent: parseShapeId("root-rect-1") },
    );
    const document = parseDocument(serialize([rootRect, childRect]));
    expect(document.shapes[parseShapeId("child-rect-1")]?.parentId).toBe("root-rect-1");
  });

  describe("document depth limits (Ruling V1, Task S2)", () => {
    function createNestedChain(depth: number): Shape[] {
      const shapes: Shape[] = [];
      const root = createGroup(parseShapeId("shape-1"), { x: 0, y: 0, width: 1000, height: 1000 });
      shapes.push(root);
      for (let i = 2; i <= depth; i++) {
        const parentId = parseShapeId(`shape-${i - 1}`);
        const shapeId = parseShapeId(`shape-${i}`);
        shapes.push(
          createGroup(
            shapeId,
            { x: 0, y: 0, width: 100, height: 100 },
            {
              parent: parentId,
            },
          ),
        );
      }
      return shapes;
    }

    it("rejects a document nested one level over the maximum (257 levels) with documentDepthExceeded (Ruling V1, Task S2)", () => {
      const chain = createNestedChain(257);
      const input = serialize(chain);
      let thrownError: unknown;
      try {
        parseDocument(input);
      } catch (err) {
        thrownError = err;
      }
      expect(thrownError).toBeInstanceOf(DocumentError);
      expect((thrownError as DocumentError).code).toBe("documentDepthExceeded");
    });

    it("loads and preserves a document at exactly the maximum depth (256 levels)", () => {
      const chain = createNestedChain(256);
      const input = serialize(chain);
      const doc = parseDocument(input);
      expect(Object.keys(doc.shapes)).toHaveLength(256);
      expect(doc.shapes[parseShapeId("shape-256")]?.parentId).toBe("shape-255");
      const serialized = serializeDocument(doc);
      const parsed = JSON.parse(serialized) as { shapes: Record<string, unknown> };
      expect(Object.keys(parsed.shapes)).toHaveLength(256);
    });

    it("rejects a 20,000-level document in under 1 second", () => {
      const shapes: Record<string, Record<string, unknown>> = {
        "shape-1": {
          id: "shape-1",
          kind: "group",
          parent: ROOT_ID,
          boundingBox: { x: 0, y: 0, width: 100, height: 100 },
          meta: {},
        },
      };
      for (let i = 2; i <= 20000; i++) {
        shapes[`shape-${i}`] = {
          id: `shape-${i}`,
          kind: "group",
          parent: `shape-${i - 1}`,
          boundingBox: { x: 0, y: 0, width: 100, height: 100 },
          meta: {},
        };
      }
      const start = Date.now();
      let thrownError: unknown;
      try {
        parseDocument({ schema: { version: 1 }, shapes });
      } catch (err) {
        thrownError = err;
      }
      const durationMs = Date.now() - start;

      expect(thrownError).toBeInstanceOf(DocumentError);
      expect((thrownError as DocumentError).code).toBe("documentDepthExceeded");
      expect(durationMs).toBeLessThan(1000);
    });
  });

  describe("shape colors and stroke width validation (F1, R-006)", () => {
    it("parses valid hex colors and positive strokeWidth", () => {
      const shapeWithStyle = createRect(
        parseShapeId("rect-styled"),
        { x: 10, y: 10, width: 100, height: 100 },
        { parent: parseShapeId("group-1"), fill: "#ff0000", stroke: "#00ff00", strokeWidth: 3 },
      );
      const doc = parseDocument(serialize([rootGroup, shapeWithStyle]));
      const parsedShape = doc.shapes[parseShapeId("rect-styled")];
      expect(parsedShape?.fill).toBe("#ff0000");
      expect(parsedShape?.stroke).toBe("#00ff00");
      expect(parsedShape?.strokeWidth).toBe(3);
    });

    it("rejects hostile or invalid fill color", () => {
      const input = serialize([rootGroup, rect]) as {
        shapes: Record<string, Record<string, unknown>>;
      };
      input.shapes["rect-1"]!.fill = '<script>alert("xss")</script>';
      expect(() => parseDocument(input)).toThrow(DocumentError);
    });

    it("rejects negative stroke width", () => {
      const input = serialize([rootGroup, rect]) as {
        shapes: Record<string, Record<string, unknown>>;
      };
      input.shapes["rect-1"]!.strokeWidth = -4;
      expect(() => parseDocument(input)).toThrow(DocumentError);
    });

    it("parses valid string content and rejects non-string content", () => {
      const shapeWithContent = createRect(
        parseShapeId("rect-content"),
        { x: 10, y: 10, width: 100, height: 100 },
        { parent: parseShapeId("group-1"), content: "Button Text" },
      );
      const doc = parseDocument(serialize([rootGroup, shapeWithContent]));
      const parsedShape = doc.shapes[parseShapeId("rect-content")];
      expect(parsedShape?.content).toBe("Button Text");

      const invalidInput = serialize([rootGroup, shapeWithContent]) as {
        shapes: Record<string, Record<string, unknown>>;
      };
      invalidInput.shapes["rect-content"]!.content = 12345;
      expect(() => parseDocument(invalidInput)).toThrow(DocumentError);
    });
  });

  describe("text shape validation", () => {
    it("parses valid text shape with default placeholder content", () => {
      const textShape = createText(
        parseShapeId("text-1"),
        { x: 100, y: 150, width: 120, height: 32 },
        { parentId: parseShapeId("group-1") },
      );
      expect(textShape.kind).toBe("text");
      expect(textShape.content).toBe("TEXT");

      const doc = parseDocument(serialize([rootGroup, textShape]));
      const parsed = doc.shapes[parseShapeId("text-1")];
      expect(parsed?.kind).toBe("text");
      expect(parsed?.content).toBe("TEXT");
      expect(parsed?.boundingBox).toEqual({ x: 100, y: 150, width: 120, height: 32 });
    });

    it("parses text shape with custom content and styling", () => {
      const textShape = createText(
        parseShapeId("text-custom"),
        { x: 50, y: 50, width: 200, height: 40 },
        { parentId: parseShapeId("group-1"), content: "Custom Title", stroke: "#2563eb" },
      );
      expect(textShape.content).toBe("Custom Title");

      const doc = parseDocument(serialize([rootGroup, textShape]));
      const parsed = doc.shapes[parseShapeId("text-custom")];
      expect(parsed?.content).toBe("Custom Title");
      expect(parsed?.stroke).toBe("#2563eb");
    });
  });

  describe("boundingBox dimension validation", () => {
    it("rejects non-positive or NaN boundingBox dimensions", () => {
      const invalidZeroWidth = serialize([rootGroup]) as {
        shapes: Record<
          string,
          { boundingBox: { width: number; height: number; x: number; y: number } }
        >;
      };
      invalidZeroWidth.shapes["group-1"]!.boundingBox.width = 0;
      expect(() => parseDocument(invalidZeroWidth)).toThrow(DocumentError);

      const invalidNegativeWidth = serialize([rootGroup]) as {
        shapes: Record<
          string,
          { boundingBox: { width: number; height: number; x: number; y: number } }
        >;
      };
      invalidNegativeWidth.shapes["group-1"]!.boundingBox.width = -50;
      expect(() => parseDocument(invalidNegativeWidth)).toThrow(DocumentError);

      const invalidNanHeight = serialize([rootGroup]) as {
        shapes: Record<
          string,
          { boundingBox: { width: number; height: number; x: number; y: number } }
        >;
      };
      invalidNanHeight.shapes["group-1"]!.boundingBox.height = NaN;
      expect(() => parseDocument(invalidNanHeight)).toThrow(DocumentError);
    });
  });

  describe("coordinate and dimension bounds validation (R-006, ADR-0002)", () => {
    it("rejects shapes with coordinates or dimensions exceeding MAX_COORDINATE_BOUND (100,000)", () => {
      const rectDirect = createRect(
        parseShapeId("rect-direct"),
        { x: 10, y: 10, width: 200, height: 80 },
        { parentId: parseShapeId("group-1") },
      );
      const input = serialize([rootGroup, rectDirect]) as {
        shapes: Record<
          string,
          { boundingBox?: { x: number; y: number; width: number; height: number } }
        >;
      };
      input.shapes["rect-direct"]!.boundingBox = { x: 1e300, y: 0, width: 100, height: 100 };
      expect(() => parseDocument(input)).toThrowError(/boundingBox/);

      input.shapes["rect-direct"]!.boundingBox = { x: 0, y: 0, width: 100_001, height: 100 };
      expect(() => parseDocument(input)).toThrowError(/boundingBox/);
    });
  });

  describe("fillStyle validation (R-005, R-006)", () => {
    it("accepts valid fillStyle values and rejects invalid values", () => {
      const validDoc = serialize([
        rootGroup,
        createRect(
          parseShapeId("rect-fill"),
          { x: 10, y: 10, width: 100, height: 50 },
          { parentId: parseShapeId("group-1"), fillStyle: "none" },
        ),
      ]);
      const parsed = parseDocument(validDoc);
      expect(parsed.shapes[parseShapeId("rect-fill")]?.fillStyle).toBe("none");

      const invalidDoc = serialize([
        rootGroup,
        createRect(
          parseShapeId("rect-fill-bad"),
          { x: 10, y: 10, width: 100, height: 50 },
          { parentId: parseShapeId("group-1") },
        ),
      ]) as { shapes: Record<string, Record<string, unknown>> };
      invalidDoc.shapes["rect-fill-bad"]!.fillStyle = "stripes";
      expect(() => parseDocument(invalidDoc)).toThrowError(/fillStyle must be one of/);
    });
  });

  describe("document envelope limits (P0-3)", () => {
    it("rejects documents with shapes exceeding MAX_DOCUMENT_SHAPE_COUNT", () => {
      const hostileShapes: Record<string, unknown> = {};
      for (let i = 0; i <= 10_000; i += 1) {
        hostileShapes[`rect-${i}`] = {
          id: `rect-${i}`,
          kind: "rect",
          parentId: ROOT_ID,
          boundingBox: { x: 0, y: 0, width: 100, height: 100 },
          meta: {},
        };
      }
      const hostileDoc = {
        schema: { version: 1 },
        shapes: hostileShapes,
      };
      expect(() => parseDocument(hostileDoc)).toThrowError(/exceeds maximum allowed shapes/);
    });

    it("rejects pen path with points exceeding MAX_PEN_PATH_POINTS", () => {
      const points = Array.from({ length: 2_001 }, (_, i) => ({ x: i, y: i }));
      const hostileDoc = serialize([
        rootGroup,
        {
          id: parseShapeId("pen-huge"),
          kind: "pen-path" as const,
          parentId: parseShapeId("group-1"),
          boundingBox: { x: 0, y: 0, width: 100, height: 100 },
          points,
          meta: {},
        },
      ]);
      expect(() => parseDocument(hostileDoc)).toThrowError(/exceeds maximum allowed points/);
    });
  });

  describe("prototype pollution guards (P2-10)", () => {
    it("rejects __proto__ and constructor property injection in meta", () => {
      const hostileMeta = JSON.parse('{"__proto__":{"polluted":true}}');
      const hostileDoc = {
        schema: { version: 1 },
        shapes: {
          "rect-proto": {
            id: "rect-proto",
            kind: "rect",
            parentId: ROOT_ID,
            boundingBox: { x: 0, y: 0, width: 100, height: 100 },
            meta: hostileMeta,
          },
        },
      };
      expect(() => parseDocument(hostileDoc)).toThrowError(/invalidMeta/);
    });

    it("rejects __proto__ and constructor property injection in customData", () => {
      const hostileCustomData = JSON.parse('{"valid":123, "__proto__":{"polluted":true}}');
      const hostileDoc = {
        schema: { version: 1 },
        shapes: {
          "custom-proto": {
            id: "custom-proto",
            kind: "vendor:custom",
            parentId: ROOT_ID,
            boundingBox: { x: 0, y: 0, width: 100, height: 100 },
            customData: hostileCustomData,
            meta: {},
          },
        },
      };
      expect(() => parseDocument(hostileDoc)).toThrowError(/invalidDocument/);
    });
  });
});
