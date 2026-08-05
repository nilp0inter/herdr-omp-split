import { HerdrError, SplitError } from "../client/errors.ts";
import type { Herdr } from "../client/herdr.ts";
import type { PaneInfo } from "../client/types.ts";

export const FORK_POLL_INTERVAL_MS = 500;
export const FORK_POLL_TIMEOUT_MS = 30_000;

/** Minimal CLI surface the split flow needs; `Herdr` satisfies it. */
export interface SplitClient {
  run(args: readonly string[]): Promise<void>;
  json<T>(args: readonly string[]): Promise<T>;
}

export interface SplitResult {
  /** Session file that was active before the fork. */
  originalSession: string;
  /** Session file the fork created; now active in the current pane. */
  forkedSession: string;
  /** New tab that resumed the original session. */
  tabId: string;
  /** Pane inside the new tab. */
  paneId: string;
}

export interface SplitOptions {
  /** Pane that runs omp; defaults to HERDR_PANE_ID. */
  paneId?: string;
  /** Workspace for the new tab; defaults to the current pane's workspace. */
  workspaceId?: string;
  /** Poll interval while waiting for the fork. */
  pollIntervalMs?: number;
  /** Overall timeout for the fork to land. */
  pollTimeoutMs?: number;
}

interface TabCreateResult {
  tab: { tab_id: string; workspace_id: string };
  root_pane: PaneInfo;
}

function isOmpPane(pane: PaneInfo): boolean {
  return pane.agent === "omp";
}

function sessionFileOf(pane: PaneInfo): string | undefined {
  const value = pane.agent_session?.value;
  return typeof value === "string" && value.endsWith(".jsonl") ? value : undefined;
}

export async function runSplit(
  herdr: SplitClient,
  options: SplitOptions = {},
): Promise<SplitResult> {
  const pollIntervalMs = options.pollIntervalMs ?? FORK_POLL_INTERVAL_MS;
  const pollTimeoutMs = options.pollTimeoutMs ?? FORK_POLL_TIMEOUT_MS;

  const initial = await currentPane(herdr, options);
  const paneId = initial.pane_id;
  const workspaceId = options.workspaceId ?? initial.workspace_id;

  if (!isOmpPane(initial)) {
    throw new SplitError(
      `Pane ${paneId} does not run an omp agent (agent=${initial.agent ?? "unknown"}). ` +
        "Start omp in the pane before splitting.",
    );
  }

  const originalSession = sessionFileOf(initial);
  if (!originalSession) {
    throw new SplitError(
      `Pane ${paneId} runs omp but no session file is reported yet. ` +
        "Start a persisted session before splitting.",
    );
  }

  if (initial.agent_status === "working") {
    throw new SplitError(
      "The omp session is streaming. /fork is rejected while a response is in " +
        "flight; wait for it to finish and run the split again.",
    );
  }

  // Type /fork into the omp editor and submit it. /fork copies the current
  // session into a new file and switches this pane to the clone; the original
  // file stays on disk and is what the new tab resumes.
  await herdr.run(["pane", "send-text", paneId, "/fork"]);
  await herdr.run(["pane", "send-keys", paneId, "Enter"]);

  const forkedSession = await waitForFork(herdr, paneId, originalSession, {
    pollIntervalMs,
    pollTimeoutMs,
  });

  // Create the new tab in the current workspace. The response carries the
  // root pane inline; `pane current` can report the stale pre-focus pane, so
  // do not rely on it here.
  const created = await herdr.json<{ result: TabCreateResult }>([
    "tab",
    "create",
    "--workspace",
    workspaceId,
    "--cwd",
    initial.cwd ?? ".",
    "--label",
    "split",
    "--focus",
  ]);
  const tabId = created.result.tab.tab_id;
  const pane = created.result.root_pane;

  // Resume the ORIGINAL session in the new tab. --resume with a path opens the
  // exact file; --continue would follow the per-terminal breadcrumb instead.
  await herdr.run([
    "pane",
    "run",
    pane.pane_id,
    `omp --resume ${JSON.stringify(originalSession)}`,
  ]);

  return {
    originalSession,
    forkedSession,
    tabId,
    paneId: pane.pane_id,
  };
}

async function currentPane(
  herdr: SplitClient,
  options: SplitOptions,
): Promise<PaneInfo> {
  if (options.paneId) {
    const pane = await paneById(herdr, options.paneId);
    if (pane) return pane;
    throw new SplitError(`Pane ${options.paneId} was not found.`);
  }

  const envPane = process.env.HERDR_PANE_ID;
  if (envPane) {
    const pane = await paneById(herdr, envPane);
    if (pane) return pane;
    throw new SplitError(`HERDR_PANE_ID pane ${envPane} was not found.`);
  }

  const result = await herdr.json<{ result: { pane: PaneInfo } }>([
    "pane",
    "current",
  ]);
  return result.result.pane;
}

async function paneById(
  herdr: SplitClient,
  paneId: string,
): Promise<PaneInfo | undefined> {
  const result = await herdr.json<{ result: { pane: PaneInfo } }>([
    "pane",
    "get",
    paneId,
  ]);
  return result.result.pane;
}

async function waitForFork(
  herdr: SplitClient,
  paneId: string,
  originalSession: string,
  options: { pollIntervalMs: number; pollTimeoutMs: number },
): Promise<string> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < options.pollTimeoutMs) {
    try {
      const pane = await paneById(herdr, paneId);
      const session = pane ? sessionFileOf(pane) : undefined;
      if (session && session !== originalSession) {
        return session;
      }
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, options.pollIntervalMs);
    await promise;
  }

  if (lastError instanceof HerdrError) {
    throw new SplitError(`Fork did not land: ${lastError.message}`);
  }
  throw new SplitError(
    `Fork did not land within ${Math.round(options.pollTimeoutMs / 1000)}s. ` +
      "The session may be streaming (wait for it) or not persisted.",
  );
}
