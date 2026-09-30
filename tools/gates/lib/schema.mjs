// Minimal JSON Schema subset validator (no dependencies), so gate checks run anywhere Node runs.
// Supported keywords: type, required, properties, additionalProperties (boolean), enum, const,
// pattern, minLength, minItems, uniqueItems, items, minimum, maximum, format: "date-time", $ref (local #/$defs/x).

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  return actual === t;
}

export function validate(schema, value, root = schema, path = "$") {
  const errors = [];
  if (schema.$ref) {
    const name = schema.$ref.replace("#/$defs/", "");
    const target = root.$defs && root.$defs[name];
    if (!target) return [`${path}: unresolved $ref ${schema.$ref}`];
    return validate(target, value, root, path);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      return [`${path}: expected ${types.join("|")}, got ${typeOf(value)}`];
    }
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: '${value}' not in [${schema.enum.join(", ")}]`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: '${value}' does not match /${schema.pattern}/`);
    if (schema.format === "date-time" && !DATE_TIME.test(value)) errors.push(`${path}: '${value}' is not an ISO-8601 date-time`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.uniqueItems) {
      const seen = new Set(value.map((x) => JSON.stringify(x)));
      if (seen.size !== value.length) errors.push(`${path}: items are not unique`);
    }
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, root, `${path}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      // Object.hasOwn, not `in`: a key named after an Object.prototype member (constructor, toString, hasOwnProperty,
      // __proto__) is inherited by every object, so `in` would report it present even when absent (D-038, F-DG0-163).
      if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required property '${key}'`);
    }
    const props = schema.properties || {};
    for (const [key, v] of Object.entries(value)) {
      // Object.hasOwn, not props[key]: props['constructor'] etc. resolve to a truthy Object.prototype member, which would
      // be "validated" against a keyword-less function and silently accepted, bypassing additionalProperties:false (F-DG0-163).
      if (Object.hasOwn(props, key)) errors.push(...validate(props[key], v, root, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property '${key}'`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validate(schema.additionalProperties, v, root, `${path}.${key}`));
      }
    }
  }
  return errors;
}
