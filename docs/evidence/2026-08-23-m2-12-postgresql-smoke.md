# PostgreSQL Smoke Evidence

**Date:** 2026-08-23
**Branch:** `agent`
**Implementation commit:** `162dfa7a23265e5ceea799d87c596a92cce40d51`
**Scope:** local PostgreSQL adapter smoke only; this is not M2.12 acceptance.

## Command

```powershell
npm run api:smoke:postgres
```

The smoke ran against a real temporary PostgreSQL 18 container using the locally cached `postgres:18-alpine` image. The container had no persistent data volume and was removed after the run. This avoided changing the project compose layout or relying on Docker Hub network access.

## Passed

- migrations `001` through `014` applied to a real PostgreSQL server;
- session fencing, device challenge consumption, and Agent usage idempotency/readback;
- Drawing Run and event persistence/readback;
- private receipt content readback, ephemeral deletion, and `owner_revision` retention;
- owner-scoped EvidencePack, local proposal, and drawing artifact persistence/readback from a second connection;
- hash and owner-bound checks exercised by the smoke script.

## Not Proven

- PostgreSQL LangGraph checkpoint saver round-trip or checkpoint restart recovery;
- API process restart recovery against the database;
- Redis durability or production service configuration;
- live Provider behavior;
- Windows/Visio creation, save, reopen, native readback, or visual acceptance;
- M2.12 acceptance, which still requires focused/full regression evidence, independent review, implementation records, and the formal ledger transition.
