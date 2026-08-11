# Windows Device Proof Design

## Goal

Replace the browser bootstrap device identity with a challenge-based Ed25519 proof protocol that can be backed by a Windows DPAPI-protected key in the Electron main process.

## Decision

The API owns challenge creation and one-time consumption. The client signs the opaque challenge with an Ed25519 private key. The API verifies the signature against the public key already registered for the device. The private key never enters the renderer, API request body, database, or logs.

The first implementation delivers the server protocol and a renderer-safe Electron IPC client contract. A later Windows native provider will implement `getIdentity` and `signChallenge` using DPAPI. Browser bootstrap remains available only for tests and non-production development; production requires a valid proof.

## Protocol

### Create challenge

`POST /api/auth/challenge`

Request:

```json
{ "email": "user@example.com", "password": "...", "deviceId": "..." }
```

Response:

```json
{ "challengeId": "...", "challenge": "...", "expiresAt": "..." }
```

The API verifies the account password and device ownership before returning a challenge. The challenge is bound to the user and device, expires after 120 seconds, and is one-time consumable.

### Login proof

`POST /api/auth/login` accepts:

```json
{
  "email": "user@example.com",
  "password": "...",
  "deviceId": "...",
  "deviceProof": {
    "challengeId": "...",
    "signature": "base64-encoded-signature"
  }
}
```

The server consumes the challenge before signature verification, so an invalid signature cannot be replayed. The signed message is the exact UTF-8 challenge string. A successful proof must match both the authenticated user and device.

## Security boundaries

- The API stores a PEM/SPKI Ed25519 public key only.
- Signatures are base64 encoded and bounded before decoding.
- Challenges are random, short-lived, bound to user/device, and atomically consumed.
- `NODE_ENV=production` always requires a proof; `REQUIRE_DEVICE_PROOF=true` enables the same gate in development acceptance tests.
- `browser-bootstrap-key` is rejected when device proof is required.
- Machine fingerprint is retained as a risk and support signal, not treated as a cryptographic credential.
- Error responses do not reveal whether an email, device, or challenge exists beyond the existing authorization boundary.

## Storage

Add `device_challenges` with:

- `id`, `user_id`, `device_id`, `challenge`, `expires_at`, `consumed_at`, `created_at`;
- unique challenge value;
- foreign keys to users and devices;
- an index for unconsumed expiry cleanup.

The memory store mirrors atomic consume semantics for tests. PostgreSQL uses one conditional `UPDATE ... RETURNING` statement so two API instances cannot consume the same challenge.

## Client boundary

The client-side provider exposes only:

```js
getOrCreateIdentity()
signChallenge(challenge)
```

In production Electron, these calls cross a preload/IPC bridge to the main process. The renderer receives public identity and signature strings only. The provider rejects a missing production bridge instead of generating a browser key.

## Explicit non-goals

This slice does not ship the final signed Windows installer, native DPAPI addon, hardware-backed CNG key, certificate enrollment, OpenAI integration, Visio automation, or billing.
