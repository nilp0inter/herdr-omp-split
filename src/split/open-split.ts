import { Herdr } from "../client/herdr.ts";
import { runSplit } from "./split.ts";

async function openSplit(): Promise<void> {
  const herdr = new Herdr();
  const result = await runSplit(herdr);
  console.log(
    `✓ Forked ${result.originalSession} → ${result.forkedSession} in this pane; ` +
      `resumed the original in tab ${result.tabId} (pane ${result.paneId})`,
  );
}

openSplit().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
