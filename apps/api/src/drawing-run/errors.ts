export type DrawingRunErrorCode =
  | "DRAWING_RUN_IDENTITY_MISMATCH"
  | "DRAWING_RUN_REVISION_CONFLICT"
  | "DRAWING_RUN_TRANSITION_INVALID"
  | "DRAWING_RUN_TERMINAL"
  | "DRAWING_RUN_EVENT_INVALID"
  | "DRAWING_RUN_IDEMPOTENCY_CONFLICT";

export class DrawingRunError extends Error {
  readonly code: DrawingRunErrorCode;

  constructor(code: DrawingRunErrorCode, message: string) {
    super(message);
    this.name = "DrawingRunError";
    this.code = code;
  }
}
