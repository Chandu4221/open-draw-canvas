// Meta validation for shapes (R-006, R-044).
// Validates meta object structure, prototype pollution guards, and pluginData envelope.
import type { PluginId } from "@open-draw/contracts";
import { isValidPluginId } from "@open-draw/contracts";
import { DocumentError } from "./errors";
import type { ShapeMeta } from "./shape";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMeta(value: unknown): ShapeMeta {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new DocumentError("invalidMeta", "meta must be an object");
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "__proto__") ||
    Object.prototype.hasOwnProperty.call(value, "constructor")
  ) {
    throw new DocumentError(
      "invalidMeta",
      "prototype pollution keys (__proto__, constructor) are forbidden in meta",
    );
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
    if (k !== "pluginData") {
      otherProps[k] = v;
    }
  }

  return {
    ...otherProps,
    ...(pluginData === undefined ? {} : { pluginData }),
  };
}
