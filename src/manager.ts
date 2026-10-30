import { SteamAccount, type AccountState, type ClaimConflictCheck } from "./account.js";
import type { AppConfig } from "./config.js";
import { log } from "./logger.js";

export class AccountManager {
  private accounts: SteamAccount[] = [];

  constructor(config: AppConfig) {
    const checkClaimConflict = (
      self: SteamAccount,
      steamId: string | null,
      steamAccountName: string | null,
    ): string | null => {
      for (const account of this.accounts) {
        if (account === self) continue;
        const other = account.getState();
        if (other.status === "offline" || other.status === "skipped" || other.status === "error") {
          continue;
        }

        if (steamId && other.steamId && other.steamId === steamId) {
          return other.name;
        }

        if (
          steamAccountName &&
          other.steamAccountName &&
          other.steamAccountName.toLowerCase() === steamAccountName.toLowerCase()
        ) {
          return other.name;
        }
      }
      return null;
    };

    for (const accountConfig of config.accounts) {
      if (!accountConfig.enabled) continue;
      let accountRef: SteamAccount;
      const claimCheck: ClaimConflictCheck = (steamId, steamAccountName) =>
        checkClaimConflict(accountRef, steamId, steamAccountName);

      const account = new SteamAccount(accountConfig, config.settings, claimCheck);
      accountRef = account;
      this.accounts.push(account);
    }

    if (this.accounts.length === 0) {
      throw new Error("No enabled accounts found in config");
    }

    log.info(`Loaded ${this.accounts.length} account(s)`);
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
