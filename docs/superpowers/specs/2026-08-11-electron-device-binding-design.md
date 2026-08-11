# Electron Device Binding Design

## Goal

Make a registered server device survive Electron restart by binding the server-issued `device.id` to the existing DPAPI-protected Ed25519 key without moving private-key material into the renderer.

## Scope

This slice covers the device-id persistence and client authorization data flow. It does not add a new server authentication primitive, change the one-active-session policy, or implement OpenAI/Visio behavior.

## Decision

The device key file remains owned by Electron main process. It keeps the existing encrypted private key and public key, plus an optional non-secret `deviceId` metadata field:

```json
{
  "version": 1,
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "encryptedPrivateKey": "base64",
  "createdAt": "ISO timestamp",
  "deviceId": "server-issued-device-id"
}
```

`bindDeviceId(deviceId)` is write-once and idempotent. An empty, oversized, or malformed id is rejected. A different id after a previous binding is rejected rather than silently replacing the association.

The renderer can request binding only through the fixed preload method `window.synapseDeviceKey.bindDeviceId(deviceId)`. The main process validates the input and persists it through the key store. The renderer still never receives the private key, DPAPI object, storage path, or arbitrary IPC access.

After registration, the auth gate binds the server response's `device.id` before completing the local registration state. On a later launch, `getIdentity()` includes the bound `id`, so challenge and login requests use the same server device row. The server continues to validate the challenge signature against that row's public key; the id is not treated as a password or cryptographic proof.

## Failure behavior

- Missing device id before registration is valid; the first identity has no `id`.
- Rebinding the same id succeeds without rewriting the key.
- Rebinding a different id fails with `DEVICE_ID_ALREADY_BOUND`.
- Main/preload rejects non-string or oversized ids before persistence.
- A persistence failure makes registration fail visibly; no local success is reported for an unbound device.
- Existing malformed or undecryptable key files keep their existing corruption errors and are never replaced.

## Test boundaries

- Device key store tests cover first identity without id, binding, reload, idempotence, conflicting rebinding, validation, and malformed-file preservation.
- Electron bridge tests cover the third fixed IPC channel and renderer-safe exposure.
- Provider tests cover bridge delegation and production failure when binding is unavailable.
- Auth gate tests cover registration binding and the login payload using the bound server id.
- Existing API, PostgreSQL, Redis, native DPAPI, and syntax checks remain required.

## Non-goals

- Treating a machine fingerprint as a secret or sole authorization factor;
- allowing renderer-selected filesystem paths or DPAPI scopes;
- changing the server's challenge/signature protocol;
- claiming protection from a fully compromised Windows account;
- signed installer, update, billing, OpenAI, or Visio release acceptance.
