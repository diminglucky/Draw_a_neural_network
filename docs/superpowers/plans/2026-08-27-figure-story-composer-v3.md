# Figure Story Composer V3 Implementation Plan

Status: implemented and verified in the current worktree. V3 emits renderer-neutral story/panel/lane/inset/legend semantics; PVP geometry and real Visio host rendering remain future gates.

> For agentic workers: implement this plan task-by-task with TDD. Every production change must follow a failing test.

Goal: 将 V2 Visual Module Compilation 组织为论文级 Figure Story Plan，表达主路径、condition/state/feedback/process lanes、overview/detail/process/legend panels 和复杂模块 inset，但不生成坐标。

Architecture: 新增 figure-story-composer.ts，输入已规范化的 SemanticArchitectureGraph 和 V2 SemanticVisualCompilation，输出 renderer-neutral FigureStoryPlan。Composer 只做叙事分层和语义归组，不修改拓扑、不猜测未证明关系、不生成 PVP bounds 或 Visio command。

Tech Stack: TypeScript 5.9、NodeNext、Vitest 3、现有 V1/V2 semantic contracts；不增加依赖。

## Global Constraints

- 不修改现有 PVP compiler、旧 figure plan、browser preview 或 Visio Worker。
- 不保存 x、y、width、height、bounds、route、SVG、COM、Visio、renderer 或自由脚本字段。
- 主路径只使用 data、residual skip、add merge、concat merge 和已声明的 cross-attention data target；condition、state、feedback、time 和 diffusion relation 分配到辅助 lane。
- 主图 overview 必须保持简洁；复杂模块通过 detail inset 引用，不把所有内部 parts 平铺到主路径。
- candidate/blocked eligibility 和 diagnostics 必须从 V1/V2 保留，不能因为 Composer 生成 panel 就升级为 formal。
- 相同 normalized graph 和相同 V2 compilation 连续编译必须 deep-equal。

## 文件边界

- Create: apps/api/src/figure-story-composer.ts
- Create: apps/api/tests/figure-story-composer.test.ts
- Create: docs/superpowers/plans/2026-08-27-figure-story-composer-v3.md

---

### Task 1: Define the renderer-neutral Figure Story Plan

Files:

- Create apps/api/src/figure-story-composer.ts
- Test apps/api/tests/figure-story-composer.test.ts

- [ ] Step 1: Write failing contract tests.

The test imports composeFigureStory and asserts the result exposes:

- FigureStoryPlan with version 1, graphId, exportEligibility, panels, lanes, mainPathModuleIds, insets, legend and diagnostics.
- StoryPanel with panelId, kind, moduleIds, relationIds and purpose.
- StoryLane with laneId, kind, moduleIds and relationIds.
- StoryInset with insetId, sourceModuleId, panelId, referenceLabel and partIds.
- StoryLegendEntry with legendId, semanticType, visualRole and explanation.

Allowed panel kinds are overview, detail, process and legend. Allowed lane kinds are main, condition, state, feedback, graph and process.

- [ ] Step 2: Run the focused test and verify it fails because the composer does not exist.

    npm.cmd run api:test -- apps/api/tests/figure-story-composer.test.ts

- [ ] Step 3: Add the minimal public contract and compile entry point.

Expose:

    export const FIGURE_STORY_PLAN_VERSION = 1 as const;
    export function composeFigureStory(
      graph: SemanticArchitectureGraph,
      compilation: SemanticVisualCompilation,
    ): FigureStoryPlan;

Return stable arrays and no geometry fields.

- [ ] Step 4: Run the focused test and require the contract assertions to pass.

---

### Task 2: Extract a deterministic main path

Files:

- Modify apps/api/src/figure-story-composer.ts
- Modify apps/api/tests/figure-story-composer.test.ts

- [ ] Step 1: Add failing main path tests.

Create an anonymous graph with input to stage to fusion to output, plus condition and feedback relations. Assert mainPathModuleIds contains the input-to-output path in deterministic order and excludes feedback and condition-only modules.

Assert that a cycle created only by feedback does not cause the main path extraction to loop.

- [ ] Step 2: Run the tests and verify mainPathModuleIds is empty or unordered.

- [ ] Step 3: Implement path extraction.

Build adjacency only from data_flow, residual_skip, add_merge and concat_merge relations. Use stable module IDs as the tie-breaker. Start from modules with no incoming main-path relation; when several paths are possible, choose the path with the most modules, then choose the lexicographically smallest module ID sequence. Never traverse feedback, state, condition, time or diffusion relations in this path calculation.

Keep all modules not selected by the main path available for lanes or detail panels.

- [ ] Step 4: Run the focused tests and require the main path assertions to pass.

---

### Task 3: Allocate lanes and panels

Files:

- Modify apps/api/src/figure-story-composer.ts
- Modify apps/api/tests/figure-story-composer.test.ts

- [ ] Step 1: Add failing lane/panel tests.

Assert this relation-to-lane mapping:

    data_flow, residual_skip, add_merge, concat_merge -> main
    condition_flow, cross_attention -> condition
    state_read, state_write -> state
    feedback -> feedback
    message_passing -> graph
    time_step, diffusion_iteration -> process

Assert that overview exists and contains main path modules; detail exists for attention, graph_message_passing, memory_state, diffusion_denoiser and diffusion_ladder; process exists when a process lane is non-empty; legend always exists.

Assert each panel has at least one semantic member and panel module/relation IDs are stable and deduplicated.

- [ ] Step 2: Run the tests and verify lanes/panels are missing.

- [ ] Step 3: Implement deterministic lane allocation and panel creation.

Create one lane per non-empty lane kind. Preserve relation IDs and module IDs in every lane. Create overview first, one detail panel for all selected complex modules, process only when needed, and legend last. The overview receives mainPathModuleIds plus any primary input/output not already present. Detail receives modules whose visual grammar is attention-block, graph-message-passing, memory-state, diffusion-ladder, diffusion-denoiser or whose parts count is at least four.

Do not put condition/state/feedback-only modules into the overview unless they are also on the main path.

- [ ] Step 4: Run the focused tests and require all lane/panel tests to pass.

---

### Task 4: Generate detail insets and legend entries

Files:

- Modify apps/api/src/figure-story-composer.ts
- Modify apps/api/tests/figure-story-composer.test.ts

- [ ] Step 1: Add failing inset/legend tests.

Assert each detail module generates one inset with:

    insetId = inset:<moduleId>
    sourceModuleId = moduleId
    panelId = overview
    referenceLabel = detail:<moduleId>
    partIds = the V2 visual parts for that module

Assert the legend contains entries for data, condition, skip, merge_add, merge_concat, cross_attention, message_passing, state_read, state_write, feedback and process relations that are actually present. Do not add unused relation types.

- [ ] Step 2: Run the tests and verify insets or legend entries are absent.

- [ ] Step 3: Implement inset and legend generation.

Use V2 module part IDs as the inset source. Sort insets by sourceModuleId and legend entries by legendId. Explanations must be fixed semantic text, not model-specific prose.

Use these fixed explanations:

    data -> primary data flow
    condition -> conditioning input
    skip -> residual or skip connection
    merge_add -> additive merge
    merge_concat -> concatenation merge
    cross_attention -> cross-attention relation
    message_passing -> graph message passing
    state_read -> persistent state read
    state_write -> persistent state write
    feedback -> feedback or recycling relation
    process -> time or diffusion process

- [ ] Step 4: Run focused tests and require inset/legend assertions to pass.

---

### Task 5: Preserve uncertainty and prove determinism

Files:

- Modify apps/api/src/figure-story-composer.ts
- Modify apps/api/tests/figure-story-composer.test.ts

- [ ] Step 1: Add failing uncertainty/determinism tests.

Compile a graph containing an unknown module and candidate relation. Assert story exportEligibility remains blocked or candidate, diagnostics preserve unknown-module and candidate-structure, and no panel is allowed to turn it into formal.

Compile the same normalized graph and V2 compilation twice and assert deep equality. Assert recursive object keys do not include x, y, bounds, route, renderer, visio or command.

- [ ] Step 2: Run tests and verify failure.

- [ ] Step 3: Implement propagation and immutable output.

Copy graph eligibility unchanged. Merge V2 diagnostics with Story diagnostics in stable order. Deep-freeze the plan. Never synthesize a missing relation, module or source evidence.

- [ ] Step 4: Run V3 focused and selected regressions.

    npm.cmd run api:test -- apps/api/tests/figure-story-composer.test.ts
    npm.cmd run api:test -- apps/api/tests/semantic-visual-module-contract.test.ts apps/api/tests/semantic-visual-module-compiler.test.ts apps/api/tests/composable-region-visual-compiler.test.ts

Expected: all V3 and selected existing tests pass.

---

### Task 6: Final verification

- [ ] Step 1: Run npx.cmd tsc --noEmit and record the existing publication-visual-plan-compiler.test.ts coordinateSpace error separately if it remains.
- [ ] Step 2: Run git diff --check for the three V3 files.
- [ ] Step 3: Confirm V3 modifies no PVP or Visio files.
- [ ] Step 4: Report that V3 produces story/panel/lane/inset semantics, while PVP geometry and Visio native group rendering remain future gates.
