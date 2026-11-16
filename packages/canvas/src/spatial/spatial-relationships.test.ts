// Tests for pure spatial relationships, alignment, relative geometry, and z-index metrics (R-015, R-016).
import { describe, expect, it } from "vitest";
import { parseShapeId } from "@open-draw/contracts";
import { createDocument, createRect, createEllipse, createText } from "@open-draw/document";
import {
  computeBoxIoa,
  deriveDocumentSpatialMap,
  deriveRelativeParentGeometry,
  deriveSpatialRelationships,
  deriveZIndexMetrics,
} from "./spatial-relationships";

describe("computeBoxIoa", () => {
  it("returns 1.0 when boxA is completely inside boxB", () => {
    const a = { x: 10, y: 10, width: 20, height: 20 };
    const b = { x: 0, y: 0, width: 100, height: 100 };
    expect(computeBoxIoa(a, b)).toBe(1.0);
  });

  it("returns 0.0 when boxes do not intersect", () => {
    const a = { x: 10, y: 10, width: 20, height: 20 };
    const b = { x: 50, y: 50, width: 20, height: 20 };
    expect(computeBoxIoa(a, b)).toBe(0.0);
  });

  it("returns exact ratio of intersection over boxA area for partial overlap", () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }; // area 10000
    const b = { x: 50, y: 0, width: 100, height: 100 }; // intersection: 50 x 100 = 5000
    expect(computeBoxIoa(a, b)).toBe(0.5);
  });
});

describe("spatial relationships & z-indexing on a composite card", () => {
  // Construct the card with an overlapping avatar, title, subtitle, and button
  const cardId = parseShapeId("card-1");
  const avatarId = parseShapeId("avatar-1");
  const badgeId = parseShapeId("badge-1");
  const nameId = parseShapeId("name-1");
  const roleId = parseShapeId("role-1");
  const buttonId = parseShapeId("button-1");

  const doc = createDocument([
    createRect(cardId, { x: 100, y: 100, width: 400, height: 300 }),
    createEllipse(avatarId, { x: 30, y: -40, width: 100, height: 100 }, { parentId: cardId }), // Protrudes top
    createRect(badgeId, { x: 300, y: -10, width: 80, height: 24 }, { parentId: cardId }), // Protrudes top-right
    createText(
      nameId,
      { x: 150, y: 20, width: 180, height: 28 },
      { parentId: cardId, content: "Alex Muller" },
    ),
    createText(
      roleId,
      { x: 150, y: 52, width: 180, height: 20 },
      { parentId: cardId, content: "Designer" },
    ),
    createRect(buttonId, { x: 50, y: 220, width: 300, height: 48 }, { parentId: cardId }),
  ]);

  it("derives exact z-index metrics across document hierarchy", () => {
    const cardZ = deriveZIndexMetrics(doc, cardId);
    expect(cardZ).toEqual({
      siblingIndex: 0,
      depth: 1,
      frontToBack: 1,
    });

    const avatarZ = deriveZIndexMetrics(doc, avatarId);
    expect(avatarZ).toEqual({
      siblingIndex: 0,
      depth: 2,
      frontToBack: 2,
    });

    const badgeZ = deriveZIndexMetrics(doc, badgeId);
    expect(badgeZ).toEqual({
      siblingIndex: 1,
      depth: 2,
      frontToBack: 3,
    });

    const buttonZ = deriveZIndexMetrics(doc, buttonId);
    expect(buttonZ).toEqual({
      siblingIndex: 4,
      depth: 2,
      frontToBack: 6,
    });
  });

  it("derives relative parent geometry (ratios) correctly", () => {
    // Root card has no parent -> returns null
    expect(deriveRelativeParentGeometry(doc, cardId)).toBeNull();

    // Button: width 300 in parent 400 = 0.75; height 48 in parent 300 = 0.16; x 50 in 400 = 0.125; y 220 in 300 = 0.7333
    const buttonRel = deriveRelativeParentGeometry(doc, buttonId);
    expect(buttonRel).not.toBeNull();
    expect(buttonRel?.widthRatio).toBe(0.75);
    expect(buttonRel?.heightRatio).toBe(0.16);
    expect(buttonRel?.xRatio).toBe(0.125);
    expect(buttonRel?.yRatio).toBe(0.7333);

    // Protruding avatar: y = -40 in parent height 300 = -0.1333
    const avatarRel = deriveRelativeParentGeometry(doc, avatarId);
    expect(avatarRel?.yRatio).toBe(-0.1333);
  });

  it("detects frame-breaking overlays and boundary protrusions", () => {
    const avatarSpatial = deriveSpatialRelationships(doc, avatarId);
    expect(avatarSpatial.containedIn).toBe(cardId);
    expect(avatarSpatial.overlaps).toContain(cardId);

    const badgeSpatial = deriveSpatialRelationships(doc, badgeId);
    expect(badgeSpatial.overlaps).toContain(cardId);

    const buttonSpatial = deriveSpatialRelationships(doc, buttonId);
    // Button is fully inside card bounds -> does not flag card as an overlap
    expect(buttonSpatial.overlaps).not.toContain(cardId);
  });

  it("detects directional placement (leftOf, rightOf, above, below)", () => {
    const avatarSpatial = deriveSpatialRelationships(doc, avatarId);
    expect(avatarSpatial.leftOf).toContain(nameId);
    expect(avatarSpatial.leftOf).toContain(roleId);
    expect(avatarSpatial.above).toContain(buttonId);

    const buttonSpatial = deriveSpatialRelationships(doc, buttonId);
    expect(buttonSpatial.below).toContain(avatarId);
    expect(buttonSpatial.below).toContain(nameId);
  });

  it("detects edge alignments within tolerance", () => {
    const nameSpatial = deriveSpatialRelationships(doc, nameId);
    // Name (x: 150) and Role (x: 150) share left edge
    expect(nameSpatial.aligns.left).toContain(roleId);

    const roleSpatial = deriveSpatialRelationships(doc, roleId);
    expect(roleSpatial.aligns.left).toContain(nameId);

    // Button (x: 50, w: 300, center: 200) inside Card (w: 400, center: 200) is horizontally centered
    const buttonSpatial = deriveSpatialRelationships(doc, buttonId);
    expect(buttonSpatial.aligns.centerX).toContain(cardId);
  });

  it("computes comprehensive document spatial map in a single pass", () => {
    const spatialMap = deriveDocumentSpatialMap(doc);
    expect(spatialMap.size).toBe(6);

    const cardEntry = spatialMap.get(cardId);
    expect(cardEntry).toBeDefined();
    expect(cardEntry?.z.depth).toBe(1);
    expect(cardEntry?.spatial.contains).toEqual([avatarId, badgeId, nameId, roleId, buttonId]);
    expect(cardEntry?.relativeParent).toBeNull();

    const avatarEntry = spatialMap.get(avatarId);
    expect(avatarEntry).toBeDefined();
    expect(avatarEntry?.relativeParent?.yRatio).toBe(-0.1333);
    expect(avatarEntry?.worldBox).toEqual({ x: 130, y: 60, width: 100, height: 100 });
  });
});
