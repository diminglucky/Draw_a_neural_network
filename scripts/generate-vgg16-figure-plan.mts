import { createLocalDeterministicAgentProvider } from "../apps/api/src/adapters.ts";
import { buildPublicationFigurePlan } from "../publication-figure-plan.js";

type NetworkIR = {
  figure?: { id?: string; title?: string; description?: string | null };
  nodes?: unknown[];
  edges?: unknown[];
};

const provider = createLocalDeterministicAgentProvider();
const draft = await provider.buildDraft({
  userId: "visio-smoke",
  conversationId: "vgg16-publication-smoke",
  message: "Draw VGG16 with publication-quality feature map stacks.",
  attachments: [],
});
const networkIR = draft.networkIR as NetworkIR;
const figurePlan = buildPublicationFigurePlan(networkIR);

if (!figurePlan.validation.valid) {
  throw new Error(`Canonical VGG16 Figure Plan is invalid: ${figurePlan.validation.violations.join(", ")}`);
}

process.stdout.write(JSON.stringify({
  figure: {
    title: figurePlan.figure.title,
    stageLabels: [],
  },
  nodes: [],
  edges: [],
  figurePlan,
}));
