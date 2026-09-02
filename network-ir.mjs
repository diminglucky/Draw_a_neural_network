import { normalizeUniversalIR, validateUniversalIR } from "./universal-ir.mjs";

export function normalizeNetworkIR(value) {
  return normalizeUniversalIR(value);
}

export function validateNetworkIR(value) {
  return validateUniversalIR(value);
}
