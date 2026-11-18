import type { ShapeId } from "@open-draw/contracts";
import { applyCommandToMap } from "./apply-command";
import type { Command, CommandResult } from "./commands";
import { COMMANDS } from "./commands/registry";
import { createDocumentFromMap, type Document } from "./document";
import { DocumentError } from "./errors";
import type { Shape } from "./shape";

function extractAffectedShapeIds(command: Command): readonly ShapeId[] | null {
  switch (command.type) {
    case COMMANDS.createShape:
      return [command.shape.id as ShapeId];
    case COMMANDS.deleteShape:
      return [command.id];
    case COMMANDS.moveShapes:
    case COMMANDS.reorderShapes:
      return command.ids;
    case COMMANDS.reparentShape:
    case COMMANDS.setShapeBoundingBox:
    case COMMANDS.setShapeContent:
    case COMMANDS.setShapeLabel:
    case COMMANDS.setShapePluginData:
    case COMMANDS.setShapeStyle:
      return [command.id];
    case COMMANDS.duplicateShapes:
      return null;
  }
}

export interface Transaction {
  readonly commands: readonly Command[];
}

export function createTransaction(commands: readonly Command[]): Transaction {
  if (commands.length === 0) {
    throw new DocumentError("invalidCommand", "a transaction requires at least one command");
  }
  return Object.freeze({ commands });
}

export interface TransactionResult {
  readonly document: Document;
  readonly inverse: readonly Command[];
}

export function applyCommand(document: Document, command: Command): CommandResult {
  const shapes: Record<ShapeId, Shape> = { ...document.shapes };
  const inverse = applyCommandToMap(shapes, command);
  if (inverse.length === 0) {
    return { document, inverse: [] };
  }
  const affected = extractAffectedShapeIds(command);
  const options = affected !== null ? { validateOnlyIds: affected } : undefined;
  return { document: createDocumentFromMap(shapes, options), inverse };
}

export function applyTransaction(document: Document, transaction: Transaction): TransactionResult {
  const shapes: Record<ShapeId, Shape> = { ...document.shapes };
  const inverse: Command[] = [];
  const affected = new Set<ShapeId>();
  let hasUnknownAffected = false;

  for (const command of transaction.commands) {
    const inv = applyCommandToMap(shapes, command);
    inverse.push(...inv);
    if (!hasUnknownAffected) {
      const ids = extractAffectedShapeIds(command);
      if (ids === null) {
        hasUnknownAffected = true;
      } else {
        for (const id of ids) {
          affected.add(id);
        }
      }
    }
  }
  if (inverse.length === 0) {
    return { document, inverse: [] };
  }
  const options = hasUnknownAffected ? undefined : { validateOnlyIds: affected };
  const nextDoc = createDocumentFromMap(shapes, options);
  // Undo runs the inverses back-to-front.
  return { document: nextDoc, inverse: inverse.reverse() };
}
