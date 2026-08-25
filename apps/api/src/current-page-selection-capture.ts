import {
  SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
  parseSelectedPageCaptureCommand,
  parseSelectedPageCaptureResponse,
  type SelectedPageCaptureCommand,
} from "./visio-session-protocol.js";
import type { SelectedPageSelectionCapture, SelectedPageLeaseOwner, SelectedPageCaptureResult } from "./selected-page-lease.js";

export interface SelectedPageCaptureTransport {
  execute(command: SelectedPageCaptureCommand): Promise<unknown>;
  close?(): Promise<void>;
}

/** Server-only adapter from a Worker capture channel to the lease service. */
export class CurrentPageSelectionCapture implements SelectedPageSelectionCapture {
  constructor(private readonly transport: SelectedPageCaptureTransport, private readonly requestIdFactory: () => string) {}

  async capture(_owner: SelectedPageLeaseOwner): Promise<SelectedPageCaptureResult> {
    const command = parseSelectedPageCaptureCommand({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: this.requestIdFactory(),
      command: "captureSelectedPage",
    });
    try {
      const response = parseSelectedPageCaptureResponse(await this.transport.execute(command), command);
      if (response.status === "failed") {
        if (response.error === "waiting_for_selected_page") return { status: "waiting_for_selected_page" };
        throw new Error(response.error ?? "Visio Worker selected-page capture failed");
      }
      return { status: "captured", target: response.capturedTarget! };
    } finally {
      await this.transport.close?.().catch(() => undefined);
    }
  }
}
