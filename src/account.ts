import SteamUser from "steam-user";
import { EventEmitter } from "events";
import { join } from "path";
import type { AccountConfig, AppConfig } from "./config.js";
import { authenticate, clearSavedToken, readSavedToken, persistToken } from "./auth.js";
import { log as rootLog } from "./logger.js";

export type AccountStatus =
  | "offline"
  | "connecting"
  | "online"
  | "farming"
  | "paused"
  | "reconnecting"
  | "rate_limited"
  | "error";

export interface AccountState {
  name: string;
  status: AccountStatus;
  steamId: string | null;
  gamesPlaying: (number | string)[];
  isPaused: boolean;
  lastError: string | null;
  connectedSince: Date | null;
}

export class SteamAccount extends EventEmitter {
  private client: SteamUser;
  private log: ReturnType<typeof rootLog.child>;
  private state: AccountState;
  private settings: AppConfig["settings"];
  private config: AccountConfig;

  private lastLogOnTime = 0;
  private rateLimitedUntil = 0;
  private backoffMs = 5_000;
  private logOnTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly MAX_BACKOFF_MS = 600_000;

  constructor(config: AccountConfig, settings: AppConfig["settings"]) {
    super();
    this.config = config;
    this.settings = settings;
    this.log = rootLog.child({ account: config.name });

    this.client = new SteamUser({
      machineIdType: SteamUser.EMachineIDType.PersistentRandom,
      dataDirectory: `${settings.dataDirectory}/steam/${config.name}`,
      renewRefreshTokens: true,
      autoRelogin: true,
    });

    this.state = {
      name: config.name,
      status: "offline",
      steamId: null,
      gamesPlaying: [...config.games],
      isPaused: false,
      lastError: null,
      connectedSince: null,
    };

    this.bindEvents();
  }

  getState(): Readonly<AccountState> {
    return this.state;
  }

  async start(): Promise<void> {
    await this.logOn();
    this.logOnTimer = setInterval(() => this.logOn(), this.settings.logOnIntervalMs);
    this.refreshTimer = setInterval(() => this.refreshGames(), this.settings.refreshGamesIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.logOnTimer) clearInterval(this.logOnTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.state.status === "offline") return;

    this.client.gamesPlayed([]);
    this.client.logOff();
    this.updateState({ status: "offline", connectedSince: null });
    this.log.info("Logged off");
  }

  private setAccountName(name: string): void {
    if (!name || name === "default") return;
    this.state.name = name;
    this.log = rootLog.child({ account: name });
  }

  private async logOn(): Promise<void> {
    if (this.state.status === "farming") return;
    if (this.state.status === "paused") return;
    if (Date.now() - this.lastLogOnTime < this.settings.minRequestGapMs) return;
    if (Date.now() < this.rateLimitedUntil) return;

    this.updateState({ status: "connecting" });
    this.lastLogOnTime = Date.now();

    try {
      const { refreshToken, accountName } = await authenticate(this.config, this.settings.dataDirectory);
      if (accountName && this.state.name === "default") {
        this.setAccountName(accountName);
      }
      this.client.logOn({ refreshToken });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error({ err: message }, "Authentication failed");
      this.updateState({ status: "error", lastError: message });
      this.scheduleReconnect();
    }
  }

  private bindEvents(): void {
    this.client.on("accountInfo", (name: string) => {
      if (!name) return;
      this.setAccountName(name);
      this.updateState({ name });
      const tokenPath = join(this.settings.dataDirectory, "tokens", `${this.config.name}.txt`);
      const saved = readSavedToken(tokenPath);
      if (saved?.refreshToken) {
        persistToken(tokenPath, saved.refreshToken, name);
      }
    });

    this.client.on("loggedOn", () => {
      this.backoffMs = 5_000;
      if (this.client.accountInfo?.name) {
        this.setAccountName(this.client.accountInfo.name);
      }
      this.updateState({
        status: "farming",
        steamId: this.client.steamID?.getSteamID64() ?? null,
        lastError: null,
        connectedSince: new Date(),
      });
      this.log.info({ steamId: this.state.steamId }, "Logged in");

      const personaState = this.config.persona ?? SteamUser.EPersonaState.Online;
      this.client.setPersona(personaState);
      this.refreshGames();
    });

    this.client.on("disconnected", (_eresult: number, msg?: string) => {
      this.updateState({ status: "reconnecting", lastError: msg ?? "Disconnected" });
      this.log.warn({ msg }, "Disconnected");
    });

    this.client.on("error", (err: Error & { eresult?: number }) => {
      if (err.eresult === SteamUser.EResult.LoggedInElsewhere) {
        this.updateState({ status: "reconnecting", lastError: "Kicked by other session" });
        this.log.warn("Kicked by other session");
        this.scheduleReconnect();
        return;
      }

      if (err.eresult === SteamUser.EResult.RateLimitExceeded) {
        this.rateLimitedUntil = Date.now() + 31 * 60_000;
        this.updateState({ status: "rate_limited", lastError: "Rate limited" });
        this.log.warn("Rate limited - retrying in 31 minutes");
        return;
      }

      // Invalid refresh token - clear it and re-auth
      if (err.eresult === SteamUser.EResult.InvalidPassword ||
          err.eresult === SteamUser.EResult.Expired ||
          err.eresult === SteamUser.EResult.AccessDenied) {
        clearSavedToken(this.config.name, this.settings.dataDirectory);
        this.log.warn("Refresh token rejected - will re-authenticate");
      }

      this.updateState({ status: "error", lastError: err.message });
      this.log.error({ err: err.message, eresult: err.eresult }, "Steam error");
      this.scheduleReconnect();
    });

    this.client.on("playingState", (blocked: boolean) => {
      if (this.state.isPaused === blocked) return;

      this.state.isPaused = blocked;
      this.updateState({ status: blocked ? "paused" : "farming" });
      this.log.info(blocked ? "Paused - playing on another session" : "Resumed farming");
      if (!blocked) this.refreshGames();
    });

    this.client.on("refreshToken", (token: string) => {
      if (!token) return;
      this.log.debug("Refresh token renewed");
    });
  }

  private refreshGames(): void {
    if (this.state.status !== "farming") return;
    if (this.state.isPaused) return;
    if (this.state.gamesPlaying.length === 0) return;
    this.client.gamesPlayed(this.state.gamesPlaying);
    this.log.info({ games: this.state.gamesPlaying }, "Farming active");
  }

  private scheduleReconnect(): void {
    this.backoffMs = Math.min(this.backoffMs * 2, SteamAccount.MAX_BACKOFF_MS);
    this.log.info({ retryInSec: Math.round(this.backoffMs / 1000) }, "Reconnecting...");
    setTimeout(() => this.logOn(), this.backoffMs);
  }

  private updateState(partial: Partial<AccountState>): void {
    const isStatusUnchanged = partial.status !== undefined && partial.status === this.state.status;
    const isErrorUnchanged = partial.lastError !== undefined && partial.lastError === this.state.lastError;
    Object.assign(this.state, partial);
    if (isStatusUnchanged && isErrorUnchanged) return;
    this.emit("stateChange", this.state);
  }
}

