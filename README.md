# Draw_a_neural_network

Draw_a_neural_network is an editable neural-network architecture canvas for creating publication-style diagrams. It focuses on real neural-network visual semantics: feature-map stacks, tensor shapes, convolution kernels, pooling, flatten vectors, dense layers, residual skips, concat nodes, attention blocks, and 3D volumetric networks.

The app is designed for people who want diagrams closer to PlotNeuralNet, NN-SVG, VisualKeras, and Netron-inspired architecture figures, while still keeping every generated element editable on a canvas.

## Highlights

- Paper-style neural network diagrams with visible feature maps, channels, kernels, shape labels, skip paths, concat nodes, and 3D volumes.
- Editable SVG canvas with zoom, pan, minimap, node drag/resize, connection mode, inspector controls, and palette switching.
- Code-to-diagram generation for common PyTorch and Keras/TensorFlow model code.
- PyTorch `forward()` ordering, `nn.Sequential(...)` expansion, residual add detection, `torch.cat(...)` concat detection, and symbolic shape flow such as `H/2 x W/2 x 64`.
- Vision-assisted diagram reconstruction from paper screenshots, sketches, or multiple reference images.
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

Without an API key, the app still works and uses local fallback synthesis for uploaded references.

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

The parser is intentionally lightweight and runs in the browser. It handles common architecture code well, but it is not a full Python runtime or `torch.fx` tracer. Highly dynamic control flow may need manual editing after generation.

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

