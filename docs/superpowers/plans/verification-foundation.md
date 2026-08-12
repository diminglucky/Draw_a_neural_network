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
node --check apps/desktop/device-key-store.mjs
node --check apps/desktop/main.mjs
node --check apps/desktop/preload.cjs
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

- 21 test files passed;
- 63 tests passed;
- `npm run api:check`, `npx tsc --noEmit`, JavaScript syntax checks, and `git diff --check` passed.

Admin control-plane V1 verification on 2026-08-12:

- 26 Vitest files passed; 87 tests passed, including user/device status transitions, affected-session revocation, audit records, invalid admin mutations, disabled-session boundaries, admin-page helpers, and client-gate lock behavior after `SESSION_REVOKED`;
- `npm run api:check`, `npx tsc --noEmit`, admin/desktop/client JavaScript syntax checks, and `git diff --check` passed;
- PostgreSQL and Redis smoke tests passed;
- `npm run api:smoke:admin:durable` passed against the running PostgreSQL and Redis containers: administrator disable/enable, persisted session revocation, persisted user/session audit records, and fresh login after re-enable;
- temporary live HTTP acceptance passed: register/login, administrator disable, old-token rejection, administrator re-enable, fresh-login requirement, and admin page/script HTTP 200;
- the live HTTP acceptance used the development in-memory API and did not claim Electron DPAPI process acceptance.

Windows Electron verification on 2026-08-12:

- `npm run desktop:smoke` passed with Electron 43.3.0, stable public key/device ID, and a valid challenge signature;
- `npm run desktop:rebuild` passed for `argon2` and `vendor/win-dpapi`;
- a real Electron window login, restart, administrator revocation, heartbeat lock, and re-login flow remains a separate pending host-UI acceptance gate.

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

The PostgreSQL smoke command is available as `npm run api:smoke:postgres`. It verifies persistence, one-active-session fencing, takeover after the old session is expired, rejection of stale fencing-token updates, and one-time device challenge consumption/replay/expiry behavior. It passed on 2026-08-11 after Docker Desktop was started. The API was also started with `STORAGE_DRIVER=postgres`, a user/device/session was created, the API was restarted, and the original session read back successfully from PostgreSQL. Redis container health was confirmed with `PONG`.

## Windows Electron acceptance

Run these commands on Windows after `npm install`:

```powershell
npm run desktop:rebuild
npm run desktop:smoke
```

The rebuild proves the native DPAPI addon is compiled for the Electron ABI; the smoke proves DPAPI protect/unprotect, write-once server device-id binding, stable public-key reload, and challenge signature verification. A passing Node ABI build alone is insufficient. Non-Windows environments must report `DESKTOP_WINDOWS_REQUIRED` and cannot claim this gate.

The Electron authorization data-flow test also verifies that registration binds the returned server `device.id` before proof-required login. Full UI acceptance must still cover a real Electron restart, session refresh, admin revocation, and clean-machine installation.
