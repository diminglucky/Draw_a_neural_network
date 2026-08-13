import { describe, expect, it } from "vitest";
import { mergeAgentTaskIntent, parseAgentTaskIntent } from "../src/agent-intent.js";

describe("agent task intent", () => {
  it("recognizes an explicit native Visio draw request without treating it as an export command", () => {
    expect(parseAgentTaskIntent({
      message: "根据附件代码绘制顶刊神经网络图，并在 Visio 中新建可编辑文档",
      attachments: [{ kind: "code", name: "model.py", mimeType: "text/x-python", data: "class Model: pass" }],
      draftRef: null,
    })).toMatchObject({
      action: "create_figure",
      sourceMode: "code",
      requestedArtifact: "visio_document",
      userConstraints: { requiresNativeVisio: true, density: "standard", orientation: "auto", printMode: "auto" },
    });
  });

  it("recognizes an existing-draft visual revision without changing structure scope", () => {
    expect(parseAgentTaskIntent({
      message: "把第三个 Encoder 展开并改成黑白期刊版",
      attachments: [],
      draftRef: { draftId: "draft-1", revision: 3 },
    })).toMatchObject({
      action: "revise_figure",
      referencesDraftId: "draft-1",
      requestedArtifact: "architecture_detail",
      userConstraints: { printMode: "grayscale", density: "detailed" },
    });
  });

  it("preserves explicit user constraints over a provider suggestion", () => {
    const base = parseAgentTaskIntent({ message: "画黑白网络图", attachments: [], draftRef: null });
    expect(mergeAgentTaskIntent(base, { userConstraints: { printMode: "color", density: "compact" } }))
      .toMatchObject({ userConstraints: { printMode: "grayscale", density: "compact" } });
  });

  it("keeps draft revision precedence when export language is also present", () => {
    expect(parseAgentTaskIntent({
      message: "导出当前草稿并把第三个 Encoder 展开",
      attachments: [],
      draftRef: { draftId: "draft-1", revision: 3 },
    })).toMatchObject({ action: "revise_figure", referencesDraftId: "draft-1" });
  });

  it("keeps an explicit native Visio artifact when the provider suggests another artifact", () => {
    const base = parseAgentTaskIntent({
      message: "绘制网络图并在 Visio 中新建可编辑文档",
      attachments: [],
      draftRef: null,
    });
    expect(mergeAgentTaskIntent(base, { requestedArtifact: "paper_overview" }))
      .toMatchObject({
        requestedArtifact: "visio_document",
        userConstraints: { requiresNativeVisio: true },
      });
  });
});
