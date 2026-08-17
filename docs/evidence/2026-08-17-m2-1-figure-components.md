# M2.1 Figure Component Contract Evidence

Date: 2026-08-17
Branch: `agent`
Implementation commit: `a71b87323efcc9210b632757b4c636880353e35a`

## Accepted scope for review

The v3 Figure Component contract maps validated Architecture IR into semantic components, typed ports, evidence-preserving connections, module ownership, and repeat policy. It deliberately emits no layout coordinates, style tokens, renderer commands, Provider data, Worker fields, or file paths.

Gold fixtures cover CNN, residual, encoder-decoder, and token-transformer structures. Blocking unresolved questions, process nodes, and feedback edges return explicit unresolved results rather than guessed presentation semantics.

## Verification

- Focused Figure Component tests: 7 passed.
- Full API suite: 87 test files and 500 tests passed.
- Strict TypeScript compilation: passed.
- Foundation boundary check: passed.
- Roadmap schema and generated parity: passed.
- Diff check: passed.

## Not accepted by M2.1

Figure layout, `ComposableDagFigureCompiler`, preview routes, PlanSnapshot persistence, SVG/PNG artifacts, universal export, real Windows/Visio acceptance, and image/Vision migration remain later milestones.
