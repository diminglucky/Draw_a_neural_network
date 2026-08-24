# Drawing Run UI Smoke Evidence

**Verification timestamp:** `2026-08-23T04:13:08Z` (`Asia/Shanghai 12:13:08`)
**Branch:** `agent`
**Scope:** authenticated browser status surface and receipt-bound Drawing Run route

## Verified

- Started the API with `NODE_ENV=development`, `STORAGE_DRIVER=memory`, and `LEASE_DRIVER=memory`.
- Loaded `http://127.0.0.1:4173/index.html` and confirmed the page rendered without a module-load failure.
- Registered and authorized a browser device through the real auth routes.
- Confirmed the right-side Drawing Run panel changed from `等待授权后加载` to an owner-scoped run list after authorization and polling.
- Submitted source through `提交到 Agent Run`; the browser made the start request and then uploaded a private `pytorch_source` receipt with a client-computed SHA-256 digest.
- Confirmed the API returned a revision-bound run and the panel displayed a terminal `rejected` state for malformed source input.
- Focused client verification confirms the panel displays only a bounded public error category such as `结构解释结果无效`, without rendering proposal hashes, receipt IDs, source bytes, or paths.

## Evidence boundary

This is a local development UI/API smoke record. It proves the browser-to-API status path and receipt submission wiring only. It does not prove Provider quality, M2.12 acceptance, browser visual acceptance, Windows/Visio creation, save/reopen, or independent native readback. The legacy Agent Chat and image workflow remain outside the LangGraph Drawing Run route.

## Automated verification

- `npx vitest run apps/api/tests/drawing-run/public-projection.test.ts apps/client/drawing-run-client.test.js` — 2 files, 7 tests passed.
- `npx tsc --noEmit` — passed.
- `git diff --check` — passed.
