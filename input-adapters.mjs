const KINDS = new Set(["source", "ir", "image", "prompt"]);
const FIELDS = ["kind", "source", "framework", "ir", "images", "prompt", "sourceId", "metadata"];

export function normalizeArchitectureInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !KINDS.has(input.kind)) {
    throw invalidInput("kind must be source, ir, image, or prompt");
  }
  const result = Object.fromEntries(FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
  const valid = (input.kind === "source" && typeof input.source === "string" && input.source.trim().length > 0)
    || (input.kind === "ir" && input.ir !== null && typeof input.ir === "object" && !Array.isArray(input.ir))
    || (input.kind === "image" && Array.isArray(input.images) && input.images.length > 0)
    || (input.kind === "prompt" && typeof input.prompt === "string" && input.prompt.trim().length > 0);
  if (!valid) throw invalidInput(`missing payload for ${input.kind}`);
  return result;
}

function invalidInput(message) {
  const error = new TypeError(message);
  error.kind = "invalid-input";
  return error;
}
