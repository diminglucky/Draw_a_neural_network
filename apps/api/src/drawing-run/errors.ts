export type DrawingRunErrorCategory =
  | "validation"
  | "owner"
  | "device"
  | "run"
  | "revision"
  | "idempotency"
  | "transition"
  | "event";

const safeMessages: Readonly<Record<DrawingRunErrorCategory, string>> = {
  validation: "Drawing run command is invalid.",
  owner: "Drawing run owner does not match.",
  device: "Drawing run device does not match.",
  run: "Drawing run identity does not match.",
  revision: "Drawing run revision is stale.",
  idempotency: "Drawing run idempotency key cannot be replayed with different content.",
  transition: "Drawing run transition is not allowed.",
  event: "Drawing run event is not safe to record.",
};

export class DrawingRunError extends Error {
  readonly category: DrawingRunErrorCategory;

  constructor(category: DrawingRunErrorCategory) {
    super(safeMessages[category]);
    this.name = "DrawingRunError";
    this.category = category;
  }
}

export function failDrawingRun(category: DrawingRunErrorCategory): never {
  throw new DrawingRunError(category);
}
