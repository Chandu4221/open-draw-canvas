// Command registry index (uniform registry-folder layout, R-011/R-012).
import type { Document } from "../document";
import type { CreateShape } from "./create-shape";
import type { DeleteShape } from "./delete-shape";
import type { MoveShapes } from "./move-shapes";
import type { ReparentShape } from "./reparent-shape";
import type { SetRootStyle } from "./set-root-style";
import type { SetShapeBoundingBox } from "./set-shape-bounding-box";
import type { SetShapeHiddenOn } from "./set-shape-hidden-on";
import type { SetShapeLabel } from "./set-shape-label";
import type { SetShapeOrder } from "./set-shape-order";
import type { SetShapeStyle } from "./set-shape-style";
import type { SetShapeContent } from "./set-shape-content";
import type { DuplicateShapes } from "./duplicate-shapes";
import type { SetShapePluginData } from "./set-shape-plugin-data";

export { COMMANDS } from "./registry";
export type { CommandId } from "./registry";
export type { CreateShape } from "./create-shape";
export { applyCreateShape } from "./create-shape";
export type { DeleteShape } from "./delete-shape";
export { applyDeleteShape } from "./delete-shape";
export type { SetShapeLabel } from "./set-shape-label";
export { applySetShapeLabel } from "./set-shape-label";
export type { ReparentShape } from "./reparent-shape";
export { applyReparentShape } from "./reparent-shape";
export type { MoveShapes } from "./move-shapes";
export { applyMoveShapes } from "./move-shapes";
export type { SetShapeBoundingBox } from "./set-shape-bounding-box";
export { applySetShapeBoundingBox } from "./set-shape-bounding-box";
export type { SetRootStyle } from "./set-root-style";
export { applySetRootStyle } from "./set-root-style";
export type { SetShapeHiddenOn } from "./set-shape-hidden-on";
export { applySetShapeHiddenOn } from "./set-shape-hidden-on";
export type { SetShapeOrder } from "./set-shape-order";
export { applySetShapeOrder } from "./set-shape-order";
export type { SetShapeStyle } from "./set-shape-style";
export { applySetShapeStyle } from "./set-shape-style";
export type { SetShapeContent } from "./set-shape-content";
export { applySetShapeContent } from "./set-shape-content";
export type { DuplicateShapes } from "./duplicate-shapes";
export { applyDuplicateShapes } from "./duplicate-shapes";
export type { SetShapePluginData } from "./set-shape-plugin-data";
export { applySetShapePluginData } from "./set-shape-plugin-data";

export type Command =
  | CreateShape
  | DeleteShape
  | SetShapeLabel
  | ReparentShape
  | MoveShapes
  | SetShapeBoundingBox
  | SetRootStyle
  | SetShapeHiddenOn
  | SetShapeOrder
  | SetShapeStyle
  | SetShapeContent
  | DuplicateShapes
  | SetShapePluginData;

export interface CommandResult {
  readonly document: Document;
  readonly inverse: readonly Command[];
}
