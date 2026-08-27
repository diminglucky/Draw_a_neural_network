# Semantic Visual Module V2 Implementation Plan

> For agentic workers: implement this plan task-by-task with TDD. Every step uses a failing test before production code.

Goal: 将 V1 Semantic Architecture Graph 编译成具有内部结构、typed relation 和稳定 source mapping 的 renderer-neutral visual module compilation，避免主要模块退化为单一矩形。

Architecture: 新增独立的 semantic-visual-module-compiler.ts，只消费已规范化的 V1 graph，不读取代码、不推断拓扑、不生成坐标、不操作 PVP 或 Visio。每个 SemanticModule 生成一个 VisualModulePlan，内部包含按 semantic type 选择的视觉 parts；每条 SemanticRelation 生成一个带 marker/style role 的 VisualRelationPlan。

Tech Stack: TypeScript 5.9、NodeNext、Vitest 3、现有 V1 normalizer；不增加依赖。

## Global Constraints

- 不修改 composable-region-visual-compiler.ts、publication-visual-plan-compiler.ts、PVP schema 或 Visio Worker。
- 不保存 x、y、width、height、bounds、路径点、SVG、COM、Visio 或 renderer command。
- 视觉 module 的内部结构必须由 semantic type、ports、parts、repeat/state/condition 和 typed relations 决定，不得读取模型名称。
- unknown module 保留为 unknown_container，并继承 graph 的 blocked/candidate eligibility；不得伪装成 convolution、attention 或 diffusion。
- 模块和关系按稳定 ID 排序；模块内部 parts 按语义 grammar 的叙事顺序输出，生成的 partId 保证顺序确定；source/evidence 可追溯，且连续两次编译同一规范化 graph 必须 deep-equal。

## 文件边界

- Create: apps/api/src/semantic-visual-module-compiler.ts
- Create: apps/api/tests/semantic-visual-module-compiler.test.ts
- Create: docs/superpowers/plans/2026-08-27-semantic-visual-module-v2.md

不修改 V1 contract 文件和现有 PVP/Visio 文件。

---

### Task 1: Define the visual module compilation contract

Files:

- Create apps/api/src/semantic-visual-module-compiler.ts
- Test apps/api/tests/semantic-visual-module-compiler.test.ts

- [ ] Step 1: Write the failing tests.

The test imports compileSemanticVisualModules and asserts that the result exposes:

- VisualModulePart with partId, kind, role, label, sourceModuleId, sourcePartIds and evidenceIds.
- VisualModulePlan with moduleId, visualGrammarId, parts, inputPortIds, outputPortIds, sourceNodeIds and evidenceIds.
- VisualRelationPlan with relationId, relationType, visualRole, marker, sourceModuleId, targetModuleId and evidenceIds.
- SemanticVisualCompilation with version 1, graphId, exportEligibility, modules, relations and diagnostics.

VisualModulePart.kind must be one of tensor_face, operator_body, token_cell_strip, graph_inset, state_store, process_axis, repeat_marker, condition_marker, relation_marker, unknown_container or label.

VisualRelationPlan.visualRole must be one of data, condition, skip, merge_add, merge_concat, cross_attention, message_passing, state_read, state_write, feedback, time_step or diffusion_iteration.

- [ ] Step 2: Run the focused test to verify it fails.

Run:

    npm.cmd run api:test -- apps/api/tests/semantic-visual-module-compiler.test.ts

Expected: FAIL because the V2 compiler module does not exist.

- [ ] Step 3: Implement the minimal contract and compiler dispatch.

Create the type definitions and a dispatcher keyed only by SemanticModule.semanticType. Sort modules by moduleId and relations by relationId; keep each grammar semantic part order stable. Copy source and evidence IDs without adding geometry.

- [ ] Step 4: Run the focused test and require the type contract assertions to pass.

---

### Task 2: Implement data and operator internal visual grammar

Files:

- Modify apps/api/src/semantic-visual-module-compiler.ts
- Modify apps/api/tests/semantic-visual-module-compiler.test.ts

- [ ] Step 1: Add failing behavior tests.

Assert that a convolution_stage or scale_transition produces visual grammar tensor-operator-stage and parts with roles front_face, top_face, side_face, operator_body and label.

Assert that attention_block produces visual grammar attention-block and parts with roles query_tokens, key_tokens, value_tokens, attention_relation and output_tokens.

- [ ] Step 2: Run the focused test and verify the new assertions fail because only a generic fallback is produced.

- [ ] Step 3: Implement data/operator builders.

- tensor_volume, feature_map, convolution_stage and scale_transition produce three tensor_face parts with roles front_face, top_face and side_face, then operator parts from internalParts and a label.
- token_sequence produces one token_cell_strip with role tokens; an internal part whose role contains special also produces special_token_marker.
- attention_block produces query_tokens, key_tokens, value_tokens, attention_relation and output_tokens.
- ffn_block and ssm_block produce operator_body parts from internalParts; ssm_block also produces state_store.
- Every part retains sourcePartIds and evidenceIds; no part may contain geometry fields.

- [ ] Step 4: Run the focused tests and require data/operator tests to pass.

---

### Task 3: Implement graph, state, process and unknown grammars

Files:

- Modify apps/api/src/semantic-visual-module-compiler.ts
- Modify apps/api/tests/semantic-visual-module-compiler.test.ts

- [ ] Step 1: Add failing tests.

Assert that graph_message_passing or mesh_graph produces graph_inset parts with roles node_group, edge_group, message_aggregate and graph_inset_label.

Assert that memory_state and ssm_block produce state_store, state_read_port and state_write_port.

Assert that diffusion_denoiser or diffusion_ladder produces operator_body, repeat_marker, process_axis, condition_marker and label.

Assert that unknown_module produces exactly an unknown_container and a label, and diagnostics contains code unknown-module.

- [ ] Step 2: Run the tests and confirm these parts are missing.

- [ ] Step 3: Implement grammar builders.

- graph_message_passing and mesh_graph use graph_inset parts with node, edge, aggregation and inset-label roles.
- memory_state and ssm_block use state_store, state_read_port and state_write_port.
- diffusion_denoiser and diffusion_ladder use operator_body, repeat_marker, process_axis, condition_marker and label.
- stage_region, multi_tower, fusion_block, feedback_loop and ensemble_branch use operator_body or repeat_marker while preserving semantic type in visualGrammarId.
- unknown_module uses exactly unknown_container plus label and emits unknown-module.

- [ ] Step 4: Run focused tests and require all module grammar tests to pass.

---

### Task 4: Compile typed relation markers and prove determinism

Files:

- Modify apps/api/src/semantic-visual-module-compiler.ts
- Modify apps/api/tests/semantic-visual-module-compiler.test.ts

- [ ] Step 1: Add failing relation tests.

Build one anonymous fixture containing add_merge, concat_merge, cross_attention, message_passing, state_read, state_write, feedback and diffusion_iteration. Assert the markers are plus, concat, attention, message, read, write, feedback and diffusion respectively.

Compile the same normalized graph twice and assert deep equality. Assert object keys do not contain x, y, bounds, renderer, visio or command.

- [ ] Step 2: Run the test and verify it fails because relations are still generic arrows or absent.

- [ ] Step 3: Implement this exact mapping:

data_flow to data / arrow
condition_flow to condition / arrow
residual_skip to skip / skip_route
add_merge to merge_add / plus
concat_merge to merge_concat / concat
cross_attention to cross_attention / attention
message_passing to message_passing / message
state_read to state_read / read
state_write to state_write / write
feedback to feedback / feedback
time_step to time_step / time
diffusion_iteration to diffusion_iteration / diffusion

Keep source and target module/port IDs in relation plans. Set diagnostics code candidate-structure for candidate relations and preserve graph export eligibility.

- [ ] Step 4: Run V2 and selected regressions.

    npm.cmd run api:test -- apps/api/tests/semantic-visual-module-compiler.test.ts
    npm.cmd run api:test -- apps/api/tests/semantic-visual-module-contract.test.ts apps/api/tests/composable-region-visual-compiler.test.ts apps/api/tests/publication-visual-grammar.test.ts

Expected: all V2 and selected existing tests pass.

---

### Task 5: Final verification

- [ ] Step 1: Run npx.cmd tsc --noEmit and record any pre-existing dirty-file error separately.
- [ ] Step 2: Run git diff --check for only the V2 files.
- [ ] Step 3: Confirm no V1, PVP or Visio files were modified by V2.
- [ ] Step 4: Report that V2 is renderer-neutral and PVP/Visio integration remains V4/V5 work.
