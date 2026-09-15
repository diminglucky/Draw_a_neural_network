const KINDS = new Set(["source", "ir", "image", "prompt", "repository", "config", "artifact"]);
const FIELDS = ["kind", "source", "framework", "ir", "images", "prompt", "sourceId", "metadata", "repository", "revision", "entryPoint", "config", "artifact", "diagnostics"];
const CONTEXT_FIELDS = new Set(["documentPath", "pageName", "renderId", "unitScale", "previewPath"]);

export function normalizeArchitectureInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !KINDS.has(input.kind)) {
    throw invalidInput("kind must be source, ir, image, prompt, repository, config, or artifact");
  }
  const unknown = Object.keys(input).find((key) => !FIELDS.includes(key) && !CONTEXT_FIELDS.has(key));
  if (unknown) throw invalidInput(`unknown field ${unknown}`);
  const result = Object.fromEntries(FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
  const valid = (input.kind === "source" && typeof input.source === "string" && input.source.trim().length > 0)
    || (input.kind === "ir" && input.ir !== null && typeof input.ir === "object" && !Array.isArray(input.ir))
    || (input.kind === "image" && Array.isArray(input.images) && input.images.length > 0)
    || (input.kind === "prompt" && typeof input.prompt === "string" && input.prompt.trim().length > 0)
    || (input.kind === "repository" && typeof input.repository === "string" && input.repository.trim().length > 0)
    || (input.kind === "config" && ((typeof input.config === "string" && input.config.trim()) || (input.config && typeof input.config === "object" && !Array.isArray(input.config))))
    || (input.kind === "artifact" && input.artifact && typeof input.artifact === "object" && !Array.isArray(input.artifact)
      && typeof input.artifact.format === "string" && input.artifact.format.trim().length > 0
      && (typeof input.artifact.path === "string" || input.artifact.data !== undefined));
  if (!valid) throw invalidInput(`missing payload for ${input.kind}`);
  return result;
}

function invalidInput(message) {
  const error = new TypeError(message);
  error.kind = "invalid-input";
  return error;
}
