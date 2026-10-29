#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { AccountManager } from "./manager.js";
import { log } from "./logger.js";
import type { AccountState } from "./account.js";

async function main(): Promise<void> {
  log.info("Steam Hour Farmer v1.0.0 by Alden (realalden27)");

  const config = loadConfig();
  const manager = new AccountManager(config);

  manager.onStateChange((state: AccountState) => {
    const games = state.gamesPlaying.join(", ");
    log.info(`[${state.name}] [${state.status.toUpperCase()}] games: [${games}]`);
  });

  setupShutdown(manager);

  await manager.startAll();
  log.info(`Farming started for ${manager.count} account(s)`);
}

function setupShutdown(manager: AccountManager): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log.info({ signal }, "Shutting down...");
    await manager.stopAll();
    log.info("Goodbye");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "Uncaught exception");
    shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    log.fatal({ reason }, "Unhandled rejection");
    shutdown("unhandledRejection");
  });
}

main().catch((err) => {
  log.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
