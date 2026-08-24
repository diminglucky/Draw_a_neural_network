import { describe, expect, it } from "vitest";
import { defaultFigureIntent } from "../../src/figure-intent.js";
import { GrammarRegistry } from "../../src/grammar-registry.js";
import { cnnClassifierGrammar } from "../../src/grammars/cnn-classifier.js";
import { residualBackboneGrammar } from "../../src/grammars/residual-backbone.js";
import { runVisualQa } from "../../src/visual-qa.js";
import { structuralResidualMergeCanonicalIr } from "../fixtures/structural-residual-merge-ir.js";

describe("residual-backbone grammar", () => {
  it("selects and compiles an anonymous residual-merge topology with bounded shortcuts", () => {
    const ir = structuralResidualMergeCanonicalIr();
    const intent = defaultFigureIntent();
    const registry = new GrammarRegistry([cnnClassifierGrammar, residualBackboneGrammar]);
    const model = residualBackboneGrammar.compileSemanticModel(ir, intent);
    const plan = residualBackboneGrammar.compilePlan(model, intent);

    expect(registry.select(ir, intent).selected?.id).toBe("residual-backbone");
    expect(residualBackboneGrammar.evaluate(ir, intent).score).toBeGreaterThanOrEqual(0.7);
    const shortcuts = plan.primitives.filter((item) => item.kind === "residual_skip");
    expect(shortcuts).toHaveLength(4);
    for (const shortcut of shortcuts) {
      const mapping = plan.sourceMappings.find((item) => item.displayId === shortcut.sourceDisplayId);
      expect(mapping?.edgeIds.some((id) => id.startsWith("residual-"))).toBe(true);
    }
    expect(runVisualQa(plan).blocking).toEqual([]);
  });

  it("fails closed when direct compilation receives a blocking unresolved fact", () => {
    const ir = structuralResidualMergeCanonicalIr();
    const blocked = { ...ir, unresolved: [{ id: "shortcut", question: "Is this shortcut projected?", severity: "blocking" as const, candidateValues: ["yes", "no"], evidenceIds: [] }] };

    expect(() => residualBackboneGrammar.compileSemanticModel(blocked, defaultFigureIntent())).toThrow(/unresolved/i);
  });

  it("returns a selection blocker when a residual Add has no non-input main path producer", () => {
    const ir = structuralResidualMergeCanonicalIr();
    const unresolvable = {
      ...ir,
      nodes: ir.nodes.map((node) => node.id === "stem" || node.id === "block-1" ? { ...node, op: "input" as const } : node),
    };
    const registry = new GrammarRegistry([residualBackboneGrammar]);

    expect(residualBackboneGrammar.evaluate(unresolvable, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("main path")]));
    expect(registry.select(unresolvable, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });
});
