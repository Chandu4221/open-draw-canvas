import { describe, expect, it, vi } from "vitest";
import {
  type CustomShapeKind,
  FILL_STYLES,
  MAX_DOCUMENT_DEPTH,
  parseCustomShapeKind,
  parseShapeId,
  ROOT_ID,
} from "@open-draw/contracts";
import {
  createCustomShape,
  createDocument,
  createGroup,
  createLine,
  createPenPath,
  createRect,
  createText,
  type Shape,
} from "@open-draw/document";
import {
  CRAYON_SHAPE_RENDERERS,
  documentToSvg,
  fallbackShapeToSvg,
  previewLineToSvg,
  previewPenPathToSvg,
  renderSingleShapeSvg,
  selectionOverlayToSvg,
  type RendererFallbackEvent,
} from "./index";

describe("documentToSvg", () => {
  it("renders built-in line and pen-path shapes", () => {
    const lineId = parseShapeId("line-1");
    const penId = parseShapeId("pen-1");

    const doc = createDocument([
      createLine(
        lineId,
        { x: 10, y: 20, width: 100, height: 50 },
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ),
      createPenPath(penId, { x: 50, y: 50, width: 80, height: 80 }, [
        { x: 0, y: 0 },
        { x: 40, y: 80 },
        { x: 80, y: 0 },
      ]),
    ]);

    const svg = documentToSvg(doc);
    expect(svg).toContain("<line");
    expect(svg).toContain('x1="10"');
    expect(svg).toContain('x2="110"');
    expect(svg).toContain("<polyline");
    expect(svg).toContain('points="50,50 90,130 130,50"');
  });

  it("wraps shape with data-shape-id when wrapShapeId option is true", () => {
    const rectId = parseShapeId("rect-1");
    const rectShape = createRect(rectId, { x: 10, y: 20, width: 100, height: 50 });
    const doc = createDocument([rectShape]);

    const svg = documentToSvg(doc, { wrapShapeId: true });
    expect(svg).toContain(`<g data-shape-id="${rectId}">`);
    expect(svg).toContain("<rect");

    const singleSvg = renderSingleShapeSvg(doc, rectShape, { wrapShapeId: true });
    expect(singleSvg).toBe(
      `<g data-shape-id="${rectId}"><rect x="10" y="20" width="100" height="50" fill="#ffffff" stroke="#1f2933" /></g>`,
    );
  });

  it("renders defined fallback dashed box and fires onFallback for unregistered shape kind (ADR-0003 D3)", () => {
    const starId = parseShapeId("star-1");
    const starKind = parseCustomShapeKind("vendor:star");

    const doc = createDocument([
      createCustomShape(starId, starKind, { x: 20, y: 30, width: 100, height: 100 }),
    ]);

    const fallbackEvents: RendererFallbackEvent[] = [];
    const svg = documentToSvg(doc, {
      onFallback: (event) => fallbackEvents.push(event),
    });

    // Fallback renders neutral dashed rect + label, never throws
    expect(svg).toContain('stroke-dasharray="4 4"');
    expect(svg).toContain("[vendor:star]");
    expect(fallbackEvents).toEqual([{ shapeId: starId, kind: "vendor:star" }]);
  });

  it("allows customRenderers override", () => {
    const starId = parseShapeId("star-1");
    const starKind = parseCustomShapeKind("vendor:star");

    const doc = createDocument([
      createCustomShape(starId, starKind, { x: 20, y: 30, width: 100, height: 100 }),
    ]);

    const onFallback = vi.fn();
    const svg = documentToSvg(doc, {
      customRenderers: {
        "vendor:star": (_shape, box) =>
          `<path d="M ${box.x} ${box.y} L 100 100" class="custom-star" />`,
      },
      onFallback,
    });

    expect(svg).toContain('class="custom-star"');
    expect(onFallback).not.toHaveBeenCalled();
  });
});

describe("gesture previews", () => {
  it("renders line preview from start to end", () => {
    const svg = previewLineToSvg({ x: 10, y: 20 }, { x: 100, y: 200 });
    expect(svg).toContain('<line x1="10" y1="20" x2="100" y2="200"');
  });

  it("renders pen path preview through points", () => {
    const svg = previewPenPathToSvg([
      { x: 0, y: 0 },
      { x: 10, y: 15 },
      { x: 20, y: 30 },
    ]);
    expect(svg).toContain('points="0,0 10,15 20,30"');
  });
});

describe("crayon render style (ADR-0005 D3, R-021)", () => {
  it("renders deterministic byte-identical SVG for the same shape across calls", () => {
    const rectId = parseShapeId("rect-1");
    const doc = createDocument([createRect(rectId, { x: 50, y: 60, width: 200, height: 100 })]);

    const run1 = documentToSvg(doc, { customRenderers: CRAYON_SHAPE_RENDERERS });
    const run2 = documentToSvg(doc, { customRenderers: CRAYON_SHAPE_RENDERERS });

    expect(run1).toBe(run2);
    expect(run1).toContain("<path");
    expect(run1).toContain('stroke="#2d3748"');
  });

  it("falls back to standard renderer for custom shape kinds without custom renderer", () => {
    const starId = parseShapeId("star-1");
    const starKind = parseCustomShapeKind("vendor:star");
    const doc = createDocument([
      createCustomShape(starId, starKind, { x: 10, y: 10, width: 80, height: 80 }),
    ]);

    const svg = documentToSvg(doc, { customRenderers: CRAYON_SHAPE_RENDERERS });
    expect(svg).toContain("[vendor:star]");
  });
});

describe("fallback shape escaping", () => {
  it("escapes hostile XML/HTML characters in fallback shape kinds", () => {
    const hostileShape = {
      id: parseShapeId("hostile-1"),
      kind: 'vendor:<script>alert("xss")</script>' as unknown as CustomShapeKind,
      parentId: ROOT_ID,
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      meta: {},
    } as unknown as Shape;
    const box = { x: 0, y: 0, width: 100, height: 100 };
    const svg = fallbackShapeToSvg(hostileShape, box);

    expect(svg).not.toContain("<script>");
    expect(svg).toContain("[vendor:&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;]");
  });

  it("safely renders document nested to MAX_DOCUMENT_DEPTH without stack overflow", () => {
    const shapes: Shape[] = [];
    const rootGroupId = parseShapeId("group-root");
    shapes.push(createGroup(rootGroupId, { x: 0, y: 0, width: 1000, height: 1000 }));

    let parentId = rootGroupId;
    // We add MAX_DOCUMENT_DEPTH - 1 nested rects, so total depth is MAX_DOCUMENT_DEPTH (256)
    for (let i = 1; i < MAX_DOCUMENT_DEPTH; i++) {
      const childId = parseShapeId(`rect-${i}`);
      shapes.push(createRect(childId, { x: 0, y: 0, width: 10, height: 10 }, { parent: parentId }));
      parentId = childId;
    }

    const doc = createDocument(shapes);
    const svg = documentToSvg(doc);
    expect(typeof svg).toBe("string");
    // Should render 255 child rects
    expect(svg.match(/<rect/g)?.length).toBe(MAX_DOCUMENT_DEPTH - 1);
  });
});

describe("selectionOverlayToSvg", () => {
  it("renders 1 outline rect and 8 handle rects (4 corners + 4 edge midpoints)", () => {
    const overlay = selectionOverlayToSvg({ x: 10, y: 10, width: 100, height: 60 }, 1);
    // 1 outline rect + 8 handle rects = 9 rects
    expect(overlay.match(/<rect/g)?.length).toBe(9);
  });
});

describe("shape styling (fill, stroke, strokeWidth) (F1, ADR-0006 Option A)", () => {
  it("renders custom fill, stroke, and stroke-width on rect and ellipse", () => {
    const rectId = parseShapeId("rect-styled");
    const doc = createDocument([
      createRect(
        rectId,
        { x: 10, y: 20, width: 100, height: 50 },
        { fill: "#3b82f6", stroke: "#1e3a8a", strokeWidth: 4 },
      ),
    ]);

    const svg = documentToSvg(doc);
    expect(svg).toContain('fill="#3b82f6"');
    expect(svg).toContain('stroke="#1e3a8a"');
    expect(svg).toContain('stroke-width="4"');
  });

  it("renders default attributes when shape style properties are undefined", () => {
    const rectId = parseShapeId("rect-default");
    const doc = createDocument([createRect(rectId, { x: 10, y: 20, width: 100, height: 50 })]);

    const svg = documentToSvg(doc);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('stroke="#1f2933"');
    expect(svg).not.toContain("stroke-width");
  });

  it("escapes hostile XML in color attributes", () => {
    const hostileRect = {
      ...createRect(parseShapeId("rect-1"), { x: 0, y: 0, width: 100, height: 100 }),
      fill: '#ffffff" onload="alert(1)',
      stroke: '#000000" onerror="alert(2)',
    } as unknown as Shape;
    const doc = createDocument([hostileRect]);
    const svg = documentToSvg(doc);

    expect(svg).not.toContain('onload="alert(1)"');
    expect(svg).toContain('fill="#ffffff&quot; onload=&quot;alert(1)"');
  });
});

describe("visible text on shapes (F2, ADR-0006 Option A / shape.content)", () => {
  it("renders centered clipped text when shape.content is present", () => {
    const rectId = parseShapeId("rect-with-content");
    const doc = createDocument([
      createRect(
        rectId,
        { x: 100, y: 200, width: 200, height: 100 },
        { label: "Submit Button Layer", content: "Submit Form" },
      ),
    ]);

    const svg = documentToSvg(doc);
    expect(svg).toContain('<clipPath id="clip-rect-with-content">');
    expect(svg).toContain('<rect x="100" y="200" width="200" height="100"');
    expect(svg).toContain('x="200"'); // 100 + 200/2
    expect(svg).toContain('y="250"'); // 200 + 100/2
    expect(svg).toContain('dominant-baseline="central"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('clip-path="url(#clip-rect-with-content)"');
    expect(svg).toContain(">Submit Form</text>");
    expect(svg).not.toContain(">Submit Button Layer</text>");
  });

  it("escapes hostile XML in shape.content", () => {
    const rectId = parseShapeId("rect-xss");
    const doc = createDocument([
      createRect(
        rectId,
        { x: 50, y: 50, width: 100, height: 50 },
        { content: '<script>alert("xss")</script> & "quotes"' },
      ),
    ]);

    const svg = documentToSvg(doc);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;</text>",
    );
  });

  it("does not render clipPath or text when shape has only label and no content", () => {
    const rectId = parseShapeId("rect-label-only");
    const doc = createDocument([
      createRect(rectId, { x: 10, y: 10, width: 100, height: 50 }, { label: "Profile Box" }),
    ]);

    const svg = documentToSvg(doc);
    expect(svg).not.toContain("<clipPath");
    expect(svg).not.toContain("<text");
  });

  it("does not render clipPath or text when shape.content is absent or empty", () => {
    const rectId = parseShapeId("rect-no-content");
    const doc = createDocument([createRect(rectId, { x: 10, y: 10, width: 100, height: 50 })]);

    const svg = documentToSvg(doc);
    expect(svg).not.toContain("<clipPath");
    expect(svg).not.toContain("<text");
  });

  it("renders standalone text shape with placeholder text and transparent background", () => {
    const textId = parseShapeId("text-standalone");
    const doc = createDocument([createText(textId, { x: 200, y: 100, width: 120, height: 32 })]);

    const svg = documentToSvg(doc);
    expect(svg.startsWith('<defs><clipPath id="clip-text-standalone">')).toBe(true);
    expect(svg).toContain('fill="none"');
    expect(svg).not.toContain('fill="#ffffff"');
    expect(svg).toContain('<clipPath id="clip-text-standalone">');
    expect(svg).toContain('x="260"'); // 200 + 120/2
    expect(svg).toContain('y="116"'); // 100 + 32/2
    expect(svg).toContain('pointer-events="none"');
    expect(svg).toContain('user-select="none"');
    expect(svg).toContain(">TEXT</text>");
  });

  it("renders visible text with pointer-events none and user-select none to prevent I-beam cursor and allow vector selection", () => {
    const rectId = parseShapeId("rect-btn");
    const doc = createDocument([
      createRect(rectId, { x: 50, y: 50, width: 100, height: 40 }, { content: "Click Me" }),
    ]);
    const svg = documentToSvg(doc);
    expect(svg).toContain('<text x="100" y="70"');
    expect(svg).toContain('pointer-events="none"');
    expect(svg).toContain('user-select="none"');
  });

  it("filters shapes when visibleShapeIds is provided while preserving stacking order", () => {
    const s1 = parseShapeId("shape-1");
    const s2 = parseShapeId("shape-2");
    const s3 = parseShapeId("shape-3");
    const doc = createDocument([
      createRect(s1, { x: 0, y: 0, width: 50, height: 50 }),
      createRect(s2, { x: 100, y: 100, width: 50, height: 50 }),
      createRect(s3, { x: 200, y: 200, width: 50, height: 50 }),
    ]);

    const svg = documentToSvg(doc, {
      visibleShapeIds: new Set([s1, s3]),
    });

    expect(svg).toContain('width="50" height="50"');
    // s1 and s3 should be rendered, s2 must be culled
    expect(svg).toContain('x="0" y="0"');
    expect(svg).not.toContain('x="100" y="100"');
    expect(svg).toContain('x="200" y="200"');
  });

  describe("shape fillStyle rendering (R-005, R-021)", () => {
    it("renders fill=none for fillStyle=none (transparent background)", () => {
      const rectId = parseShapeId("rect-transparent");
      const doc = createDocument([
        createRect(
          rectId,
          { x: 10, y: 20, width: 100, height: 50 },
          { fillStyle: FILL_STYLES.none },
        ),
      ]);
      const svg = documentToSvg(doc);
      expect(svg).toContain(
        '<rect x="10" y="20" width="100" height="50" fill="none" stroke="#1f2933" />',
      );
    });

    it("renders fill-opacity=0.1 for fillStyle=subtle", () => {
      const rectId = parseShapeId("rect-subtle");
      const doc = createDocument([
        createRect(
          rectId,
          { x: 10, y: 20, width: 100, height: 50 },
          { fillStyle: FILL_STYLES.subtle },
        ),
      ]);
      const svg = documentToSvg(doc);
      expect(svg).toContain('fill="#1f2933" stroke="#1f2933" fill-opacity="0.1"');
    });

    it("renders solid fill for fillStyle=solid", () => {
      const rectId = parseShapeId("rect-solid");
      const doc = createDocument([
        createRect(
          rectId,
          { x: 10, y: 20, width: 100, height: 50 },
          { fillStyle: FILL_STYLES.solid, fill: "#3b82f6" },
        ),
      ]);
      const svg = documentToSvg(doc);
      expect(svg).toContain('fill="#3b82f6" stroke="#1f2933"');
    });

    it("renders SVG pattern defs and fill=url(#...) for fillStyle=hatch", () => {
      const rectId = parseShapeId("rect-hatch");
      const doc = createDocument([
        createRect(
          rectId,
          { x: 10, y: 20, width: 100, height: 50 },
          { fillStyle: FILL_STYLES.hatch, stroke: "#ef4444" },
        ),
      ]);
      const svg = documentToSvg(doc, { instanceId: "inst1" });
      expect(svg).toContain('<defs><pattern id="od-pattern-hatch-inst1-rect-hatch"');
      expect(svg).toContain('patternTransform="rotate(45 0 0)"');
      expect(svg).toContain('stroke="#ef4444"');
      expect(svg).toContain('fill="url(#od-pattern-hatch-inst1-rect-hatch)"');
    });

    it("renders fillStyle in crayon / hand-drawn mode (R-021)", () => {
      const rectId = parseShapeId("rect-crayon-transp");
      const doc = createDocument([
        createRect(
          rectId,
          { x: 10, y: 20, width: 100, height: 50 },
          { fillStyle: FILL_STYLES.none },
        ),
      ]);
      const svg = documentToSvg(doc, { customRenderers: CRAYON_SHAPE_RENDERERS });
      expect(svg).toContain('fill="none"');
    });
  });
});
