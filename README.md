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

## Commercial foundation quick start

The commercial foundation adds the online authorization boundary required for paid use. The browser client remains the existing editable SVG canvas, but its interaction layer is covered by an authorization gate until the Foundation API confirms the user, device, session lease, and subscription.

The current Windows-first development slice includes:

- online registration/login and access-token sessions;
- one active session per account, with heartbeat lease renewal;
- device ownership records and an explicit development device identity;
- trial subscription and entitlement contracts;
- admin login, dashboard, user/device/session/Job/audit views, and forced session revocation;
- authenticated Job lifecycle and explicit Agent/Visio adapter boundaries;
- PostgreSQL migration and Redis/PostgreSQL Docker boundary;
- Redis-backed distributed leases with monotonic fencing tokens and explicit shutdown cleanup;
- PostgreSQL session claims and conditional writes are fenced with the Redis token;
- Ed25519 device challenges are single-use and production login can require a valid device proof;
- server-side authorization for the existing diagram-analysis endpoint.

The current slice includes the PostgreSQL adapter and a Redis lease adapter with an in-memory test mode. It does not claim to include the Windows DPAPI device-key bridge, real OpenAI provider, Vision code understanding, Visio COM automation, or `.vsdx` export. Those are the next integration phase.

### Run on Windows locally

Use two PowerShell terminals from the repository root:

```powershell
npm install
$env:NODE_ENV = "development"
$env:SESSION_SECRET = "local-session-secret-change-me-32-characters"
$env:ADMIN_PASSWORD = "local-admin-password-please-change"
npm run api:dev
```

In the second terminal:

```powershell
$env:FOUNDATION_API_URL = "http://127.0.0.1:4180"
node server.js
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). The first visit is locked; choose “注册试用账号” to create the first user and bind the development device identity. The admin console is at [http://127.0.0.1:4173/apps/admin/](http://127.0.0.1:4173/apps/admin/).

The default API store is memory-only and is intentionally suitable only for local development/tests. Restarting the API loses users, devices, sessions, and audit data. Production startup rejects `STORAGE_DRIVER=memory`; selecting PostgreSQL creates a real `pg.Pool` and uses the PostgreSQL Store.

Optional local services are defined in `infra/docker-compose.yml`:

```powershell
docker compose -f infra/docker-compose.yml up -d
```

The SQL migration is mounted into PostgreSQL on first initialization. Docker services do not by themselves switch the API to PostgreSQL; set `STORAGE_DRIVER=postgres` and `DATABASE_URL` before starting the API. Verify persistence with:

```powershell
npm run api:smoke:postgres
```

The PostgreSQL smoke also verifies the one-active-session index and rejects stale fencing-token updates after a takeover.

Redis leases are opt-in during local development. Set `LEASE_DRIVER=redis` and keep `REDIS_URL` configured before starting the API. Verify the real Redis Lua adapter and fencing behavior with:

```powershell
npm run api:smoke:redis
```

## Existing canvas quick start

This is a lightweight vanilla JavaScript project. No build step is required.

```bash
node server.js
```

Then open:

```text
http://127.0.0.1:4173/
```

You can also open `index.html` directly for the static canvas experience.

## Authenticated Vision Backend

To enable AI vision analysis for uploaded diagrams, set `OPENAI_API_KEY` before starting the server:

```bash
OPENAI_API_KEY=your_key node server.js
```

The analysis endpoint now requires an active Foundation API session even when `OPENAI_API_KEY` is not configured. Without an API key, an authenticated request receives the existing server-side draft synthesis; this is a development fallback and is not the commercial Agent/OpenAI implementation. Unauthenticated requests receive `401` and do not receive a local fallback.

### Device proof and Electron boundary

The API supports one-time Ed25519 device challenges. Enable the production-style gate locally with:

```powershell
$env:REQUIRE_DEVICE_PROOF = "true"
```

The browser gate delegates `getIdentity()` and `signChallenge(challenge)` to `globalThis.synapseDeviceKey` when proof is required. In the final Windows client this object must be exposed through a preload/IPC bridge whose private key is held by the Electron main process and protected by Windows DPAPI. The current browser bootstrap identity is only a development/test fallback and is not commercial device security.

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
├── apps/api/          # Auth, sessions, subscriptions, jobs, admin, and adapters
├── apps/client/       # Online authorization gate for the canvas
├── apps/admin/        # Minimal authenticated operations console
├── apps/api/sql/      # PostgreSQL production-boundary migration
├── infra/              # Optional local PostgreSQL/Redis services
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

## Commercial implementation status

This repository now has a runnable foundation, not a finished paid product. Before commercial release, the following gates still need independent acceptance:

1. replace the provider contract with the native Windows DPAPI implementation and signed Electron packaging;
2. move Agent/OpenAI calls behind the API `AgentProvider`, with quotas, cost limits, retries, redaction, and provider audit;
3. implement the neural-network IR and validated layout pipeline;
4. implement the `VisioExecutor` through a controlled Windows worker and validate readback/export;
5. add billing-provider webhooks, entitlement reconciliation, rate limiting, abuse detection, backups, migrations, and operational alerts;
6. package/sign the Windows client and perform clean-machine, upgrade, revoke, offline, reconnect, and concurrent-login acceptance tests.

