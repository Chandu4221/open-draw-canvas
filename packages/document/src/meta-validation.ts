import type { DeviceType, PluginId, StyleId } from "@open-draw/contracts";
import {
  DEVICE_TYPE_BY_VALUE,
  STYLE_PROFILE_BY_VALUE,
  isValidPluginId,
} from "@open-draw/contracts";
import { DocumentError } from "./errors";
import type { ShapeMeta } from "./shape";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseDeviceType(value: unknown): DeviceType {
  if (typeof value !== "string") {
    throw new DocumentError(
      "invalidMeta",
      `device type must be a string: ${JSON.stringify(value)}`,
    );
  }
  const deviceType = DEVICE_TYPE_BY_VALUE[value];
  if (deviceType === undefined) {
    throw new DocumentError("invalidMeta", `unknown device type: ${value}`);
  }
  return deviceType;
}

export function parseMeta(value: unknown, isRootShape = false): ShapeMeta {
  if (!isRecord(value)) {
    throw new DocumentError("invalidMeta", "meta must be an object");
  }
  if (!isRootShape) {
    if (value.style !== undefined) {
      throw new DocumentError("invalidMeta", "style may only be set on root shapes (R-026)");
    }
  }

  let style: StyleId | undefined;
  if (value.style !== undefined) {
    if (typeof value.style !== "string") {
      throw new DocumentError("invalidMeta", "meta.style must be a string");
    }
    style =
      STYLE_PROFILE_BY_VALUE[value.style] ??
      (Object.values(STYLE_PROFILE_BY_VALUE).includes(value.style as StyleId)
        ? (value.style as StyleId)
        : undefined);
    if (style === undefined) {
      throw new DocumentError("invalidMeta", `unknown style: ${value.style}`);
    }
  }

  const order: Partial<Record<DeviceType, number>> = {};
  if (value.order !== undefined) {
    if (!isRecord(value.order)) {
      throw new DocumentError("invalidMeta", "meta.order must be an object");
    }
    for (const [serialized, orderValue] of Object.entries(value.order)) {
      const deviceType = parseDeviceType(serialized);
      if (!isFiniteNumber(orderValue)) {
        throw new DocumentError("invalidMeta", `order for ${serialized} must be a number`);
      }
      order[deviceType] = orderValue;
    }
  }

  let hiddenOn: readonly DeviceType[] | undefined;
  if (value.hiddenOn !== undefined) {
    if (!Array.isArray(value.hiddenOn)) {
      throw new DocumentError("invalidMeta", "meta.hiddenOn must be an array");
    }
    hiddenOn = value.hiddenOn.map(parseDeviceType);
  }

  // R-044: Validate pluginData envelope (PluginId syntax), but treat contents as opaque
  let pluginData: Record<PluginId, unknown> | undefined;
  if (value.pluginData !== undefined) {
    if (!isRecord(value.pluginData)) {
      throw new DocumentError("invalidMeta", "meta.pluginData must be an object");
    }
    pluginData = {};
    for (const [key, pluginVal] of Object.entries(value.pluginData)) {
      if (!isValidPluginId(key)) {
        throw new DocumentError("invalidMeta", `invalid plugin id in meta.pluginData: ${key}`);
      }
      pluginData[key as PluginId] = pluginVal;
    }
  }

  const otherProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k !== "order" && k !== "hiddenOn" && k !== "pluginData" && k !== "style") {
      otherProps[k] = v;
    }
  }

  return {
    ...otherProps,
    order,
    ...(hiddenOn === undefined ? {} : { hiddenOn }),
    ...(pluginData === undefined ? {} : { pluginData }),
    ...(style === undefined ? {} : { style }),
  };
}
