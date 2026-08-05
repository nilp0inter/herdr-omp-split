import { describe, expect, it, mock, type Mock } from "bun:test";

import type { PaneInfo } from "../client/types.ts";
import {
  type SplitClient,
  type SplitOptions,
  runSplit,
} from "./split.ts";

const ORIGINAL = "/sessions/2026-08-05T10-00-00Z_a.jsonl";
const FORKED = "/sessions/2026-08-05T10-00-01Z_b.jsonl";

function ompPane(overrides?: Partial<PaneInfo>): PaneInfo {
  return {
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    cwd: "/repo",
    agent: "omp",
    agent_status: "idle",
    agent_session: {
      agent: "omp",
      kind: "path",
      source: "herdr:omp",
      value: ORIGINAL,
    },
    ...overrides,
  };
}

interface MockHerdr extends SplitClient {
  run: Mock<(args: string[]) => Promise<void>>;
  json: Mock<(args: string[]) => Promise<any>>;
}

function testHerdr(pane: PaneInfo): MockHerdr {
  const run = mock(async () => {});
  const json = mock(async () => {
    return { result: { pane } };
  });
  return { run, json };
}

function testOptions(overrides: Partial<SplitOptions> = {}): SplitOptions {
  return {
    paneId: "w1:p1",
    workspaceId: "w1",
    pollIntervalMs: 10,
    ...overrides,
  };
}

describe("runSplit", () => {
  it("forks the session and resumes the original in a new tab", async () => {
    const herdr = testHerdr(ompPane());

    // pane get reports the fork on the second poll.
    let polls = 0;
    herdr.json.mockImplementation(async (args: string[]) => {
      if (args[0] === "pane" && args[1] === "get") {
        polls += 1;
        const session = polls >= 2 ? FORKED : ORIGINAL;
        return {
          result: {
            pane: ompPane({ agent_session: { ...ompPane().agent_session!, value: session } }),
          },
        };
      }
      if (args[0] === "tab" && args[1] === "create") {
        return {
          result: {
            tab: { tab_id: "w1:t9", workspace_id: "w1" },
            root_pane: { pane_id: "w1:p9", tab_id: "w1:t9", workspace_id: "w1" },
          },
        };
      }
      throw new Error(`unexpected json call: ${args.join(" ")}`);
    });

    const result = await runSplit(herdr, testOptions());

    expect(result).toEqual({
      originalSession: ORIGINAL,
      forkedSession: FORKED,
      tabId: "w1:t9",
      paneId: "w1:p9",
    });

    expect(herdr.run).toHaveBeenCalledWith([
      "pane",
      "send-text",
      "w1:p1",
      "/fork",
    ]);
    expect(herdr.run).toHaveBeenCalledWith(["pane", "send-keys", "w1:p1", "Enter"]);
    expect(herdr.run).toHaveBeenCalledWith([
      "pane",
      "run",
      "w1:p9",
      `omp --resume ${JSON.stringify(ORIGINAL)}`,
    ]);
  });

  it("fails when the pane does not run omp", async () => {
    const herdr = testHerdr(ompPane({ agent: "vim" }));

    await expect(runSplit(herdr, testOptions())).rejects.toThrow(
      /does not run an omp agent/,
    );
    expect(herdr.run).not.toHaveBeenCalled();
  });

  it("fails when omp has no reported session file", async () => {
    const herdr = testHerdr(ompPane({ agent_session: undefined }));

    await expect(runSplit(herdr, testOptions())).rejects.toThrow(
      /no session file is reported/,
    );
  });

  it("refuses to fork while the session is streaming", async () => {
    const herdr = testHerdr(ompPane({ agent_status: "working" }));

    await expect(runSplit(herdr, testOptions())).rejects.toThrow(
      /streaming/,
    );
    expect(herdr.run).not.toHaveBeenCalled();
  });

  it("times out when the fork never lands", async () => {
    const herdr = testHerdr(ompPane());

    await expect(
      runSplit(
        herdr,
        testOptions({ pollTimeoutMs: 100, pollIntervalMs: 10 }),
      ),
    ).rejects.toThrow(/Fork did not land/);
  });
});
