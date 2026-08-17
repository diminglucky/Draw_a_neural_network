# Draw_a_neural_network

Draw_a_neural_network is an editable neural-network architecture canvas for creating publication-style diagrams. It focuses on real neural-network visual semantics: feature-map stacks, tensor shapes, convolution kernels, pooling, flatten vectors, dense layers, residual skips, concat nodes, attention blocks, and 3D volumetric networks.

The app is designed for people who want diagrams closer to PlotNeuralNet, NN-SVG, VisualKeras, and Netron-inspired architecture figures, while still keeping every generated element editable on a canvas.

## Cross-computer start

Before working on another machine, read [docs/START_HERE.md](docs/START_HERE.md) and the instructions for [coding agents](AGENTS.md), then use `git switch agent` to select the current product branch.

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
- Windows Electron main-process device keys protected by DPAPI `CurrentUser`, with a fixed preload IPC bridge;
- server-issued device ids are write-once bound to the DPAPI key and reused after Electron restart;
- server-side authorization for the existing diagram-analysis endpoint.

The current slice includes the PostgreSQL adapter, a Redis lease adapter with an in-memory test mode, the Windows DPAPI device-key bridge, and a controlled Visio Worker/API boundary. It does not claim live Visio COM acceptance, signed installer delivery, or independently inspected `.vsdx` output until those gates are run.

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

To run the Windows Electron shell, install dependencies and rebuild the native addon for Electron before starting the client:

```powershell
npm install
npm run desktop:rebuild
npm run desktop:smoke
$env:FOUNDATION_UI_URL = "http://127.0.0.1:4173"
npm run desktop:dev
```

`desktop:smoke` creates and reloads a DPAPI-protected Ed25519 key, binds a server-style device id, and verifies a challenge signature without printing private material. The smoke is a Windows-only acceptance gate. The vendored `vendor/win-dpapi` package is derived from the MIT-licensed [daguej/node-dpapi](https://github.com/daguej/node-dpapi) 1.1.0 source and contains the minimum modern-MSVC const-correctness compatibility patch. Electron binaries are downloaded during installation; if the default release host is unavailable in a local network, set an approved mirror such as `$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"` before `npm install`.

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). The first visit is locked; choose “注册试用账号” to create the first user and bind the development device identity. The admin console is at [http://127.0.0.1:4173/apps/admin/](http://127.0.0.1:4173/apps/admin/).

The default API store is memory-only and is intentionally suitable only for local development/tests. Restarting the API loses users, devices, sessions, and audit data. Production startup rejects `STORAGE_DRIVER=memory`; selecting PostgreSQL creates a real `pg.Pool` and uses the PostgreSQL Store.

Optional local services are defined in `infra/docker-compose.yml`:

```powershell
docker compose -f infra/docker-compose.yml up -d
```

The SQL migrations are mounted into PostgreSQL on first initialization. Docker services do not by themselves switch the API to PostgreSQL; set `STORAGE_DRIVER=postgres` and `DATABASE_URL` before starting the API. For an existing database, apply the incremental SQL files in order through `apps/api/sql/007_universal_figure_export_jobs.sql` before enabling Visio export. `005_visio_job_idempotency.sql` gives each user one durable legacy Visio Job per `Idempotency-Key` and prevents repeated COM execution; `007_universal_figure_export_jobs.sql` enables the separately typed Universal export Job. Verify persistence with:

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

## Agent diagram bridge boundary

The browser canvas remains the first renderer for the Agent MVP. The chat UI submits an authorized request to the Foundation API, receives a validated canvas-compatible `diagram`, and offers explicit preview, confirmation, full-replacement, and Visio-export actions. Agent-originated canvas mutations reuse the same document-application path as the existing code/image workflows, so manual editing, SVG/PNG export, JSON export, JSON re-import, and controlled `.vsdx` export remain separate user actions.

For local development, the Agent path is allowed to use a deterministic local provider so the browser UI can be exercised without claiming real model analysis. The Agent drawer now has a provider API Key field: the user may save a key for the current application session, and the client sends it only in the transient `X-Synapse-Provider-Api-Key` request header. The key is not included in the canvas JSON, request body, usage audit metadata, or diagram output. The provider base URL is server-controlled through `OPENAI_BASE_URL`; there is no client URL setting or request field that can select an arbitrary provider endpoint. In other words, the canvas only consumes validated diagram JSON, not raw model output, raw SVG, or direct provider responses.

The Agent request carries a canonical, bounded snapshot of the current canvas: only allowlisted figure, node, and edge fields are projected to the request, and the API rejects unknown fields, oversized snapshots, and malformed references before provider execution. The API returns a validated `diagramIntent` and strict allowlisted `actions` set. Modifications are previewed first and require explicit user confirmation plus a fresh preview token before the Agent action bridge changes the canvas; full replacement also requires explicit confirmation. The local deterministic provider includes journal-oriented ResNet, U-Net, and Vision Transformer presets with tensor subtitles, stage labels, skip/concat/add fusion, attention blocks, source evidence, and black-and-white-safe style metadata. The Agent cannot execute JavaScript, Python, shell, raw SVG, COM commands, or arbitrary desktop actions.

Microsoft Visio remains a Worker responsibility, not a browser responsibility. The browser bridge only applies a browser-renderable canvas document; the separate Visio export route consumes the same validated diagram boundary rather than bypassing the browser or exposing desktop control to the model.

### Device proof and Electron boundary

The API supports one-time Ed25519 device challenges. Enable the production-style gate locally with:

```powershell
$env:REQUIRE_DEVICE_PROOF = "true"
```

The browser gate delegates `getIdentity()` and `signChallenge(challenge)` to `globalThis.synapseDeviceKey` when proof is required. In the final Windows client this object must be exposed through a preload/IPC bridge whose private key is held by the Electron main process and protected by Windows DPAPI. The current browser bootstrap identity is only a development/test fallback and is not commercial device security.

### Visio Worker export boundary

The Visio integration is an independent Windows Worker boundary. The Node API never holds a Visio COM object: an authenticated `POST /api/visio/export` request creates a user-owned `visio-export` Job, sends a normalized diagram over one JSON-lines request to a per-job C# Worker process, and publishes the `.vsdx` path only after the Worker has performed readback validation.

The route is asynchronous and recoverable. A new export returns `202` with `status: "queued"` and `pollUrl`; the browser polls `GET /api/jobs/:id` until `succeeded`, `failed`, `cancelled`, or `expired`. `POST /api/jobs/:id/cancel` can cancel only the authenticated user's queued or running Visio Job. The API aborts the corresponding Worker process, marks running Jobs left by an API restart as `expired`, and preserves `Idempotency-Key` replays without starting a second Worker.

Build the Worker solution from PowerShell:

```powershell
dotnet build workers/visio-worker/VisioWorker.sln
```

Run the headless mock Worker smoke without Microsoft Visio:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/visio-worker-mock-smoke.ps1
```

After building the live Worker on a Windows host with Visio installed, exercise the complete asynchronous authenticated route and idempotency replay with:

```powershell
npx tsx scripts/visio-api-route-async-live-smoke.ts
```

The smoke must report `firstStatusCode: 202`, `replayStatusCode: 200`, a succeeded readback, and exactly one generated `.vsdx` file. The existing route smoke also follows the `202` response through polling:

```powershell
npx tsx scripts/visio-api-route-live-smoke.ts
```

Configure the API with a Worker executable and an output root when enabling export:

```powershell
$env:VISIO_WORKER_PATH = "C:\path\to\VisioWorker.Host.exe"
$env:VISIO_OUTPUT_ROOT = "C:\path\to\visio-exports"
$env:VISIO_WORKER_MODE = "live" # use mock only for headless CI
$env:VISIO_VISIBLE = "true"
$env:VISIO_ATTACH_TO_RUNNING = "false" # set true only when explicitly reusing an existing Visio instance
$env:VISIO_WORKER_TIMEOUT_MS = "120000"
```

In development, when `VISIO_WORKER_PATH` is absent, the API searches the packaged Worker location and the repository's Release/Debug build locations automatically. The output root defaults to a temporary Synapse directory when a Worker is discovered. An explicit path remains authoritative. `VISIO_VISIBLE=true` makes the live COM instance visible, while `VISIO_ATTACH_TO_RUNNING=true` asks the Worker to reuse an already-running Visio instance when possible. The Electron desktop bridge exposes a restricted `openPath` action for the validated final `.vsdx`; the browser never executes a shell command. The default `mock` mode is a headless CI artifact generator and is never evidence of live Visio COM acceptance. The live acceptance gate additionally requires an installed Visio instance, a successful `.vsdx` readback, and independent close/reopen inspection. The Worker uses only native basic shapes and connectors; GitHub projects were consulted as implementation references and are not runtime dependencies.

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

1. complete signed Electron packaging, auto-update signing, uninstall/reinstall policy, and clean-machine acceptance around the native Windows DPAPI implementation;
2. extend Agent/OpenAI governance with token-based cost limits, bounded retries/timeouts, and production redaction/usage accounting; the current MVP already keeps providers behind the API, enforces a PostgreSQL-capable monthly `agentChatRequests` usage ledger with `Idempotency-Key` protection, records provider-neutral request/completion/failure/rejection audit metadata, and excludes message/file contents from audit records;
3. the Network IR and deterministic validated publication-layout pipeline are implemented for the browser MVP; independent production/host acceptance remains separate from the focused tests and local deterministic smoke;
4. complete live Visio COM acceptance, independent `.vsdx` inspection, signed Worker packaging, and operational recovery tests; the controlled Worker/API boundary and headless mock path are implemented, but this repository does not claim live COM acceptance until those gates are run;
5. add billing-provider webhooks, entitlement reconciliation, rate limiting, abuse detection, backups, migrations, and operational alerts;
6. package/sign the Windows client and perform clean-machine, upgrade, revoke, offline, reconnect, and concurrent-login acceptance tests.

