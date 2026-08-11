function bridgeError() {
  const error = new Error("The Windows device-key bridge is required");
  error.code = "DEVICE_KEY_BRIDGE_REQUIRED";
  return error;
}

export function createDeviceKeyProvider(options = {}) {
  const bridge = options.bridge || globalThis.synapseDeviceKey;
  const production = options.production === true;

  return {
    async getOrCreateIdentity() {
      if (bridge?.getIdentity) return await bridge.getIdentity();
      if (!production && options.fallbackIdentity) return await options.fallbackIdentity();
      throw bridgeError();
    },

    async signChallenge(challenge) {
      if (bridge?.signChallenge) return await bridge.signChallenge(challenge);
      throw bridgeError();
    },

    async bindDeviceId(deviceId) {
      if (bridge?.bindDeviceId) return await bridge.bindDeviceId(deviceId);
      if (!production) return undefined;
      throw bridgeError();
    },
  };
}
