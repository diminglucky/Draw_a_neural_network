# Core Drawing CD0 Acceptance Evidence

**Acceptance timestamp:** `2026-08-21T07:13:31.831Z`
**Accepted implementation revision:** `aa9835c383aa18c804a23856893685af97443fef`
**Remote verification:** `origin/agent` resolved to the same revision after push.

## Scope accepted

- `M2.8` Prompt-to-UniversalGraphSpec
- `M2.10` Static-code-to-UniversalGraphSpec
- `M2.11` Evidence-constrained drawing session

The accepted boundary is renderer-neutral. It accepts bounded typed declarations and non-executed static PyTorch source, produces evidence-backed UGS/GPG/PVP preview state or a deterministic clarification, and never creates a Snapshot, export request, Worker call, COM action, file path, native shape directive, or Visio mutation.

## Verification

| Gate | Result |
|---|---|
| Targeted regression matrix | 7 files, 58 tests passed |
| Full API suite | 125 files, 820 tests passed |
| TypeScript | `npx tsc --noEmit` passed |
| Foundation boundary | `npm run api:check` passed |
| Roadmap and formatting | `npm run agent:verify-roadmap` and `git diff --check` passed before delivery |
| Independent review A | provenance-pair binding and prompt-port evidence approved with no Critical, Important, or Minor findings |
| Independent review B | static digest binding and conditional declaration fail-closed behavior approved with no Critical or Important findings |

## Required fail-closed evidence

- A resumed session cannot combine the source ID from one evidence record with the digest from another.
- Every prompt-derived port owns directly resolvable bounded evidence.
- Direct static analyzer calls reject a digest that does not identify submitted bytes.
- Conditional module declarations in `if`, `else`, `elif`, `except`, `finally`, loop, context-manager, and match paths remain candidate topology with no formal edges or export eligibility.
- A provable unconditional linear path remains formal and no submitted source is executed.

## Exclusions

This acceptance does not accept natural-language model inference, Provider operation, sketch extraction, publication visual grammar quality, browser human visual review, current-document Visio attachment, Worker mutation, COM automation, save/reopen, real-host readback, or export. Those capabilities remain governed by `M2.12`, `M2.13`, `M4.5`, and `M3.2` through `M3.5`.
