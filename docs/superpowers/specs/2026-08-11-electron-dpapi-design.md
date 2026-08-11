# Electron DPAPI Device Key Design

## Goal

Store the device Ed25519 private key in Windows DPAPI-protected application data and expose only public identity and challenge signing through a hardened Electron preload bridge.

## Decision

The Electron main process owns `DeviceKeyStore`. It generates an Ed25519 key pair once, exports the private PKCS#8 bytes, protects those bytes with Windows DPAPI `CurrentUser` scope, and stores only the encrypted private bytes plus public key in the Electron user-data directory. The renderer receives no private-key bytes and cannot choose a filesystem path or DPAPI scope.

The native DPAPI module is loaded only by the main process and is injected into the key store for tests. The preload exposes two fixed IPC methods: `getIdentity` and `signChallenge`. IPC handlers validate argument types and reject oversized challenges.

## File format

```json
{
  "version": 1,
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "encryptedPrivateKey": "base64",
  "createdAt": "ISO timestamp"
}
```

Writes use a same-directory temporary file followed by rename. Existing encrypted material is never overwritten with a new key unless the file is missing or invalid; invalid material is a startup error so a device does not silently change identity.

## DPAPI boundary

Use `win-dpapi` only on Windows with `CurrentUser` scope and fixed non-secret context entropy `Synapse Studio/device-key/v1`. The context labels the purpose but is not treated as a secret. A future CNG provider can implement the same interface without changing the API protocol.

## IPC boundary

The preload uses `contextBridge.exposeInMainWorld("synapseDeviceKey", ...)`. The renderer can request identity and signatures but cannot call arbitrary IPC channels, read the encrypted file, or select a different DPAPI scope. The main handler signs exactly the supplied UTF-8 challenge after length validation.

## Explicit non-goals

This slice does not claim installer signing, auto-update signing, hardware-backed CNG keys, anti-debugging, or protection from a fully compromised Windows account. Those require separate release acceptance.
