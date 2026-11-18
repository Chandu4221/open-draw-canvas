// SetShapeStyle: sets or clears (null) shape styling (fill, stroke, strokeWidth, fillStyle).
// (ADR-0006 Option A, F1). Inverse restores previous style values.
import type { FillStyle, ShapeId } from "@open-draw/contracts";
import type { Command, CommandResult } from "..";
import type { Document } from "../../document";
import { createDocumentFromMap } from "../../document";
import { DocumentError } from "../../errors";
import type { Shape } from "../../shape";
import { parseColor, parseFillStyle, parseStrokeWidth } from "../../style-validation";
import { COMMANDS } from "../registry";

export interface SetShapeStyle {
  readonly type: (typeof COMMANDS)["setShapeStyle"];
  readonly id: ShapeId;
  readonly fill?: string | null | undefined;
  readonly stroke?: string | null | undefined;
  readonly strokeWidth?: number | null | undefined;
  readonly fillStyle?: FillStyle | null | undefined;
}

export function applySetShapeStyleToMap(
  shapes: Record<ShapeId, Shape>,
  command: SetShapeStyle,
): readonly Command[] {
  const shape = shapes[command.id];
  if (shape === undefined) {
    throw new DocumentError("shapeNotFound", `no shape with id: ${command.id}`);
  }
  const previousFill = shape.fill === undefined ? null : shape.fill;
  const previousStroke = shape.stroke === undefined ? null : shape.stroke;
  const previousStrokeWidth = shape.strokeWidth === undefined ? null : shape.strokeWidth;
  const previousFillStyle = shape.fillStyle === undefined ? null : shape.fillStyle;

  const targetFill =
    command.fill === undefined
      ? shape.fill
      : command.fill === null
        ? undefined
        : parseColor(command.fill, "fill");
  const targetStroke =
    command.stroke === undefined
      ? shape.stroke
      : command.stroke === null
        ? undefined
        : parseColor(command.stroke, "stroke");
  const targetStrokeWidth =
    command.strokeWidth === undefined
      ? shape.strokeWidth
      : command.strokeWidth === null
        ? undefined
        : parseStrokeWidth(command.strokeWidth);
  const targetFillStyle =
    command.fillStyle === undefined
      ? shape.fillStyle
      : command.fillStyle === null
        ? undefined
        : parseFillStyle(command.fillStyle);

  if (
    shape.fill === targetFill &&
    shape.stroke === targetStroke &&
    shape.strokeWidth === targetStrokeWidth &&
    shape.fillStyle === targetFillStyle
  ) {
    return [];
  }

  const nextShapeData: Record<string, unknown> = { ...shape };
  if (command.fill !== undefined) {
    if (targetFill === undefined) {
      delete nextShapeData.fill;
    } else {
      nextShapeData.fill = targetFill;
    }
  }
  if (command.stroke !== undefined) {
    if (targetStroke === undefined) {
      delete nextShapeData.stroke;
    } else {
      nextShapeData.stroke = targetStroke;
    }
  }
  if (command.strokeWidth !== undefined) {
    if (targetStrokeWidth === undefined) {
      delete nextShapeData.strokeWidth;
    } else {
      nextShapeData.strokeWidth = targetStrokeWidth;
    }
  }
  if (command.fillStyle !== undefined) {
    if (targetFillStyle === undefined) {
      delete nextShapeData.fillStyle;
    } else {
      nextShapeData.fillStyle = targetFillStyle;
    }
  }

  shapes[command.id] = nextShapeData as unknown as Shape;
  return [
    {
      type: COMMANDS.setShapeStyle,
      id: command.id,
      fill: previousFill,
      stroke: previousStroke,
      strokeWidth: previousStrokeWidth,
      fillStyle: previousFillStyle,
    },
  ];
}

export function applySetShapeStyle(document: Document, command: SetShapeStyle): CommandResult {
  const shapes: Record<ShapeId, Shape> = { ...document.shapes };
  const inverse = applySetShapeStyleToMap(shapes, command);
  if (inverse.length === 0) {
    return { document, inverse: [] };
  }
  return { document: createDocumentFromMap(shapes), inverse };
}
