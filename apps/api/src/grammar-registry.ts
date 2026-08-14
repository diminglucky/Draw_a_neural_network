import type { FigureIntent } from "./figure-intent.js";
import type { FigureGrammarId } from "./figure-semantic-model.js";
import type { CanonicalNetworkIR } from "./network-ir-v2.js";
import { cnnClassifierGrammar } from "./grammars/cnn-classifier.js";
import { encoderDecoderGrammar } from "./grammars/encoder-decoder.js";
import { residualBackboneGrammar } from "./grammars/residual-backbone.js";
import { tokenTransformerGrammar } from "./grammars/token-transformer.js";
import { multiBranchFusionGrammar } from "./grammars/multi-branch-fusion.js";

export interface GrammarScore {
  grammarId: FigureGrammarId;
  score: number;
  reasons: string[];
  blockers: string[];
}

export interface FigureGrammar {
  id: FigureGrammarId;
  version: number;
  evaluate(ir: CanonicalNetworkIR, intent: FigureIntent): GrammarScore;
}

export interface GrammarSelection {
  status: "selected" | "needs_confirmation";
  selected: FigureGrammar | null;
  candidates: GrammarScore[];
  blockers: string[];
}

const MINIMUM_SELECTION_SCORE = 0.7;

export class GrammarRegistry {
  private readonly grammars: readonly FigureGrammar[];

  constructor(grammars: readonly FigureGrammar[]) {
    const ids = new Set<string>();
    for (const grammar of grammars) {
      if (ids.has(grammar.id)) throw new Error(`Grammar "${grammar.id}" may only be registered once`);
      ids.add(grammar.id);
    }
    this.grammars = Object.freeze([...grammars]);
  }

  registeredIds(): FigureGrammarId[] {
    return this.grammars.map((grammar) => grammar.id);
  }

  select(ir: CanonicalNetworkIR, intent: FigureIntent): GrammarSelection {
    const unresolved = ir.unresolved.filter((entry) => entry.severity === "blocking");
    if (unresolved.length > 0) {
      return {
        status: "needs_confirmation",
        selected: null,
        candidates: [],
        blockers: unresolved.map((entry) => `Unresolved structural fact "${entry.id}": ${entry.question}`),
      };
    }

    const evaluated = this.grammars.map((grammar) => ({ grammar, score: normalizeScore(grammar, grammar.evaluate(ir, intent)) }));
    const candidates = evaluated
      .map(({ score }) => score)
      .sort((left, right) => right.score - left.score || left.grammarId.localeCompare(right.grammarId));
    const usable = evaluated
      .filter(({ score }) => score.blockers.length === 0)
      .sort((left, right) => right.score.score - left.score.score || left.grammar.id.localeCompare(right.grammar.id));
    const best = usable[0];

    if (!best || best.score.score < MINIMUM_SELECTION_SCORE) {
      return {
        status: "needs_confirmation",
        selected: null,
        candidates,
        blockers: candidates.flatMap((candidate) => candidate.blockers),
      };
    }
    return { status: "selected", selected: best.grammar, candidates, blockers: [] };
  }
}

function normalizeScore(grammar: FigureGrammar, score: GrammarScore): GrammarScore {
  const reasons = Array.isArray(score.reasons) ? [...score.reasons] : [];
  const blockers = Array.isArray(score.blockers) ? [...score.blockers] : [];
  if (score.grammarId !== grammar.id) blockers.push(`Grammar "${grammar.id}" returned an inconsistent score identity`);
  if (!Number.isFinite(score.score) || score.score < 0 || score.score > 1) blockers.push(`Grammar "${grammar.id}" returned an invalid score`);
  return {
    grammarId: grammar.id,
    score: Number.isFinite(score.score) ? Math.max(0, Math.min(1, score.score)) : 0,
    reasons,
    blockers,
  };
}

export { MINIMUM_SELECTION_SCORE };

export function createPublicationGrammarRegistry(): GrammarRegistry {
  return new GrammarRegistry([cnnClassifierGrammar, encoderDecoderGrammar, residualBackboneGrammar, tokenTransformerGrammar, multiBranchFusionGrammar]);
}
