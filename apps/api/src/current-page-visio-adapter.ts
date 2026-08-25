import {
  buildSelectedPageVisioSessionCommands,
  type BuildSelectedPageVisioSessionCommandsInput,
} from "./visio-worker-client.js";
import {
  parseSelectedPageVisioSessionResponse,
  type SelectedPageVisioSessionCommand,
  type SelectedPageVisioSessionResponse,
} from "./visio-session-protocol.js";

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
    try {
      for (const command of commands) {
        const response = parseSelectedPageVisioSessionResponse(await this.transport.execute(command), input.binding, command);
        if (response.status === "failed") {
          if (command.command === "attachSelectedPage" && response.error === "waiting_for_selected_page") return { status: "waiting_for_selected_page" };
          return { status: "failed", error: response.error ?? "Visio Worker selected-page command failed" };
        }
        attached ||= command.command === "attachSelectedPage";
        if (command.command === "readSelectedPage") return { status: "succeeded", readback: response.readback! };
      }
      return { status: "failed", error: "Visio Worker did not return selected-page readback" };
    } finally {
      if (attached && !commands.slice(0, -1).some((command) => command.command === "closeSession")) {
        const close = commands.at(-1);
        if (close?.command === "closeSession") await this.transport.execute(close).catch(() => undefined);
      }
      await this.transport.close?.().catch(() => undefined);
    }
  }
}
