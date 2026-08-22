import { describe, expect, it } from "vitest";
import {
  AgentVisioExecutionSnapshotService,
  InMemoryAgentVisioExecutionSnapshotStore,
} from "../src/agent-visio-execution-snapshot.js";
import { FigureDraftService } from "../src/figure-draft-service.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { readyVgg16FigureAnalysis, vgg16AnalysisNeedsConfirmation } from "./fixtures/ready-vgg16-figure-analysis.js";

const owner = { tenantId: "synapse-local", userId: "user-1" };

function services() {
  const foundation = new InMemoryFoundationStore();
  const drafts = new FigureDraftService({
    store: foundation,
    createDraftId: () => "draft-vgg16",
    now: () => "2026-08-19T10:00:00.000Z",
  });
  const snapshots = new InMemoryAgentVisioExecutionSnapshotStore();
  const service = new AgentVisioExecutionSnapshotService({
    foundation,
    figureDraftService: drafts,
    snapshotStore: snapshots,
    now: () => "2026-08-19T10:00:01.000Z",
  });
  return { foundation, drafts, snapshots, service };
}

describe("AgentVisioExecutionSnapshotService", () => {
  it("freezes one deterministic strict Worker diagram from an owner-scoped ready VGG16 revision", async () => {
    const { drafts, snapshots, service } = services();
    await drafts.createFromAnalysis(owner.userId, "conversation-vgg16", readyVgg16FigureAnalysis());

    const created = await service.create({ owner, draftId: "draft-vgg16", revision: 1 });
    const repeated = await service.create({ owner, draftId: "draft-vgg16", revision: 1 });

    expect(created).toMatchObject({
      immutable: true,
      draftId: "draft-vgg16",
      revision: 1,
      planDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      diagram: { nodes: [], edges: [], figurePlan: { primitiveGroups: expect.any(Array), connectors: expect.any(Array), labels: expect.any(Array) } },
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.diagram.figurePlan)).toBe(true);
    expect(repeated).toEqual(created);
    await expect(snapshots.getForRevision(owner, "draft-vgg16", 1)).resolves.toEqual(created);
  });

  it("fails closed without leaking a foreign owner's draft identity", async () => {
    const { drafts, service } = services();
    await drafts.createFromAnalysis(owner.userId, "conversation-vgg16", readyVgg16FigureAnalysis());

    await expect(service.create({ owner: { tenantId: "synapse-local", userId: "other-user" }, draftId: "draft-vgg16", revision: 1 }))
      .rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("accepts a server-issued UUID-like user identity that begins with a digit", async () => {
    const { drafts, service } = services();
    const numericOwner = { tenantId: "synapse-local", userId: "1f1b5d0c-2a3b-4c5d-8e9f-0123456789ab" };
    await drafts.createFromAnalysis(numericOwner.userId, "conversation-vgg16", readyVgg16FigureAnalysis());

    await expect(service.create({ owner: numericOwner, draftId: "draft-vgg16", revision: 1 }))
      .resolves.toMatchObject({ immutable: true, draftId: "draft-vgg16" });
  });

  it("does not create a Worker snapshot for a draft that still needs confirmation", async () => {
    const { drafts, snapshots, service } = services();
    await drafts.createFromAnalysis(owner.userId, "conversation-vgg16", vgg16AnalysisNeedsConfirmation());

    await expect(service.create({ owner, draftId: "draft-vgg16", revision: 1 }))
      .rejects.toMatchObject({ code: "FIGURE_PREVIEW_NOT_READY", statusCode: 409 });
    await expect(snapshots.getForRevision(owner, "draft-vgg16", 1)).resolves.toBeNull();
  });
});
