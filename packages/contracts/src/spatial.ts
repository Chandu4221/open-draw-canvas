// Pure value types and contracts for spatial relationships, alignment,
// relative parent geometry, and z-index metrics (R-005, R-007, R-008, R-039).
import type { ShapeId } from "./ids";

export const SPATIAL_SCOPES = {
  siblings: "siblings",
  all: "all",
} as const;

export type SpatialScope = keyof typeof SPATIAL_SCOPES;

export interface SpatialAlignments {
  readonly left?: readonly ShapeId[];
  readonly right?: readonly ShapeId[];
  readonly top?: readonly ShapeId[];
  readonly bottom?: readonly ShapeId[];
  readonly centerX?: readonly ShapeId[];
  readonly centerY?: readonly ShapeId[];
}

export interface SpatialRelationships {
  readonly containedIn: ShapeId | null;
  readonly contains: readonly ShapeId[];
  readonly leftOf: readonly ShapeId[];
  readonly rightOf: readonly ShapeId[];
  readonly above: readonly ShapeId[];
  readonly below: readonly ShapeId[];
  readonly aligns: SpatialAlignments;
  readonly overlaps: readonly ShapeId[];
}

export interface ZIndexMetrics {
  readonly siblingIndex: number;
  readonly depth: number;
  readonly frontToBack: number;
}

export interface RelativeParentGeometry {
  readonly widthRatio: number;
  readonly heightRatio: number;
  readonly xRatio: number;
  readonly yRatio: number;
}

export interface SpatialExtractionOptions {
  readonly scope?: SpatialScope;
  readonly alignmentTolerance?: number;
  readonly overlapMinIoa?: number;
  readonly containmentMinIoa?: number;
}
