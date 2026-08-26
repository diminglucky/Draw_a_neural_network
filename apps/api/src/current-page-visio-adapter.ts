import {
  buildSelectedPageVisioSessionCommands,
  type BuildSelectedPageVisioSessionCommandsInput,
} from "./visio-worker-client.js";
import {
  parseSelectedPageVisioSessionResponse,
  type SelectedPageVisioSessionCommand,
  type SelectedPageVisioSessionResponse,
} from "./visio-session-protocol.js";
import { canonicalJson } from "./plan-snapshot.js";

export interface SelectedPageWorkerTransport {
  execute(command: SelectedPageVisioSessionCommand): Promise<unknown>;
  close?(): Promise<void>;
}

export interface CurrentPageVisioDrawInput extends BuildSelectedPageVisioSessionCommandsInput {}

export type CurrentPageVisioDrawResult =
  | { status: "succeeded"; readback: NonNullable<SelectedPageVisioSessionResponse["readback"]> }
  | { status: "waiting_for_selected_page" }
  | { status: "failed"; error: string };

/** Server-side v3 orchestration. Raw PVP/source/path input is intentionally absent. */
export class CurrentPageVisioAdapter {
  constructor(private readonly transport: SelectedPageWorkerTransport) {}

  async draw(input: CurrentPageVisioDrawInput): Promise<CurrentPageVisioDrawResult> {
    const commands = buildSelectedPageVisioSessionCommands(input);
    let attached = false;
    let closed = false;
    let preSaveReadback: NonNullable<SelectedPageVisioSessionResponse["readback"]> | undefined;
    let postSaveReadback: NonNullable<SelectedPageVisioSessionResponse["readback"]> | undefined;
    try {
      for (const command of commands) {
        if (command.command === "closeSession") closed = true;
        const response = parseSelectedPageVisioSessionResponse(await this.transport.execute(command), input.binding, command);
        if (response.status === "failed") {
          if (command.command === "attachSelectedPage" && response.error === "waiting_for_selected_page") return { status: "waiting_for_selected_page" };
          return { status: "failed", error: response.error ?? "Visio Worker selected-page command failed" };
        }
        attached ||= command.command === "attachSelectedPage";
        if (command.command === "readSelectedPage") {
          if (!preSaveReadback) {
            preSaveReadback = response.readback!;
            continue;
          }
          postSaveReadback = response.readback!;
          if (!sameSelectedPageReadback(preSaveReadback, postSaveReadback)) {
            return { status: "failed", error: "Visio Worker post-save readback does not match pre-save readback" };
          }
          continue;
        }
        if (command.command === "saveSelectedDocument" && !preSaveReadback) {
          return { status: "failed", error: "Visio Worker did not return a pre-save selected-page readback" };
        }
      }
      if (!postSaveReadback) return { status: "failed", error: "Visio Worker did not return a post-save selected-page readback" };
      return { status: "succeeded", readback: postSaveReadback };
    } finally {
      if (attached && !closed) {
        const close = commands.at(-1);
        if (close?.command === "closeSession") {
          closed = true;
          await this.transport.execute(close).catch(() => undefined);
        }
      }
      await this.transport.close?.().catch(() => undefined);
    }
  }
}

function sameSelectedPageReadback(
  left: NonNullable<SelectedPageVisioSessionResponse["readback"]>,
  right: NonNullable<SelectedPageVisioSessionResponse["readback"]>,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
