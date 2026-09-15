/** Small fail-closed JSON Schema subset for learned capability boundaries. */

const ALLOWED = new Set([
  "$schema", "title", "description", "type", "properties", "required", "additionalProperties",
  "items", "enum", "const", "anyOf", "oneOf", "allOf", "minimum", "maximum", "minLength",
  "maxLength", "minItems", "maxItems", "nullable", "default", "format",
]);

export class JsonContractError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} at ${path}`);
    this.name = "JsonContractError";
  }
}

export function assertSupportedJsonSchema(schema: unknown, path = "$schema"): asserts schema is Record<string, unknown> {
  if (!record(schema)) throw new JsonContractError("Schema must be an object", path);
  for (const key of Object.keys(schema)) {
    if (!ALLOWED.has(key)) throw new JsonContractError(`Unsupported schema keyword ${key}`, path);
  }
  if (schema.properties !== undefined) {
    if (!record(schema.properties)) throw new JsonContractError("properties must be an object", path);
    for (const [key, child] of Object.entries(schema.properties)) assertSupportedJsonSchema(child, `${path}.properties.${key}`);
  }
  if (schema.items !== undefined) assertSupportedJsonSchema(schema.items, `${path}.items`);
  for (const combinator of ["anyOf", "oneOf", "allOf"] as const) {
    if (schema[combinator] === undefined) continue;
    if (!Array.isArray(schema[combinator]) || schema[combinator].length === 0) {
      throw new JsonContractError(`${combinator} must be a non-empty array`, path);
    }
    schema[combinator].forEach((child, index) => assertSupportedJsonSchema(child, `${path}.${combinator}[${index}]`));
  }
}

export function assertJsonContract(value: unknown, schema: unknown, path = "$input"): void {
  assertSupportedJsonSchema(schema);
  validate(value, schema, path);
}

function validate(value: unknown, schema: Record<string, unknown>, path: string): void {
  if (schema.nullable === true && value === null) return;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => canonical(item) === canonical(value))) {
    throw new JsonContractError("Value is outside enum", path);
  }
  if ("const" in schema && canonical(schema.const) !== canonical(value)) throw new JsonContractError("Value does not match const", path);

  for (const combinator of ["allOf"] as const) {
    const schemas = schema[combinator];
    if (Array.isArray(schemas)) schemas.forEach((child) => validate(value, child as Record<string, unknown>, path));
  }
  for (const combinator of ["anyOf", "oneOf"] as const) {
    const schemas = schema[combinator];
    if (!Array.isArray(schemas)) continue;
    const matches = schemas.filter((child) => { try { validate(value, child as Record<string, unknown>, path); return true; } catch { return false; } }).length;
    if ((combinator === "anyOf" && matches === 0) || (combinator === "oneOf" && matches !== 1)) {
      throw new JsonContractError(`Value does not satisfy ${combinator}`, path);
    }
  }

  const type = schema.type;
  if (type !== undefined && typeof type !== "string") throw new JsonContractError("type must be a string", path);
  if (type === "object") {
    if (!record(value)) throw new JsonContractError("Expected object", path);
    const properties = record(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key !== "string" || !Object.hasOwn(value, key)) throw new JsonContractError(`Missing required property ${String(key)}`, path);
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find((key) => !Object.hasOwn(properties, key));
      if (unknown) throw new JsonContractError(`Unknown property ${unknown}`, path);
    }
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(value, key)) validate(value[key], child as Record<string, unknown>, `${path}.${key}`);
  } else if (type === "array") {
    if (!Array.isArray(value)) throw new JsonContractError("Expected array", path);
    range(value.length, schema.minItems, schema.maxItems, path);
    if (record(schema.items)) value.forEach((item, index) => validate(item, schema.items as Record<string, unknown>, `${path}[${index}]`));
  } else if (type === "string") {
    if (typeof value !== "string") throw new JsonContractError("Expected string", path);
    range(value.length, schema.minLength, schema.maxLength, path);
  } else if (type === "number" || type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) {
      throw new JsonContractError(`Expected ${type}`, path);
    }
    range(value, schema.minimum, schema.maximum, path);
  } else if (type === "boolean" && typeof value !== "boolean") throw new JsonContractError("Expected boolean", path);
  else if (type === "null" && value !== null) throw new JsonContractError("Expected null", path);
}

function range(value: number, minimum: unknown, maximum: unknown, path: string): void {
  if (typeof minimum === "number" && value < minimum) throw new JsonContractError("Value is below minimum", path);
  if (typeof maximum === "number" && value > maximum) throw new JsonContractError("Value is above maximum", path);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
