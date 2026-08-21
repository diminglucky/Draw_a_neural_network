# Universal PVP Preview Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the verified typed-prompt/static-PyTorch → UGS → GPG → PVP preview path through one authenticated, versioned, owner/device-bound HTTP endpoint.

**Architecture:** `POST /api/universal-figure-previews` is a new Figure API v4 route. It strictly parses a bounded input union, verifies the static source digest, derives preview update identity from the authenticated user/device plus a server hash, calls `compileUniversalInputToPublicationPreview`, then returns `projectPublicationVisualPlanPreview`. It creates only a source-free audit event; it does not create a draft, snapshot, export request, job, Worker call, COM call, or file artifact.

**Tech Stack:** Fastify, TypeScript, Vitest, existing SessionService, universal input compilation service, and safe PVP preview projection.

## Global Constraints

- Keep `/api/figure-analyses` and all v3 contracts unchanged.
- Require `Accept-Figure-Version: 4` and respond with `Figure-Version: 4`.
- Require authenticated access; derive `ownerId` and `deviceId` from the session, never from request body.
- Body may contain only `{ input, detail? }`; no browser diagram, renderer/Worker/COM field, path, update identity, export option, or arbitrary property is accepted.
- Support exactly `typed-prompt` and `static-pytorch` inputs. Prompt/code remain bounded at 200,000 UTF-8 bytes; static code must match supplied SHA-256 before compilation.
- Return only the safe projection. Never return raw prompt, Python source, evidence/source mappings, PVP update identity, lineage, renderer requirements, Worker/COM details, or file paths.
- Candidate remains previewable but is always export-ineligible. This endpoint has zero snapshot/export/job/Worker/COM/filesystem side effects.
- Audit metadata contains only version, input kind, preview kind, export flag, plan ID, and plan hash; never source ID, prompt, code, digest, path, evidence, update identity, or renderer data.

---

### Task 1: Versioned owner-scoped universal preview route

**Files:**
- Modify: `apps/api/src/routes.ts`
- Create: `apps/api/tests/universal-pvp-preview-routes.test.ts`

**Interfaces:**
- Consumes: `compileUniversalInputToPublicationPreview(input, { detail, updateIdentity })` and `projectPublicationVisualPlanPreview({ graph, pvp })`.
- Produces: `POST /api/universal-figure-previews` with v4 public preview response.

- [ ] **Step 1: Write the failing route tests**

```ts
const response = await app.inject({
  method: "POST",
  url: "/api/universal-figure-previews",
  headers: { authorization, "accept-figure-version": "4" },
  payload: { input: typedPromptInput },
});

expect(response.statusCode).toBe(200);
expect(response.headers["figure-version"]).toBe("4");
expect(response.json()).toMatchObject({ schemaVersion: 1, kind: "formal", exportEligible: false });
expect(response.body).not.toMatch(/prompt|source|worker|com|path|updateIdentity|sourceMappings/i);
```

Also add: missing v4 header is 400; missing authentication is 401; dynamic static source is candidate/export-ineligible; mismatched static digest is 400; forbidden body fields are 400; no jobs are created and audit metadata contains only the allowlisted metadata.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm run api:test -- apps/api/tests/universal-pvp-preview-routes.test.ts`

Expected: FAIL because the new route is not registered.

- [ ] **Step 3: Implement strict parsing, routing, audit, and projection**

```ts
app.post("/api/universal-figure-previews", async (request, reply) => {
  universalPreviewVersion(request);
  const access = await requireUser(request, options);
  const input = parseUniversalPreviewBody(request);
  const preview = compileUniversalInputToPublicationPreview(input, {
    detail: parsedDetail,
    updateIdentity: serverDerivedPreviewIdentity(access, input),
  });
  const publicPreview = projectPublicationVisualPlanPreview(preview);
  await auditUniversalPreview(options.store, access.user.id, input.kind, publicPreview);
  reply.header("Figure-Version", "4");
  return reply.send(publicPreview);
});
```

The parser must reject unknown fields and validate bounded text, safe source ID, detail enum, positive revision, static SHA-256 format, and static-code SHA-256 equality. The identity derivation must use only authenticated user/device and a server SHA-256; it must not echo client-controlled page/document identity.

- [ ] **Step 4: Run focused route test to verify GREEN**

Run: `npm run api:test -- apps/api/tests/universal-pvp-preview-routes.test.ts`

Expected: PASS.

### Task 2: Regression and boundary checks

**Files:**
- Test: `apps/api/tests/universal-pvp-preview-routes.test.ts`

- [ ] **Step 1: Run route plus PVP safety regressions**

Run:

```powershell
npm run api:test -- apps/api/tests/universal-pvp-preview-routes.test.ts apps/api/tests/universal-input-compilation-service.test.ts apps/api/tests/publication-visual-plan-preview.test.ts apps/api/tests/universal-pvp-preview-convergence.test.ts
npx tsc --noEmit
npm run api:check
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Run full API suite**

Run: `npm run api:test`

Expected: all tests pass. Confirm no old v3 route contract changed and no new source/Worker/Visio side effect is introduced.
