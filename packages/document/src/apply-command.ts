// Mutates a shape record in-place for a single command and returns inverse commands.
// Used by applyTransaction to batch N commands in O(N) without intermediate Document copying (R-018, ADR-0002 D8).
import type { BoundingBox, PluginId, ShapeId } from "@open-draw/contracts";
import { MAX_COORDINATE_BOUND, parsePluginId, SHAPE_KINDS } from "@open-draw/contracts";
import { COMMANDS } from "./commands/registry";
import type { Command } from "./commands";
import type { CreateShape } from "./commands/create-shape";
import type { ShapeScaleHook } from "./commands/set-shape-bounding-box";
import { deriveDeterministicId } from "./commands/duplicate-shapes";
import { applyReorderShapesToMap } from "./commands/reorder-shapes";
import { applySetShapeStyleToMap } from "./commands/set-shape-style";
import type { Document } from "./document";
import { SCHEMA_VERSION } from "./document";
import { DocumentError } from "./errors";
import { pruneSelectedDescendants } from "./reparent";
import { isCustomShape, type LineShape, type PenPathShape, type Shape } from "./shape";
import { subtreeOf } from "./tree";
import { parseShape } from "./validation";

export function applyCommandToMap(
  shapes: Record<ShapeId, Shape>,
  command: Command,
  scaleHook?: ShapeScaleHook,
): readonly Command[] {
  switch (command.type) {
    case COMMANDS.createShape: {
      const shape = parseShape(command.shape);
      if (shapes[shape.id] !== undefined) {
        throw new DocumentError("duplicateShapeId", `shape already exists: ${shape.id}`);
      }
      shapes[shape.id] = shape;
      return [{ type: COMMANDS.deleteShape, id: shape.id as ShapeId }];
    }

    case COMMANDS.deleteShape: {
      const dummyDoc = { schema: { version: SCHEMA_VERSION }, shapes } as unknown as Document;
      const subtree = subtreeOf(dummyDoc, command.id);
      for (const shape of subtree) {
        delete shapes[shape.id];
      }
      return [...subtree].reverse().map((shape): CreateShape => ({
        type: COMMANDS.createShape,
        shape,
      }));
    }

    case COMMANDS.setShapeLabel: {
      const shape = shapes[command.id];
      if (shape === undefined) {
        throw new DocumentError("shapeNotFound", `no shape with id: ${command.id}`);
      }
      const previousLabel = shape.label === undefined ? null : shape.label;
      const targetLabel = command.label === null ? undefined : command.label;
      if (shape.label === targetLabel) {
        return [];
      }
      const nextShape = { ...shape };
      if (command.label === null) {
        delete nextShape.label;
      } else {
        nextShape.label = command.label;
      }
      shapes[command.id] = nextShape as Shape;
      return [{ type: COMMANDS.setShapeLabel, id: command.id, label: previousLabel }];
    }

    case COMMANDS.reparentShape: {
      const shape = shapes[command.id];
      if (shape === undefined) {
        throw new DocumentError("shapeNotFound", `no shape with id: ${command.id}`);
      }
      const previousParentId = shape.parentId;
      const previousBoundingBox = shape.boundingBox;
      const targetParentId = command.parentId ?? command.parent!;
      const clampedBox = {
        x: Math.max(-MAX_COORDINATE_BOUND, Math.min(MAX_COORDINATE_BOUND, command.boundingBox.x)),
        y: Math.max(-MAX_COORDINATE_BOUND, Math.min(MAX_COORDINATE_BOUND, command.boundingBox.y)),
        width: Math.min(MAX_COORDINATE_BOUND, Math.max(1, command.boundingBox.width)),
        height: Math.min(MAX_COORDINATE_BOUND, Math.max(1, command.boundingBox.height)),
      };
      if (
        previousParentId === targetParentId &&
        previousBoundingBox.x === clampedBox.x &&
        previousBoundingBox.y === clampedBox.y &&
        previousBoundingBox.width === clampedBox.width &&
        previousBoundingBox.height === clampedBox.height
      ) {
        return [];
      }
      shapes[command.id] = { ...shape, parentId: targetParentId, boundingBox: clampedBox };
      return [
        {
          type: COMMANDS.reparentShape,
          id: command.id,
          parentId: previousParentId,
          boundingBox: previousBoundingBox,
        },
      ];
    }

    case COMMANDS.moveShapes: {
      for (const id of command.ids) {
        if (shapes[id] === undefined) {
          throw new DocumentError("shapeNotFound", `no shape with id: ${id}`);
        }
      }
      if (command.dx === 0 && command.dy === 0) {
        return [];
      }
      let allExactDeltasMatch = true;
      const originalBoxes = new Map<ShapeId, BoundingBox>();
      for (const id of command.ids) {
        const shape = shapes[id]!;
        originalBoxes.set(id, shape.boundingBox);
        const newX = Math.max(
          -MAX_COORDINATE_BOUND,
          Math.min(MAX_COORDINATE_BOUND, shape.boundingBox.x + command.dx),
        );
        const newY = Math.max(
          -MAX_COORDINATE_BOUND,
          Math.min(MAX_COORDINATE_BOUND, shape.boundingBox.y + command.dy),
        );
        if (
          newX - shape.boundingBox.x !== command.dx ||
          newY - shape.boundingBox.y !== command.dy
        ) {
          allExactDeltasMatch = false;
        }
        shapes[id] = {
          ...shape,
          boundingBox: {
            ...shape.boundingBox,
            x: newX,
            y: newY,
          },
        };
      }
      if (allExactDeltasMatch) {
        return [{ type: COMMANDS.moveShapes, ids: command.ids, dx: -command.dx, dy: -command.dy }];
      }
      return command.ids.map((id) => {
        const orig = originalBoxes.get(id)!;
        const moved = shapes[id]!;
        return {
          type: COMMANDS.moveShapes,
          ids: [id],
          dx: -(moved.boundingBox.x - orig.x),
          dy: -(moved.boundingBox.y - orig.y),
        };
      });
    }

    case COMMANDS.setShapeBoundingBox: {
      const shape = shapes[command.id];
      if (shape === undefined) {
        throw new DocumentError("shapeNotFound", `no shape with id: ${command.id}`);
      }
      if (
        !Number.isFinite(command.boundingBox.x) ||
        !Number.isFinite(command.boundingBox.y) ||
        !Number.isFinite(command.boundingBox.width) ||
        !Number.isFinite(command.boundingBox.height) ||
        command.boundingBox.width <= 0 ||
        command.boundingBox.height <= 0
      ) {
        throw new DocumentError(
          "invalidShape",
          "boundingBox must have finite position and positive dimensions",
        );
      }
      const previousBox = shape.boundingBox;
      const targetBox: BoundingBox = {
        x: Math.max(-MAX_COORDINATE_BOUND, Math.min(MAX_COORDINATE_BOUND, command.boundingBox.x)),
        y: Math.max(-MAX_COORDINATE_BOUND, Math.min(MAX_COORDINATE_BOUND, command.boundingBox.y)),
        width: Math.min(MAX_COORDINATE_BOUND, Math.max(1, command.boundingBox.width)),
        height: Math.min(MAX_COORDINATE_BOUND, Math.max(1, command.boundingBox.height)),
      };
      if (
        scaleHook === undefined &&
        command.pointsSnapshot === undefined &&
        previousBox.x === targetBox.x &&
        previousBox.y === targetBox.y &&
        previousBox.width === targetBox.width &&
        previousBox.height === targetBox.height
      ) {
        return [];
      }

      const previousSnapshot =
        shape.kind === SHAPE_KINDS.line
          ? { start: (shape as LineShape).start, end: (shape as LineShape).end }
          : shape.kind === SHAPE_KINDS.penPath
            ? { points: (shape as PenPathShape).points }
            : undefined;

      let nextShape: Shape;
      if (scaleHook !== undefined) {
        nextShape = scaleHook(shape, previousBox, targetBox);
      } else if (!isCustomShape(shape)) {
        switch (shape.kind) {
          case SHAPE_KINDS.line: {
            if (
              command.pointsSnapshot?.start !== undefined &&
              command.pointsSnapshot?.end !== undefined
            ) {
              nextShape = {
                ...shape,
                boundingBox: targetBox,
                start: command.pointsSnapshot.start,
                end: command.pointsSnapshot.end,
              };
            } else {
              const scaleX = previousBox.width === 0 ? 1 : targetBox.width / previousBox.width;
              const scaleY = previousBox.height === 0 ? 1 : targetBox.height / previousBox.height;
              nextShape = {
                ...shape,
                boundingBox: targetBox,
                start: { x: shape.start.x * scaleX, y: shape.start.y * scaleY },
                end: { x: shape.end.x * scaleX, y: shape.end.y * scaleY },
              };
            }
            break;
          }
          case SHAPE_KINDS.penPath: {
            if (command.pointsSnapshot?.points !== undefined) {
              nextShape = {
                ...shape,
                boundingBox: targetBox,
                points: command.pointsSnapshot.points,
              };
            } else {
              const scaleX = previousBox.width === 0 ? 1 : targetBox.width / previousBox.width;
              const scaleY = previousBox.height === 0 ? 1 : targetBox.height / previousBox.height;
              nextShape = {
                ...shape,
                boundingBox: targetBox,
                points: shape.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })),
              };
            }
            break;
          }
          default: {
            nextShape = { ...shape, boundingBox: targetBox };
            break;
          }
        }
      } else {
        nextShape = { ...shape, boundingBox: targetBox };
      }

      shapes[command.id] = nextShape;
      return [
        {
          type: COMMANDS.setShapeBoundingBox,
          id: command.id,
          boundingBox: previousBox,
          ...(previousSnapshot !== undefined ? { pointsSnapshot: previousSnapshot } : {}),
        },
      ];
    }

    case COMMANDS.setShapeStyle: {
      return applySetShapeStyleToMap(shapes, command);
    }

    case COMMANDS.setShapeContent: {
      const shape = shapes[command.id];
      if (shape === undefined) {
        throw new DocumentError("shapeNotFound", `no shape with id: ${command.id}`);
      }
      const previousContent = shape.content === undefined ? null : shape.content;
      const targetContent = command.content === null ? undefined : command.content;
      if (shape.content === targetContent) {
        return [];
      }
      const nextShape = { ...shape };
      if (command.content === null) {
        delete nextShape.content;
      } else {
        nextShape.content = command.content;
      }
      shapes[command.id] = nextShape as Shape;
      return [{ type: COMMANDS.setShapeContent, id: command.id, content: previousContent }];
    }

    case COMMANDS.duplicateShapes: {
      const dummyDoc = { schema: { version: SCHEMA_VERSION }, shapes } as unknown as Document;
      for (const id of command.ids) {
        if (shapes[id] === undefined) {
          throw new DocumentError("shapeNotFound", `no shape with id: ${id}`);
        }
      }
      const topLevelIds = pruneSelectedDescendants(dummyDoc, command.ids);
      if (topLevelIds.length === 0) {
        return [];
      }
      const dx = command.dx ?? 20;
      const dy = command.dy ?? 20;
      const shapesToClone: Shape[] = [];
      const topLevelSet = new Set<ShapeId>(topLevelIds);
      for (const topId of topLevelIds) {
        shapesToClone.push(...subtreeOf(dummyDoc, topId));
      }
      const idMap = new Map<ShapeId, ShapeId>();
      const usedIds = new Set<ShapeId>();
      for (const shape of shapesToClone) {
        const mapped = command.newShapeIds?.[shape.id];
        const newId = mapped ?? deriveDeterministicId(dummyDoc, usedIds, shape.id);
        idMap.set(shape.id, newId);
        usedIds.add(newId);
      }
      for (const shape of shapesToClone) {
        const isTopLevel = topLevelSet.has(shape.id);
        const newId = idMap.get(shape.id)!;
        const newParentId = isTopLevel
          ? shape.parentId
          : (idMap.get(shape.parentId) ?? shape.parentId);
        const newBoundingBox = isTopLevel
          ? {
              ...shape.boundingBox,
              x: Math.max(
                -MAX_COORDINATE_BOUND,
                Math.min(MAX_COORDINATE_BOUND, shape.boundingBox.x + dx),
              ),
              y: Math.max(
                -MAX_COORDINATE_BOUND,
                Math.min(MAX_COORDINATE_BOUND, shape.boundingBox.y + dy),
              ),
            }
          : shape.boundingBox;
        shapes[newId] = {
          ...shape,
          id: newId,
          parentId: newParentId,
          boundingBox: newBoundingBox,
        };
      }
      return topLevelIds.map((oldId) => ({
        type: COMMANDS.deleteShape,
        id: idMap.get(oldId)!,
      }));
    }

    case COMMANDS.setShapePluginData: {
      const shape = shapes[command.id];
      if (shape === undefined) {
        throw new DocumentError("shapeNotFound", `no shape with id: ${command.id}`);
      }
      const pluginId = parsePluginId(command.pluginId);
      const previousData = shape.meta.pluginData?.[pluginId] ?? null;
      if (previousData === command.data) {
        return [];
      }
      const nextPluginData: Record<PluginId, unknown> = {
        ...(shape.meta.pluginData ?? {}),
      };
      if (command.data === null || command.data === undefined) {
        delete nextPluginData[pluginId];
      } else {
        nextPluginData[pluginId] = command.data;
      }
      const nextMeta = {
        ...shape.meta,
        ...(Object.keys(nextPluginData).length === 0 ? {} : { pluginData: nextPluginData }),
      };
      if (Object.keys(nextPluginData).length === 0) {
        delete (nextMeta as { pluginData?: unknown }).pluginData;
      }
      shapes[command.id] = { ...shape, meta: nextMeta };
      return [
        {
          type: COMMANDS.setShapePluginData,
          id: command.id,
          pluginId,
          data: previousData,
        },
      ];
    }

    case COMMANDS.reorderShapes: {
      return applyReorderShapesToMap(shapes, command);
    }
  }
}
