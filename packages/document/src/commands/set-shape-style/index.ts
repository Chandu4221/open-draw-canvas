// SetShapeStyle: sets or clears (null) shape styling (fill, stroke, strokeWidth, fillStyle).
// (ADR-0006 Option A, F1). Inverse restores previous style values.
import type { FillStyle, ShapeId } from "@open-draw/contracts";
import type { Command, CommandResult } from "..";
import type { Document } from "../../document";
import { createDocument } from "../../document";
import { DocumentError } from "../../errors";
import type { Shape } from "../../shape";
import { COMMANDS } from "../registry";
import { parseColor, parseFillStyle, parseStrokeWidth } from "../../style-validation";

export interface SetShapeStyle {
  readonly type: (typeof COMMANDS)["setShapeStyle"];
  readonly id: ShapeId;
  readonly fill?: string | null | undefined;
  readonly stroke?: string | null | undefined;
  readonly strokeWidth?: number | null | undefined;
  readonly fillStyle?: FillStyle | null | undefined;
}

export function applySetShapeStyle(document: Document, command: SetShapeStyle): CommandResult {
  const shape = document.shapes[command.id];
  if (shape === undefined) {
    throw new DocumentError("shapeNotFound", `no shape with id: ${command.id}`);
  }

  const previousFill = shape.fill === undefined ? null : shape.fill;
  const previousStroke = shape.stroke === undefined ? null : shape.stroke;
  const previousStrokeWidth = shape.strokeWidth === undefined ? null : shape.strokeWidth;
  const previousFillStyle = shape.fillStyle === undefined ? null : shape.fillStyle;

  const nextShapeData: Record<string, unknown> = { ...shape };

  if (command.fill !== undefined) {
    if (command.fill === null) {
      delete nextShapeData.fill;
    } else {
      nextShapeData.fill = parseColor(command.fill, "fill");
    }
  }

  if (command.stroke !== undefined) {
    if (command.stroke === null) {
      delete nextShapeData.stroke;
    } else {
      nextShapeData.stroke = parseColor(command.stroke, "stroke");
    }
  }

  if (command.strokeWidth !== undefined) {
    if (command.strokeWidth === null) {
      delete nextShapeData.strokeWidth;
    } else {
      nextShapeData.strokeWidth = parseStrokeWidth(command.strokeWidth);
    }
  }

  if (command.fillStyle !== undefined) {
    if (command.fillStyle === null) {
      delete nextShapeData.fillStyle;
    } else {
      nextShapeData.fillStyle = parseFillStyle(command.fillStyle);
    }
  }

  const nextShape = nextShapeData as unknown as Shape;
  const shapes = Object.values(document.shapes).map((entry) =>
    entry.id === command.id ? nextShape : entry,
  );
  const next = createDocument(shapes);

  const inverse: readonly Command[] = [
    {
      type: COMMANDS.setShapeStyle,
      id: command.id,
      fill: previousFill,
      stroke: previousStroke,
      strokeWidth: previousStrokeWidth,
      fillStyle: previousFillStyle,
    },
  ];

  return { document: next, inverse };
}
