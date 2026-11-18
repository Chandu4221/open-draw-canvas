// XML / SVG text and attribute escaping (R-008, R-016).
// Escapes &, <, >, ", and ' to XML entities.

function stripDisallowedXmlControlChars(value: string): string {
  let hasControl = false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      hasControl = true;
      break;
    }
  }
  if (!hasControl) {
    return value;
  }
  let result = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      continue;
    }
    result += value[i];
  }
  return result;
}

/**
 * Escapes special XML characters for safe embedding in SVG text nodes and attribute values,
 * stripping disallowed XML 1.0 control characters.
 */
export function escapeXml(value: string): string {
  return stripDisallowedXmlControlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
