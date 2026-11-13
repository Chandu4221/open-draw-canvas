// SetShapePluginData: sets or clears (null) namespaced plugin data on a shape (R-044, ADR-0003 D4).
// Inverse restores the previous plugin data value.
import { parsePluginId, type PluginId, type ShapeId } from "@open-draw/contracts";
import type { Command, CommandResult } from "..";
import type { Document } from "../../document";
import { createDocument } from "../../document";
import { DocumentError } from "../../errors";
import type { Shape, ShapeMeta } from "../../shape";
import { COMMANDS } from "../registry";

export interface SetShapePluginData {
  readonly type: (typeof COMMANDS)["setShapePluginData"];
  readonly id: ShapeId;
  readonly pluginId: PluginId;
  readonly data: unknown | null;
}

export function applySetShapePluginData(
  document: Document,
  command: SetShapePluginData,
): CommandResult {
  const shape = document.shapes[command.id];
  if (shape === undefined) {
    throw new DocumentError("shapeNotFound", `no shape with id: ${command.id}`);
  }

  const pluginId = parsePluginId(command.pluginId);
  const previousData = shape.meta.pluginData?.[pluginId] ?? null;

  const nextPluginData: Record<PluginId, unknown> = {
    ...(shape.meta.pluginData ?? {}),
  };

  if (command.data === null || command.data === undefined) {
    delete nextPluginData[pluginId];
  } else {
    nextPluginData[pluginId] = command.data;
  }

  const nextMeta: ShapeMeta = {
    ...shape.meta,
    ...(Object.keys(nextPluginData).length === 0 ? {} : { pluginData: nextPluginData }),
  };

  if (Object.keys(nextPluginData).length === 0) {
    delete (nextMeta as { pluginData?: unknown }).pluginData;
  }

  const nextShape: Shape = {
    ...shape,
    meta: nextMeta,
  };

  const shapes = Object.values(document.shapes).map((entry) =>
    entry.id === command.id ? nextShape : entry,
  );
  const next = createDocument(shapes);
  const inverse: readonly Command[] = [
    {
      type: COMMANDS.setShapePluginData,
      id: command.id,
      pluginId,
      data: previousData,
    },
  ];

  return { document: next, inverse };
}
