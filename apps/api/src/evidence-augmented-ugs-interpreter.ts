import type { ArchitectureInterpreter, BoundedInterpretationRequest, InterpreterProposal } from "./architecture-interpretation-contract.js";
import { interpretBoundedEvidenceAugmentedProposal, parseBoundedInterpretationRequest, type EvidenceAugmentedInterpretation } from "./evidence-augmented-ugs-harness.js";

export type { ArchitectureInterpreter, BoundedInterpretationRequest, InterpreterProposal } from "./architecture-interpretation-contract.js";

/** Pure Harness entry point; it has no provider, renderer, native, worker, COM, or source-execution authority. */
export function interpretEvidenceAugmentedInput(input: BoundedInterpretationRequest, proposal: unknown): EvidenceAugmentedInterpretation {
  return interpretBoundedEvidenceAugmentedProposal(input, proposal);
}

export type EvidenceAugmentedInterpreterAttempt =
  | { readonly status: "available"; readonly proposal: InterpreterProposal }
  | { readonly status: "unavailable" | "timeout" | "invalid" };

/** Optional provider-bound adapter; callers pass its result to the pure Harness. */
export async function requestEvidenceAugmentedProposal(input: BoundedInterpretationRequest, interpreter: ArchitectureInterpreter | undefined, timeoutMilliseconds = 250): Promise<EvidenceAugmentedInterpreterAttempt> {
  let request: BoundedInterpretationRequest;
  try {
    request = parseBoundedInterpretationRequest(input);
  } catch {
    return { status: "invalid" };
  }
  if (!interpreter) return { status: "unavailable" };
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 5_000) throw new Error("Interpreter timeout is invalid");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const proposal = await Promise.race([interpreter.propose(request), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("interpreter timeout")), timeoutMilliseconds); })]);
    interpretEvidenceAugmentedInput(request, proposal);
    return { status: "available", proposal };
  } catch (error) {
    return { status: error instanceof Error && error.message === "interpreter timeout" ? "timeout" : "invalid" };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
