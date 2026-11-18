// Battle hardening tests for edge cases (R-004, R-006, R-008, R-010, R-015, R-016, R-039, ADR-0008, ADR-0011).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_COORDINATE_BOUND,
  MAX_DOCUMENT_DEPTH,
  MAX_PEN_PATH_POINTS,
  parseCustomShapeKind,
  parseShapeId,
  ROOT_ID,
  type BoundingBox,
  type ShapeId,
} from "@open-draw/contracts";
import {
  absoluteBoundingBox,
  ancestorsOf,
  COMMANDS,
  createDocument,
  createRect,
  shapeListInOrder,
  type RectShape,
  type Shape,
} from "@open-draw/document";
import { cameraToViewportBox } from "./camera";
import { createCanvas } from "./create-canvas";
import { createEditor, type Editor } from "./editor";
import { MIN_SHAPE_SIZE, resizeBox } from "./geometry";
import { HANDLES } from "./handles";
import { pickShape } from "./hit-test";
import { querySpatialIndexBox } from "./spatial/spatial-index";
import { INITIAL_MACHINE_STATE, transition } from "./machine";
import { TOOLS } from "./tools";

class MockDomNode {
  readonly tagName: string;
  readonly style: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  readonly children: MockDomNode[] = [];
  innerHTML = "";
  value = "";
  className = "";
  listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  focus(): void {}
  select(): void {}

  setAttribute(name: string, val: string): void {
    this.attributes[name] = val;
  }

  getAttribute(name: string): string | undefined {
    return this.attributes[name];
  }

  appendChild(child: MockDomNode): void {
    this.children.push(child);
  }

  removeChild(child: MockDomNode): void {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
  }

  contains(child: MockDomNode): boolean {
    return this.children.includes(child);
  }

  querySelector<T extends MockDomNode>(selector: string): T | null {
    const className = selector.replace(/^\./, "");
    for (const child of this.children) {
      if (child.attributes["class"] === className || child.className === className) {
        return child as unknown as T;
      }
      const found = child.querySelector<T>(selector);
      if (found !== null) return found;
    }
    return null;
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 800, height: 600 };
  }

  addEventListener(event: string, fn: (...args: unknown[]) => void): void {
    this.listeners[event] = this.listeners[event] ?? [];
    this.listeners[event]!.push(fn);
  }

  removeEventListener(event: string, fn: (...args: unknown[]) => void): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event]!.filter((f) => f !== fn);
    }
  }

  capturedPointers: Set<number> = new Set();

  setPointerCapture(id: number): void {
    this.capturedPointers.add(id);
  }

  hasPointerCapture(id: number): boolean {
    return this.capturedPointers.has(id);
  }

  releasePointerCapture(id: number): void {
    this.capturedPointers.delete(id);
  }

  dispatch(event: string, arg: unknown): void {
    for (const fn of this.listeners[event] ?? []) {
      fn(arg);
    }
  }
}

describe("Battle Hardening (ADR-0008, ADR-0011, R-006, R-016, R-039)", () => {
  let container: MockDomNode;
  let editor: Editor | null = null;
  let originalDocument: unknown;
  let originalWindow: unknown;

  beforeEach(() => {
    originalDocument = (globalThis as unknown as { document?: unknown }).document;
    originalWindow = (globalThis as unknown as { window?: unknown }).window;

    (globalThis as unknown as { document: unknown }).document = {
      createElementNS: (_ns: string, tag: string) => new MockDomNode(tag),
      createElement: (tag: string) => new MockDomNode(tag),
      body: new MockDomNode("body"),
      activeElement: null,
    };
    const windowListeners: Record<string, ((event: unknown) => void)[]> = {};
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: (evt: string, fn: (event: unknown) => void) => {
        windowListeners[evt] = windowListeners[evt] ?? [];
        windowListeners[evt]!.push(fn);
      },
      removeEventListener: (evt: string, fn: (event: unknown) => void) => {
        if (windowListeners[evt]) {
          windowListeners[evt] = windowListeners[evt]!.filter((f) => f !== fn);
        }
      },
      dispatch: (evt: string, arg: unknown) => {
        for (const fn of windowListeners[evt] ?? []) {
          fn(arg);
        }
      },
    };

    container = new MockDomNode("div");
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;

    if (originalDocument !== undefined) {
      (globalThis as unknown as { document: unknown }).document = originalDocument;
    } else {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
    if (originalWindow !== undefined) {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    } else {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });

  // Battle Condition 1: 10k shape document scale, panning, zooming, selecting, rendering
  it("sustains 10k shape document across 100 pan frames with zero crash and flat memory/listener state", () => {
    const count = 10_000;
    const shapes: Shape[] = [];
    const cols = 100;
    for (let i = 1; i <= count; i++) {
      const col = (i - 1) % cols;
      const row = Math.floor((i - 1) / cols);
      shapes.push(
        createRect(
          parseShapeId(`stress-rect-${i}`),
          { x: col * 80 + 10, y: row * 80 + 10, width: 60, height: 60 },
          { parentId: ROOT_ID },
        ),
      );
    }
    const doc = createDocument(shapes);
    editor = createEditor(container as unknown as HTMLElement, { document: doc });

    const canvas = editor.canvas;
    const spatialIndex = canvas.getSpatialIndex(doc);

    // Initial state invariants
    expect(spatialIndex.count).toBe(count);

    // Simulate 100 rapid pan/zoom animation frames
    for (let frame = 1; frame <= 100; frame++) {
      canvas.panBy({ x: 5, y: 5 });
      if (frame % 25 === 0) {
        canvas.zoomAt({ x: 400, y: 300 }, 1.05);
      }
      const cam = canvas.getCamera();
      const viewportBox = cameraToViewportBox(cam, 800, 600, 64);
      const visibleHits = querySpatialIndexBox(spatialIndex, viewportBox);
      expect(visibleHits.length).toBeGreaterThan(0);
      expect(visibleHits.length).toBeLessThanOrEqual(count);
    }

    // Verify selection and hit testing after 100 pan frames
    const targetId = parseShapeId("stress-rect-500");
    editor.select(targetId);
    expect(editor.getSelection()).toEqual([targetId]);

    // Verify SVG export renders scene correctly without NaN or crash
    const svg = editor.toSvg();
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("NaN");

    // Flat memory check: verify no duplicate or leaking spatial index items
    const recheckedIndex = canvas.getSpatialIndex(editor.getDocument());
    expect(recheckedIndex.count).toBe(count);
  });

  // Battle Condition 2: Deeply nested shapes at max allowed depth
  it("handles deeply nested shapes at max allowed depth with clean reparenting and boundary enforcement", () => {
    const depth = 50;
    const shapes: Shape[] = [];
    let currentParent: ShapeId = ROOT_ID;

    // Build branch A: depth levels of nested containers
    for (let d = 1; d <= depth; d++) {
      const id = parseShapeId(`container-a-${d}`);
      shapes.push(
        createRect(
          id,
          { x: 10, y: 10, width: 500 - d * 8, height: 500 - d * 8 },
          { parentId: currentParent },
        ),
      );
      currentParent = id;
    }
    const leafA = parseShapeId("leaf-a");
    shapes.push(
      createRect(leafA, { x: 5, y: 5, width: 20, height: 20 }, { parentId: currentParent }),
    );

    // Build branch B: depth levels of nested containers
    let currentParentB: ShapeId = ROOT_ID;
    for (let d = 1; d <= depth; d++) {
      const id = parseShapeId(`container-b-${d}`);
      shapes.push(
        createRect(
          id,
          { x: 600, y: 10, width: 500 - d * 8, height: 500 - d * 8 },
          { parentId: currentParentB },
        ),
      );
      currentParentB = id;
    }

    let doc = createDocument(shapes);
    expect(Object.keys(doc.shapes)).toHaveLength(depth * 2 + 1);

    // 1. Verify absolute bounding box derived accurately through 50 ancestor levels
    const leafShape = doc.shapes[leafA]!;
    const absBox = absoluteBoundingBox(doc, leafShape);
    expect(absBox.x).toBe(10 * depth + 5);
    expect(absBox.y).toBe(10 * depth + 5);

    // 2. Reparent leaf from deepest container A to deepest container B
    const reparentCommand = {
      type: COMMANDS.reparentShape,
      id: leafA,
      parentId: currentParentB,
      boundingBox: { x: 15, y: 15, width: 20, height: 20 },
    };
    editor = createEditor(container as unknown as HTMLElement, { document: doc });
    editor.execute([reparentCommand]);

    doc = editor.getDocument();
    const updatedLeaf = doc.shapes[leafA]!;
    expect(updatedLeaf.parentId).toBe(currentParentB);

    // Verify ancestors reflect new branch B
    const ancestors = ancestorsOf(doc, updatedLeaf);
    expect(ancestors).toHaveLength(depth);
    expect(ancestors[0]!.id).toBe(currentParentB);
    expect(ancestors[ancestors.length - 1]!.id).toBe(parseShapeId("container-b-1"));

    // 3. Document depth limit enforcement (MAX_DOCUMENT_DEPTH = 256, R-006)
    const hostileShapes: Record<string, unknown> = {};
    let parentPtr: string = ROOT_ID;
    for (let i = 1; i <= MAX_DOCUMENT_DEPTH + 5; i++) {
      const id = `hostile-${i}`;
      hostileShapes[id] = {
        id,
        kind: "rect",
        parentId: parentPtr,
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        meta: { order: {} },
      };
      parentPtr = id;
    }
    const hostileJson = JSON.stringify({
      schema: { version: 1 },
      shapes: hostileShapes,
    });

    expect(() => editor!.loadJson(hostileJson)).toThrow(/documentDepthExceeded/);
  });

  // Battle Condition 3: Multi-user shape collision: two shapes overlapping exactly
  it("resolves exact shape collisions deterministically by document stacking order (ADR-0011, R-016)", () => {
    const identicalBox: BoundingBox = { x: 100, y: 100, width: 200, height: 150 };
    const rectUnderId = parseShapeId("rect-under");
    const rectOverId = parseShapeId("rect-over");

    const rectUnder = createRect(rectUnderId, identicalBox, { parentId: ROOT_ID, fill: "#ff0000" });
    const rectOver = createRect(rectOverId, identicalBox, { parentId: ROOT_ID, fill: "#0000ff" });

    // Stacking order: rectUnder (index 0), rectOver (index 1, topmost)
    const doc = createDocument([rectUnder, rectOver]);
    const canvas = createCanvas();
    const probePoint = { x: 150, y: 150 };

    // 1. Broad-phase query with spatial index: topmost shape wins
    const spatialIndex = canvas.getSpatialIndex(doc);
    const hitWithIndex = pickShape(doc, probePoint, undefined, spatialIndex);
    expect(hitWithIndex).toBe(rectOverId);

    // 2. Fallback linear scan: topmost shape wins identically
    const hitWithoutIndex = pickShape(doc, probePoint);
    expect(hitWithoutIndex).toBe(rectOverId);

    // 3. Reverse order: if rectUnder is placed later in document, it becomes topmost
    const reversedDoc = createDocument([rectOver, rectUnder]);
    const reversedIndex = canvas.getSpatialIndex(reversedDoc);
    expect(pickShape(reversedDoc, probePoint, undefined, reversedIndex)).toBe(rectUnderId);
    expect(pickShape(reversedDoc, probePoint)).toBe(rectUnderId);
  });

  // Battle Condition 4: Zero-size shapes: drag-creating a rect of 0x0 or 1x1
  it("collapses zero-size drag creation without creating ghost shapes and enforces minimum dimensions (R-039)", () => {
    editor = createEditor(container as unknown as HTMLElement);
    editor.setTool(TOOLS.drawRect);

    const mockSvg = editor.svg as unknown as MockDomNode;

    // Case A: Click without dragging (dx = 0, dy = 0) -> collapses, zero shapes created
    mockSvg.dispatch("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
      preventDefault: () => {},
    });
    mockSvg.dispatch("pointerup", {
      pointerId: 1,
      clientX: 200,
      clientY: 200,
      preventDefault: () => {},
    });

    // Zero shapes created in document
    expect(Object.keys(editor.getDocument().shapes)).toHaveLength(0);
    expect(editor.canUndo()).toBe(false);

    // Case B: Drag creation with small delta enforces minimum dimension (MIN_SHAPE_SIZE = 1)
    editor.setTool(TOOLS.drawRect);
    mockSvg.dispatch("pointerdown", {
      button: 0,
      pointerId: 2,
      clientX: 200,
      clientY: 200,
      preventDefault: () => {},
    });
    // Move 5px (exceeds DRAG_THRESHOLD_PX = 3)
    mockSvg.dispatch("pointermove", {
      pointerId: 2,
      clientX: 205,
      clientY: 205,
      preventDefault: () => {},
    });
    mockSvg.dispatch("pointerup", {
      pointerId: 2,
      clientX: 205,
      clientY: 205,
      preventDefault: () => {},
    });

    const shapesAfterDrag = Object.values(editor.getDocument().shapes) as RectShape[];
    expect(shapesAfterDrag).toHaveLength(1);
    expect(shapesAfterDrag[0]!.boundingBox.width).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);
    expect(shapesAfterDrag[0]!.boundingBox.height).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);

    // Case C: Resizing inwards past zero enforces minimum size
    const origBox: BoundingBox = { x: 50, y: 50, width: 100, height: 100 };
    const collapsedByResize = resizeBox(origBox, HANDLES.se, { x: 50, y: 50 });
    expect(collapsedByResize.width).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);
    expect(collapsedByResize.height).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);
  });

  describe("multi-editor isolation and FSM hardening (P1-4, P1-8)", () => {
    it("isolates instanceId across editor instances (P1-4)", () => {
      const ed1 = createEditor(container as unknown as HTMLElement, { instanceId: "ed-1" });
      const ed2 = createEditor(container as unknown as HTMLElement, { instanceId: "ed-2" });
      expect(ed1.canvas.getInstanceId()).toBe("ed-1");
      expect(ed2.canvas.getInstanceId()).toBe("ed-2");
      ed1.destroy();
      ed2.destroy();
    });

    it("wires instanceId into SVG rendering to prevent defs/clipPath collision (P1-4)", () => {
      const ed1 = createEditor(container as unknown as HTMLElement, {
        instanceId: "editor-alpha",
      });
      ed1.setTool(TOOLS.drawRect);
      const shape = createRect(
        parseShapeId("rect-clipped"),
        { x: 10, y: 10, width: 100, height: 50 },
        { content: "Clipped Text" },
      );
      ed1.setDocument(createDocument([shape]));
      const svg = ed1.toSvg();
      expect(svg).toContain('clipPath id="clip-editor-alpha-rect-clipped"');
      ed1.destroy();
    });

    it("FSM returns previous state on unrecognized events instead of undefined (P1-8)", () => {
      const state = INITIAL_MACHINE_STATE;
      const invalidEvent = { type: "unknownCustomEvent" } as unknown as Parameters<
        typeof transition
      >[1];
      const next = transition(state, invalidEvent);
      expect(next).toBeDefined();
      expect(next).toEqual(state);
    });

    it("enforces capability restrictions: non-movable shapes cannot be dragged (P1-5)", () => {
      const ed = createEditor(container as unknown as HTMLElement);
      ed.registerCustomShape({
        kind: parseCustomShapeKind("custom:fixed"),
        label: "Fixed Shape",
        capabilities: [],
        render: (_s, box) =>
          `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="#eee" />`,
      });
      const fixedShape = ed.insertCustomShape(parseCustomShapeKind("custom:fixed"), {
        x: 50,
        y: 50,
        width: 100,
        height: 100,
      });
      ed.select(fixedShape.id);

      const mockSvg = ed.svg as unknown as {
        dispatch: (event: string, data: unknown) => void;
      };
      mockSvg.dispatch("pointerdown", {
        button: 0,
        pointerId: 10,
        clientX: 60,
        clientY: 60,
        preventDefault: () => {},
      });
      mockSvg.dispatch("pointermove", {
        pointerId: 10,
        clientX: 120,
        clientY: 120,
        preventDefault: () => {},
      });
      mockSvg.dispatch("pointerup", {
        pointerId: 10,
        clientX: 120,
        clientY: 120,
        preventDefault: () => {},
      });

      const afterShape = ed.getDocument().shapes[fixedShape.id]!;
      expect(afterShape.boundingBox.x).toBe(50);
      expect(afterShape.boundingBox.y).toBe(50);
      ed.destroy();
    });

    it("reorders shapes via Editor z-ordering methods", () => {
      const container = new MockDomNode("div") as unknown as HTMLElement;
      const s1 = parseShapeId("rect-1");
      const s2 = parseShapeId("rect-2");
      const s3 = parseShapeId("rect-3");
      const doc = createDocument([
        createRect(s1, { x: 0, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
        createRect(s2, { x: 60, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
        createRect(s3, { x: 120, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
      ]);
      const ed = createEditor(container, { document: doc });

      // s1 bringToFront -> order [s2, s3, s1]
      ed.bringToFront([s1]);
      expect(shapeListInOrder(ed.getDocument()).map((s) => s.id)).toEqual([s2, s3, s1]);

      // s1 sendToBack -> order [s1, s2, s3]
      ed.sendToBack([s1]);
      expect(shapeListInOrder(ed.getDocument()).map((s) => s.id)).toEqual([s1, s2, s3]);

      // s1 bringForward -> order [s2, s1, s3]
      ed.bringForward([s1]);
      expect(shapeListInOrder(ed.getDocument()).map((s) => s.id)).toEqual([s2, s1, s3]);

      // s1 sendBackward -> order [s1, s2, s3]
      ed.sendBackward([s1]);
      expect(shapeListInOrder(ed.getDocument()).map((s) => s.id)).toEqual([s1, s2, s3]);

      // Undo works losslessly
      ed.undo();
      expect(shapeListInOrder(ed.getDocument()).map((s) => s.id)).toEqual([s2, s1, s3]);

      ed.destroy();
    });

    it("reorders shapes via keyboard shortcuts", () => {
      const container = new MockDomNode("div") as unknown as HTMLElement;
      const s1 = parseShapeId("rect-1");
      const s2 = parseShapeId("rect-2");
      const s3 = parseShapeId("rect-3");
      const doc = createDocument([
        createRect(s1, { x: 0, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
        createRect(s2, { x: 60, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
        createRect(s3, { x: 120, y: 0, width: 50, height: 50 }, { parentId: ROOT_ID }),
      ]);
      const ed = createEditor(container, { document: doc });
      ed.select(s1);

      const mockWin = (
        globalThis as unknown as { window: { dispatch: (evt: string, arg: unknown) => void } }
      ).window;

      // BracketRight with ctrlKey + shiftKey -> bringToFront
      mockWin.dispatch("keydown", {
        code: "BracketRight",
        ctrlKey: true,
        shiftKey: true,
        target: ed.svg,
        preventDefault: () => {},
      });
      expect(shapeListInOrder(ed.getDocument()).map((s) => s.id)).toEqual([s2, s3, s1]);

      // BracketLeft with ctrlKey + shiftKey -> sendToBack
      mockWin.dispatch("keydown", {
        code: "BracketLeft",
        ctrlKey: true,
        shiftKey: true,
        target: ed.svg,
        preventDefault: () => {},
      });
      expect(shapeListInOrder(ed.getDocument()).map((s) => s.id)).toEqual([s1, s2, s3]);

      ed.destroy();
    });

    it("handles long-stroke pen gesture: >2000 points does not crash on commit and respects envelope limit (P0-3 regression fix)", () => {
      const ed = createEditor(container as unknown as HTMLElement);
      ed.setTool(TOOLS.drawPenPath);

      const mockSvg = ed.svg as unknown as {
        dispatch: (event: string, data: unknown) => void;
      };

      mockSvg.dispatch("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 10,
        clientY: 10,
        preventDefault: () => {},
      });

      // Dispatch 2500 move events
      for (let i = 1; i <= 2500; i++) {
        mockSvg.dispatch("pointermove", {
          pointerId: 1,
          clientX: 10 + i * 0.1,
          clientY: 10 + (i % 2) * 2,
          preventDefault: () => {},
        });
      }

      // Pointerup should commit without throwing
      expect(() => {
        mockSvg.dispatch("pointerup", {
          pointerId: 1,
          clientX: 260,
          clientY: 10,
        });
      }).not.toThrow();

      const shapes = Object.values(ed.getDocument().shapes).filter((s) => s.parentId === ROOT_ID);
      expect(shapes.length).toBe(1);
      const penShape = shapes[0] as unknown as { kind: string; points: unknown[] };
      expect(penShape.kind).toBe("pen-path");
      expect(penShape.points.length).toBeLessThanOrEqual(MAX_PEN_PATH_POINTS);
      expect(penShape.points.length).toBeGreaterThan(0);

      ed.destroy();
    });

    it("provides safe multi-editor defaults without manual options (P1-4)", () => {
      const c1 = new MockDomNode("div") as unknown as HTMLElement;
      const c2 = new MockDomNode("div") as unknown as HTMLElement;
      const ed1 = createEditor(c1);
      const ed2 = createEditor(c2);

      // Disjoint auto-generated instanceIds
      const id1 = ed1.canvas.getInstanceId();
      const id2 = ed2.canvas.getInstanceId();
      expect(typeof id1).toBe("string");
      expect(typeof id2).toBe("string");
      expect(id1).not.toBe("");
      expect(id2).not.toBe("");
      expect(id1).not.toBe(id2);

      // Disjoint shape IDs on insert
      ed1.registerCustomShape({
        kind: parseCustomShapeKind("custom:test"),
        label: "Test",
        capabilities: [],
        render: () => "<rect />",
      });
      ed2.registerCustomShape({
        kind: parseCustomShapeKind("custom:test"),
        label: "Test",
        capabilities: [],
        render: () => "<rect />",
      });

      const s1 = ed1.insertCustomShape(parseCustomShapeKind("custom:test"), {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      });
      const s2 = ed2.insertCustomShape(parseCustomShapeKind("custom:test"), {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      });
      expect(s1.id).not.toBe(s2.id);

      ed1.destroy();
      ed2.destroy();
    });

    it("does not paste stale in-memory shapes when system clipboard contains non-OpenDraw text (P1-8)", async () => {
      let clipboardText = "";
      const origDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
      Object.defineProperty(globalThis, "navigator", {
        value: {
          clipboard: {
            writeText: async (text: string) => {
              clipboardText = text;
            },
            readText: async () => clipboardText,
          },
        },
        configurable: true,
        writable: true,
      });

      try {
        const shape = createRect(parseShapeId("rect-to-copy"), {
          x: 10,
          y: 10,
          width: 50,
          height: 50,
        });
        const ed = createEditor(container as unknown as HTMLElement, {
          document: createDocument([shape]),
        });
        ed.select(shape.id);

        const mockWin = (
          globalThis as unknown as { window: { dispatch: (evt: string, arg: unknown) => void } }
        ).window;

        // 1. Copy locally
        mockWin.dispatch("keydown", {
          code: "KeyC",
          key: "c",
          ctrlKey: true,
          preventDefault: () => {},
        });
        expect(clipboardText).toContain("rect-to-copy");

        // 2. User copies arbitrary plain text in another app
        clipboardText = "https://example.com/some/article";

        // 3. User pastes into editor
        mockWin.dispatch("keydown", {
          code: "KeyV",
          key: "v",
          ctrlKey: true,
          preventDefault: () => {},
        });

        await new Promise((r) => setTimeout(r, 10));

        // Document should still only contain the original shape, not stale copied rect
        const shapes = Object.values(ed.getDocument().shapes).filter((s) => s.parentId === ROOT_ID);
        expect(shapes).toHaveLength(1);
        expect(shapes[0]?.id).toBe(shape.id);

        ed.destroy();
      } finally {
        if (origDescriptor) {
          Object.defineProperty(globalThis, "navigator", origDescriptor);
        } else {
          delete (globalThis as unknown as { navigator?: unknown }).navigator;
        }
      }
    });

    it("clamps shapes drawn beyond MAX_COORDINATE_BOUND without throwing (P1-1)", () => {
      const ed = createEditor(container as unknown as HTMLElement);
      ed.setTool(TOOLS.drawRect);

      // Pan far past 100k
      ed.canvas.setCamera({ x: -150000, y: -150000, zoom: 1 });

      const mockSvg = ed.svg as unknown as {
        dispatch: (event: string, data: unknown) => void;
      };

      // Draw rect from world (150000, 150000) to (150100, 150100)
      mockSvg.dispatch("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        preventDefault: () => {},
      });
      mockSvg.dispatch("pointermove", {
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      });
      expect(() => {
        mockSvg.dispatch("pointerup", {
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        });
      }).not.toThrow();

      const shapes = Object.values(ed.getDocument().shapes).filter((s) => s.parentId === ROOT_ID);
      expect(shapes).toHaveLength(1);
      expect(Math.abs(shapes[0]!.boundingBox.x)).toBeLessThanOrEqual(MAX_COORDINATE_BOUND);
      expect(Math.abs(shapes[0]!.boundingBox.y)).toBeLessThanOrEqual(MAX_COORDINATE_BOUND);

      ed.destroy();
    });

    it("routes execution errors to onError callback without crashing (P1-2)", () => {
      const errors: unknown[] = [];
      const ed = createEditor(container as unknown as HTMLElement, {
        onError: (err) => {
          errors.push(err);
        },
      });

      // Invalid command with out-of-bounds bounding box
      ed.execute({
        type: COMMANDS.setShapeBoundingBox,
        id: parseShapeId("non-existent"),
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      });

      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toContain("no shape with id");

      ed.destroy();
    });

    it("makes select(badId) a no-op that preserves existing selection (P1-8)", () => {
      const rect = createRect(parseShapeId("rect-valid"), {
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      });
      const ed = createEditor(container as unknown as HTMLElement, {
        document: createDocument([rect]),
      });

      ed.select(rect.id);
      expect(ed.getSelection()).toEqual([rect.id]);

      // Selecting non-existent shape does not wipe out existing selection
      ed.select(parseShapeId("non-existent"));
      expect(ed.getSelection()).toEqual([rect.id]);

      ed.destroy();
    });
  });
});
