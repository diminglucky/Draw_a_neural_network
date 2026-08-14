import { z } from "zod";
import { ApiErrorCode, FoundationError } from "./domain.js";

const purposeSchema = z.enum(["paper_overview", "architecture_detail", "module_detail", "presentation"]);
const densitySchema = z.enum(["compact", "standard", "detailed"]);
const orientationSchema = z.enum(["auto", "landscape", "portrait"]);
const printModeSchema = z.enum(["color", "grayscale"]);
const emphasisSchema = z.enum(["tensor_scale", "repetition", "branching", "skip", "attention", "fusion", "outputs"]);
const stylePresetSchema = z.enum(["publication_neutral", "publication_monochrome"]);

export interface FigureIntent {
  version: 1;
  purpose: z.infer<typeof purposeSchema>;
  density: z.infer<typeof densitySchema>;
  orientation: z.infer<typeof orientationSchema>;
  printMode: z.infer<typeof printModeSchema>;
  emphasis: z.infer<typeof emphasisSchema>[];
  target: "preview";
  stylePreset: z.infer<typeof stylePresetSchema>;
}

const figureIntentRequestSchema = z.object({
  purpose: purposeSchema.optional(),
  density: densitySchema.optional(),
  orientation: orientationSchema.optional(),
  printMode: printModeSchema.optional(),
  emphasis: z.array(emphasisSchema).max(7).optional(),
  target: z.literal("preview").optional(),
  stylePreset: stylePresetSchema.optional(),
}).strict();

export function defaultFigureIntent(): FigureIntent {
  return {
    version: 1,
    purpose: "paper_overview",
    density: "standard",
    orientation: "auto",
    printMode: "color",
    emphasis: [],
    target: "preview",
    stylePreset: "publication_neutral",
  };
}

export function parseFigureIntent(input: unknown): FigureIntent {
  const parsed = figureIntentRequestSchema.safeParse(input);
  if (!parsed.success) throw invalidIntent(parsed.error.message);

  const defaults = defaultFigureIntent();
  const printMode = parsed.data.printMode ?? defaults.printMode;
  const expectedPreset = printMode === "grayscale" ? "publication_monochrome" : "publication_neutral";
  if (parsed.data.stylePreset && parsed.data.stylePreset !== expectedPreset) {
    throw invalidIntent("stylePreset must match the selected printMode");
  }

  return {
    ...defaults,
    ...parsed.data,
    version: 1,
    target: "preview",
    printMode,
    emphasis: [...(parsed.data.emphasis ?? defaults.emphasis)],
    stylePreset: expectedPreset,
  };
}

function invalidIntent(cause: string): FoundationError {
  return new FoundationError(
    ApiErrorCode.VALIDATION_FAILED,
    "Figure intent failed validation",
    400,
    { cause },
  );
}
