import { SteamAccount, type AccountState } from "./account.js";
import type { AppConfig } from "./config.js";
import { log } from "./logger.js";

export class AccountManager {
  private accounts: SteamAccount[] = [];

  constructor(config: AppConfig) {
    for (const accountConfig of config.accounts) {
      if (!accountConfig.enabled) continue;
      this.accounts.push(new SteamAccount(accountConfig, config.settings));
    }

    if (this.accounts.length === 0) {
      throw new Error("No enabled accounts found in config");
    }

    log.info({ count: this.accounts.length }, "Accounts loaded");
  }

  async startAll(): Promise<void> {
    for (const account of this.accounts) {
      await account.start();
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.accounts.map((a) => a.stop()));
  }

  onStateChange(handler: (state: AccountState) => void): void {
    for (const account of this.accounts) {
      account.on("stateChange", handler);
    }
  }

  get count(): number {
    return this.accounts.length;
  }
}

