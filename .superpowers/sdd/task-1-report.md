# Task 1 Report: Evidence and canonical network contracts

## Status

Implemented and committed.

## Changed files

Only the six files named by the task brief were added:

- `input-adapters.mjs`
- `input-adapters.test.mjs`
- `evidence-graph.mjs`
- `evidence-graph.test.mjs`
- `network-ir.mjs`
- `network-ir.test.mjs`

The requested report file is this file. No existing production file was modified.

## Verification commands and output

### TDD RED

Command:

```text
node --test input-adapters.test.mjs evidence-graph.test.mjs network-ir.test.mjs
```

Output: exit code `1`; all three test files failed because the three required implementation modules did not yet exist (`ERR_MODULE_NOT_FOUND`). This was the expected pre-implementation failure.

### Focused GREEN tests

Command:

```text
node --test input-adapters.test.mjs evidence-graph.test.mjs network-ir.test.mjs
```

Output: `tests 7`, `pass 7`, `fail 0`, exit code `0`.

### Universal IR regression

Command:

```text
node --test universal-ir.test.mjs
```

Output: `tests 5`, `pass 5`, `fail 0`, exit code `0`.

### Diff validation

Commands:

```text
git diff --check
git diff --cached --check
```

Output: no whitespace errors.

## Implementation notes

- Architecture input normalization supports `source`, `ir`, `image`, and `prompt`, with structured `invalid-input` errors.
- Evidence records clamp confidence to `0..1`, default status to `confirmed`, and retain explicit IDs.
- Evidence graphs retain unresolved records and diagnostics; conversion attaches evidence to Universal IR nodes and edges.
- Network IR normalization and validation directly delegate to the existing Universal IR functions.
- `models.js` is not imported or used.

## Concerns

- Generated evidence IDs are deterministic for the supplied source/claim/family tuple, but callers should provide explicit IDs when they need identity across records with otherwise identical content.
- No host/UI or rendered-figure acceptance was requested or performed; this report covers the specified node tests and Universal IR regression only.

## Commit hashes

- Task implementation commit: `3536fa433635a819e7c54d7bf393823249ada908`
