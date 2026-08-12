# Admin Control Plane V1 Design

## Goal

Make the existing administrator page operational for the commercial foundation: an administrator can inspect users, devices, sessions and audit records, disable or re-enable a user/device, and revoke active sessions so a connected desktop client locks on its next authorization heartbeat.

## Scope

In scope:

- Keep the existing administrator JWT login and read-only list endpoints.
- Add authenticated admin actions to change user and device status between `active` and `disabled`.
- Revoke all active sessions affected by a disabled user or device.
- Preserve the existing fencing/lease release path when sessions are revoked.
- Record an audit record for every status change and explicit session revoke.
- Add client-side user/device filters and action buttons to the existing admin page.
- Return actionable errors for invalid IDs, empty reasons, invalid status transitions, and expired admin tokens.

Out of scope:

- Billing/subscription editing.
- Password reset, MFA, roles/permissions beyond the existing administrator role.
- Device deletion or physical machine unbinding.
- New database tables, external dependencies, or an admin SPA rewrite.

## Design

The API remains the source of truth. `AdminService` owns status transitions and affected-session revocation. Routes authenticate the administrator, validate the request, and pass the administrator subject as the audit actor. The service updates the existing store entities and uses `SessionService.revokeSession()` so Redis/in-memory leases and session fencing remain centralized.

New endpoints:

```text
POST /api/admin/users/:id/status
body: { "status": "active" | "disabled", "reason": string }
response: { user: PublicUser }

POST /api/admin/devices/:id/status
body: { "status": "active" | "disabled", "reason": string }
response: { device: Device }
```

Disabling a user revokes every active session belonging to that user. Disabling a device revokes every active session using that device. Re-enabling does not create a session or silently log the client in; the user must perform the normal online login and device-proof flow. A disabled user/device is rejected by current-session access and future login checks.

The page keeps its current vanilla module structure. Users and devices receive a status filter and action button. Every mutation requires a reason through a small confirmation prompt, refreshes dashboard/users/devices/sessions/audit data, and displays the API error without clearing a valid administrator session unless the API returns 401/403.

## Error handling

- Missing or blank reason: `VALIDATION_FAILED`, HTTP 400.
- Unknown user/device/session: existing `USER_NOT_FOUND`, `DEVICE_NOT_FOUND`, or `SESSION_NOT_FOUND`, HTTP 404.
- Unsupported status: `VALIDATION_FAILED`, HTTP 400.
- A disabled user/device attempting to use an existing token: `USER_DISABLED` or `DEVICE_NOT_AUTHORIZED`, HTTP 403/401 according to the existing session boundary.
- All mutation errors are returned in the existing `{ error: { code, message, requestId, details } }` shape.

## Acceptance criteria

1. An administrator can log in and see the existing dashboard plus users/devices/sessions/audit records.
2. Disabling a user changes its status, writes an audit record, and revokes all active sessions for that user.
3. Disabling a device changes its status, writes an audit record, and revokes all active sessions for that device.
4. A client with a revoked session receives `SESSION_REVOKED` on its next session/heartbeat request and the existing client gate returns to `locked`.
5. Re-enabling a user/device does not issue a token; a subsequent normal login is required.
6. Blank reasons and invalid statuses are rejected without changing state.
7. API tests cover both in-memory and persistence-compatible store methods; admin UI syntax and focused rendering tests pass.
