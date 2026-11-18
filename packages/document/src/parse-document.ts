import { MAX_DOCUMENT_BYTE_SIZE } from "@open-draw/contracts";
import type { Document } from "./document";
import { DocumentError } from "./errors";
import { parseDocument as parseDocumentFromUnknown } from "./validation";

export function parseDocument(json: string): Document {
  if (typeof json !== "string") {
    throw new DocumentError("invalidDocument", "serialized document must be a string");
  }
  if (json.length > MAX_DOCUMENT_BYTE_SIZE) {
    throw new DocumentError(
      "documentSizeExceeded",
      `document byte length (${json.length}) exceeds maximum limit (${MAX_DOCUMENT_BYTE_SIZE})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new DocumentError(
      "invalidDocument",
      `invalid JSON syntax: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DocumentError("invalidDocument", "serialized document must be an object");
  }

  return parseDocumentFromUnknown(parsed);
}
