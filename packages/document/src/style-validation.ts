// Style validation for shapes (fill, stroke, strokeWidth, fillStyle) (R-006, ADR-0006 F1).
import { FILL_STYLE_VALUES, type FillStyle } from "@open-draw/contracts";
import { DocumentError } from "./errors";

const COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function parseColor(value: unknown, fieldName: string): string {
  if (
    typeof value !== "string" ||
    (value !== "none" && value !== "transparent" && !COLOR_REGEX.test(value))
  ) {
    throw new DocumentError(
      "invalidShape",
      `${fieldName} must be a valid hex color string or "none"/"transparent"`,
    );
  }
  return value;
}

export function parseStrokeWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new DocumentError("invalidShape", "strokeWidth must be a non-negative finite number");
  }
  return value;
}

export function parseFillStyle(value: unknown): FillStyle {
  if (typeof value !== "string" || !FILL_STYLE_VALUES.has(value)) {
    throw new DocumentError(
      "invalidShape",
      `fillStyle must be one of: ${Array.from(FILL_STYLE_VALUES).join(", ")}`,
    );
  }
  return value as FillStyle;
}
