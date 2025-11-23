/**
 * Schema validation utilities
 */

import type { SchemaLike } from "./types";

export async function validateWithSchema<T>(schema: SchemaLike<T> | undefined, value: unknown): Promise<T> {
  if (!schema) {
    return value as T;
  }
  if (schema.safeParseAsync) {
    const result = await schema.safeParseAsync(value);
    if (!result.success) {
      throw new Error(readableSchemaError(result.error));
    }
    return result.data;
  }
  if (schema.safeParse) {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new Error(readableSchemaError(result.error));
    }
    return result.data;
  }
  if (schema.parse) {
    return schema.parse(value);
  }
  return value as T;
}

function readableSchemaError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
