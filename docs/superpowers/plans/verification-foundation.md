# Commercial Foundation Verification Plan

This document separates source-level checks from runtime and production acceptance. A passing local test suite does not prove that PostgreSQL, Redis, OpenAI, Visio, billing, or a signed Windows package are ready for sale.

## Local source checks

```powershell
npm run api:test
npm run api:check
npx tsc --noEmit
node --check server.js
node --check app.js
node --check models.js
node --check code-workflow.js
node --check ai-workflow.js
node --check apps/client/auth-gate.js
node --check apps/admin/admin.js
git diff --check
```

Expected evidence:

- API domain, security, session, Job, route, persistence-boundary, and client-gate tests pass;
- migration and infrastructure boundary check reports all required durable identifiers;
- no JavaScript syntax or TypeScript errors;
- no whitespace errors.

The Redis integration has an additional Docker-backed check:

```powershell
npm run api:smoke:redis
```

It must prove a real claim, competing-claim rejection, renewal, TTL expiry and takeover, monotonic fencing tokens, stale-release protection, and final release against the Redis service.

Latest source verification on 2026-08-11:

- 15 test files passed;
- 41 tests passed;
- `npm run api:check`, `npx tsc --noEmit`, JavaScript syntax checks, and `git diff --check` passed.

## Local host acceptance

1. Start `npm run api:dev` and confirm `GET http://127.0.0.1:4180/health` returns `{ "status": "ok" }`.
2. Start `node server.js` and open the client at port 4173.
3. Confirm a fresh browser is locked before login.
4. Register a user, confirm the canvas unlocks, and inspect the session/device/subscription status.
5. Open a second client with the same account and confirm `ACCOUNT_ALREADY_IN_USE`.
6. Revoke the first session in the admin console and confirm its heartbeat locks the client.
7. Confirm the analysis endpoint rejects a request without `Authorization` and accepts only an active Foundation session.

## Production gates still pending

- PostgreSQL persistence and the Redis lease adapter are implemented and have local smoke-test paths; fencing must still be bound into PostgreSQL session claims and accepted under concurrent multi-instance login;
- Windows DPAPI device-key creation, signature proof, uninstall/reinstall, and machine-change policy must be tested;
- signed installer, update, crash recovery, telemetry redaction, rate limits, billing webhooks, backups, and restore must be accepted;
- real OpenAI and Visio integrations require separate credentialed acceptance and must not be inferred from the placeholder adapters.

The PostgreSQL smoke command is available as `npm run api:smoke:postgres`. It passed on 2026-08-11 after Docker Desktop was started. The API was also started with `STORAGE_DRIVER=postgres`, a user/device/session was created, the API was restarted, and the original session read back successfully from PostgreSQL. Redis container health was confirmed with `PONG`.
