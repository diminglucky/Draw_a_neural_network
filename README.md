# Draw_a_neural_network

Draw_a_neural_network is an editable neural-network architecture canvas for creating publication-style diagrams. It focuses on real neural-network visual semantics: feature-map stacks, tensor shapes, convolution kernels, pooling, flatten vectors, dense layers, residual skips, concat nodes, attention blocks, and 3D volumetric networks.

The app is designed for people who want diagrams closer to PlotNeuralNet, NN-SVG, VisualKeras, and Netron-inspired architecture figures, while still keeping every generated element editable on a canvas.

## Highlights

- Paper-style neural network diagrams with visible feature maps, channels, kernels, shape labels, skip paths, concat nodes, and 3D volumes.
- Editable SVG canvas with zoom, pan, minimap, node drag/resize, connection mode, inspector controls, and palette switching.
- Code-to-diagram generation for common PyTorch and Keras/TensorFlow model code.
- PyTorch `forward()` ordering, `nn.Sequential(...)` expansion, residual add detection, `torch.cat(...)` concat detection, and symbolic shape flow such as `H/2 x W/2 x 64`.
- Vision-assisted diagram reconstruction from paper screenshots, sketches, or multiple reference images.
- Universal Neural Network IR: arbitrary operators, custom modules, ports, tensor shapes, evidence, confidence, branches, merges, and explicit unresolved states.
- Universal publication figure planner: selects tensor-flow, residual-graph, encoder-decoder, token-attention, or generic-DAG grammar from topology evidence and preserves arbitrary internal compound graphs.
- Native Microsoft Visio bridge: writes the Universal IR into an existing `.vsdx` through Visio COM, uses native Shapes/connectors/Shape Data, saves, and reads back the rendered node IDs.
- Export to SVG, PNG, and JSON; import JSON to continue editing.
- Built-in templates for CNN, ResNet, U-Net, 3D Medical U-Net, Hybrid ViT, GAN, Diffusion U-Net, and MLP.

## Quick Start

This is a lightweight vanilla JavaScript project. No build step is required.

```bash
node server.js
```

Then open:

```text
http://127.0.0.1:4173/
```

You can also open `index.html` directly for the static canvas experience.

## Optional Vision Backend

To enable AI vision analysis for uploaded diagrams, set `OPENAI_API_KEY` before starting the server:

```bash
OPENAI_API_KEY=your_key node server.js
```

Without an API key, image analysis stops with an explicit `needs_external_vision` status. The app does not fabricate a CNN, U-Net, or other fixed topology from an image it cannot inspect.

## Code Generation

Paste PyTorch or Keras model code into the "Code Generation" panel and click "Draw from Code".

Supported patterns include:

- `nn.Conv1d/2d/3d`, `Conv1D/2D/3D`
- `nn.BatchNorm*`, `BatchNormalization`, `LayerNorm`
- `nn.ReLU`, `F.relu`, `Activation("relu")`, GELU, SiLU, Softmax
- `nn.MaxPool*`, `MaxPooling*`, average/adaptive pooling
- `nn.Linear`, `Dense`
- `nn.Sequential(...)`
- `torch.flatten`, `.flatten(...)`, `.view(...)`, `.reshape(...)`
- `out = out + identity`, `torch.add(...)`, `Add(...)`
- `torch.cat([x, skip], dim=1)`, `Concatenate(...)`
- `nn.MultiheadAttention`, `MultiHeadAttention`
- `ConvTranspose*`, `Upsample`, `UpSampling*`

The browser parser now emits a framework-neutral Universal Neural Network IR before projecting to the editable canvas. Known operations are mapped to semantic primitives; custom PyTorch/Keras modules remain explicit unresolved compound operators with source evidence, ports, and confidence instead of silently becoming generic blocks.

When a PyTorch file contains the source definition of a custom module, the
Agent now extracts the visible submodule assignments and forward-call order
into `attributes.internalGraph`. The browser and Visio paths can therefore
draw the evidenced `Conv / Norm / Attention / Merge` internals of that module.
If the class body is not available, the module remains explicitly unresolved.

The parser is still static and is not a full Python runtime or `torch.fx`/ONNX executor. Conditional control flow, loops, data-dependent routing, and opaque third-party operators are preserved as low-confidence unresolved compounds with source evidence and IR diagnostics; runtime tracing or user confirmation is required for exact expansion. This is intentional: the Agent must surface uncertainty rather than fabricate a topology.

The stable generation boundary is:

```text
code / model file / image / prompt
    -> Universal Neural Network IR
    -> validation + evidence + confidence
    -> semantic canvas projection
    -> publication layout
```

For a Windows machine with Microsoft Visio installed, the native editable path is:

```text
Universal IR
    -> semantic figure grammar + geometry plan
    -> POST /api/render-visio
    -> bind existing .vsdx with Visio COM
    -> native Shape / connector / Shape Data creation
    -> save + readback validation
```

`/api/render-visio` requires `documentPath`; it never creates an implicit blank
Visio canvas. Repeated syncs to the same document and page use a stable
agent-owned render scope, so only the Agent's previous Shapes are replaced.
Existing user Shapes are outside that scope. The browser's **同步到 Visio**
panel exposes this path after a code or image analysis has produced Universal
IR.

Unknown operators are rendered as explicit compound frames. If an internal
graph is present in `attributes.internalGraph`, its actual child nodes and
edges are placed inside the frame. If no evidence exists, the frame remains
`unresolved` with confidence/evidence Shape Data; the Agent does not invent
hidden layers.

All code, IR, prompt, and image requests use the same agent entry point:

```text
analyzeArchitectureInput(input)
    -> ready_for_preview
    -> needs_confirmation
    -> needs_external_vision
    -> invalid_input
```

`POST /api/analyze-code` exposes this boundary for source and IR clients. A
vision provider response is also validated and projected through the same
boundary before it reaches the canvas. Prompt-only requests are retained as
low-confidence unresolved hypotheses; they are never treated as evidence of a
specific model family.

## Editing Workflow

1. Start from a template, uploaded image, or code snippet.
2. Use the canvas to drag, resize, zoom, pan, and inspect nodes.
3. Click internal stack slices to adjust visible feature-map or neuron counts.
4. Use connection mode to draw new signal, attention, skip, or concat paths.
5. Export as SVG/PNG for papers, slides, or documentation.
6. Export JSON if you want to keep editing later.

## Project Structure

```text
.
├── index.html        # App shell and panels
├── styles.css        # Canvas, panel, node, and export styles
├── app.js            # SVG canvas rendering and editing interactions
├── models.js         # Built-in neural architecture templates
├── code-workflow.js  # PyTorch/Keras code-to-diagram generation
├── agent-pipeline.mjs # Unified source/IR/image/prompt routing and status policy
├── universal-ir.mjs  # Framework-neutral IR, validation, and canvas projection
├── universal-figure.mjs # Topology-driven figure grammar selection and geometry
├── visio-bridge.mjs  # Existing-document Visio render plan, COM runner, readback validation
├── visio-bridge.ps1  # Windows Visio COM native Shape/connector/Shape Data bridge
├── visio-client.mjs  # Browser request boundary for same-document Visio sync
├── ai-workflow.js    # Image upload and vision-assisted diagram workflow
├── server.js         # Static server and optional OpenAI vision endpoint
└── favicon.svg
```

## Design Goals

- Make the neural network itself visually rich, not just the surrounding UI.
- Preserve editability after every automatic generation step.
- Prefer architecture semantics over generic flowchart blocks.
- Keep the project easy to run, inspect, and extend without a heavy framework.

## Roadmap

- Deeper Python backend parsing with `torch.fx` or ONNX/Netron-style graph extraction.
- More precise shape inference for padding, dilation, grouped convolution, and complex branches.
- More paper presets for U-Net variants, Transformers, diffusion models, and multimodal models.
- Better automatic layout for very large models.
- Layer-level import/export interoperability with common model visualization formats.
- ONNX / torch.fx runtime extraction for expanding unresolved dynamic modules with evidence.

