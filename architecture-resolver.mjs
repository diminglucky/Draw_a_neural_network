import { createHash } from "node:crypto";
import { validateSourceProvenance } from "./source-provenance.mjs";

const FORBIDDEN_REGISTRY_FIELDS = ["nodes", "edges", "layout"];
const PINNED_REVISION = /^[a-f0-9]{7,64}$/i;

export async function resolveArchitectureRequest(input = {}, dependencies = {}) {
  const registry = validateRegistry(dependencies.registry || []);
  if (input.kind === "repository") return resolveRepositoryInput(input, dependencies);

  const query = normalizeText(input.prompt || input.requestedIdentity || "");
  const matches = registry.filter((entry) => (entry.names || []).some((name) => query.includes(normalizeText(name))));
  if (!matches.length) {
    return { status: "unresolved", candidates: [], diagnostics: [{ code: "architecture-identity-unresolved" }] };
  }
  const exact = matches.filter((entry) => (entry.names || []).some((name) => normalizeText(name) === query));
  const selected = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
  if (!selected) {
    return { status: "needs_resolution", candidates: matches.map(publicCandidate), diagnostics: [{ code: "ambiguous-architecture-identity" }] };
  }
  return acquire(selected, dependencies);
}

async function resolveRepositoryInput(input, dependencies) {
  const locator = {
    id: input.sourceId || "repository-input",
    names: [],
    repository: input.repository,
    revision: input.revision,
    configPath: input.entryPoint,
    authority: Number.isFinite(input.metadata?.authority) ? input.metadata.authority : 3,
  };
  return acquire(locator, dependencies);
}

async function acquire(locator, dependencies) {
  if (!PINNED_REVISION.test(String(locator.revision || ""))) {
    return { status: "invalid_source", diagnostics: [{ code: "mutable-revision", sourceId: locator.id }] };
  }
  if (typeof dependencies.fetchRepository !== "function") {
    return { status: "acquisition_required", identity: publicCandidate(locator), diagnostics: [{ code: "repository-fetch-required" }] };
  }
  const request = { repository: locator.repository, revision: locator.revision, path: locator.configPath || locator.entryPoint || "" };
  const acquired = await dependencies.fetchRepository(request);
  const content = acquired?.content ?? "";
  const source = {
    id: String(locator.id),
    kind: acquired?.kind || "repository",
    uri: String(locator.repository || ""),
    revision: String(locator.revision),
    path: request.path,
    content,
    sha256: String(acquired?.sha256 || createHash("sha256").update(typeof content === "string" ? content : JSON.stringify(content)).digest("hex")),
    license: acquired?.license,
    authority: Number.isFinite(locator.authority) ? locator.authority : 0,
  };
  const validation = validateSourceProvenance(source);
  if (!validation.ok) return { status: "invalid_source", diagnostics: validation.issues };
  return { status: "resolved", identity: publicCandidate(locator), sources: [source], diagnostics: [] };
}

function validateRegistry(registry) {
  for (const entry of registry) {
    if (FORBIDDEN_REGISTRY_FIELDS.some((field) => Object.hasOwn(entry, field))) {
      throw new TypeError("Resolver registry must be a source locator only; topology and layout fields are forbidden.");
    }
  }
  return registry;
}

function publicCandidate(entry) {
  return {
    id: String(entry.id || ""),
    names: [...(entry.names || [])],
    repository: String(entry.repository || ""),
    revision: String(entry.revision || ""),
    configPath: String(entry.configPath || ""),
    authority: Number.isFinite(entry.authority) ? entry.authority : 0,
  };
}

function normalizeText(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
