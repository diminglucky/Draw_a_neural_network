# Selected-Page Publication Presentation Design

**Status:** approved for implementation on 2026-08-25

## Goal

Render a trusted generic Publication Visual Plan on the user's already-selected Visio page as a compact, readable, editable publication figure. The implementation must remain model-neutral and must not add model-name templates.

## Diagnosed failure

The 2026-08-25 screenshot came from a hand-authored mixed-primitive smoke plan rather than the production `UGS -> GPG -> PVP` compiler. It therefore proved native primitive coverage, but it did not prove network composition quality. The visible defects also exposed renderer-level problems:

- the selected-page fitter scales the declared PVP page, including unused whitespace, instead of the actual content bounds;
- every primitive receives an external label, including compact Add and Repeat symbols;
- attachment visuals are displayed as independent objects when the test plan does not bind them to a primary component;
- a wide plan on an A4 portrait page is reduced to a narrow horizontal strip;
- the smoke path does not guard against disconnected semantic adornments.

## Decisions

1. `PVP` remains the visual truth. Visio does not infer a model family or insert architecture-specific shapes.
2. The selected-page renderer may perform a deterministic affine content fit, but it may not invent, delete, or reorder topology.
3. Labels use a visual-kind policy:
   - Add, Concat, Split, and AttentionRelation markers show only their symbol and have no external semantic label.
   - RepeatBadge renders its short label inside the badge and has no external label.
   - InputTerminal, OutputTerminal, ModuleFrame, OperatorFrame, and TensorStage render a centered internal label when the shape is large enough.
   - TensorVolume and AttentionTokenStrip use one bounded external or overlay label because they are multi-shape primitives.
4. Content fitting includes primitive geometry, connector routes, and retained label boxes. It centers that union in the existing page and preserves the page size.
5. A selected page whose aspect ratio cannot preserve the minimum readable text size must fail closed with a page-aspect diagnostic; later work can add a previewed page-aware reflow. The Worker must not silently invent a different topology layout after preview approval.
6. The real smoke test must consume a compiler-produced generic PVP. A hand-authored mixed primitive plan may remain only as a primitive-library diagnostic and must be named accordingly.
7. Existing-page safety remains unchanged: no new document/page, no `SaveAs`, preserve user shapes, replace only the exact Agent ownership namespace, save the selected document, and read back.

## Acceptance

- no marker label wraps into multiple lines;
- repeat text is contained inside its badge;
- the fitted content uses the safe page region without clipping;
- all retained text is at least 8 pt on the real page;
- no unconnected decorative primitive is accepted by the production smoke path;
- a second draw replaces the same Agent-owned region without increasing its shape count;
- the selected Visio document remains visible and open;
- focused TypeScript tests, the complete C# Worker suite, TypeScript typecheck, Release build, `git diff --check`, saved VSDX inspection, and a human screenshot review are separate required gates.

## Deferred work

True portrait/landscape reflow must happen before sealing and must be represented in the reviewed PVP. This repair does not authorize the Worker to rotate or wrap an already-approved graph behind the user's back.
