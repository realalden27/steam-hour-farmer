import SteamUser from "steam-user";
import { EventEmitter } from "events";
import { join } from "path";
import type { AccountConfig, AppConfig } from "./config.js";
import {
  authenticate,
  clearSavedToken,
  QRLoginTimeoutError,
  readSavedToken,
  persistToken,
} from "./auth.js";
import { log as rootLog } from "./logger.js";

export type AccountStatus =
  | "offline"
  | "connecting"
  | "online"
  | "farming"
  | "paused"
  | "reconnecting"
  | "rate_limited"
  | "skipped"
  | "error";

export interface AccountState {
  name: string;
  steamAccountName: string | null;
  status: AccountStatus;
  steamId: string | null;
  gamesPlaying: (number | string)[];
  isPaused: boolean;
  lastError: string | null;
  connectedSince: Date | null;
}

export type ClaimConflictCheck = (
  steamId: string | null,
  steamAccountName: string | null,
) => string | null;

export class SteamAccount extends EventEmitter {
  private client: SteamUser;
  private log: ReturnType<typeof rootLog.child>;
  private state: AccountState;
  private settings: AppConfig["settings"];
  private config: AccountConfig;
  private claimCheck?: ClaimConflictCheck;

  private lastLogOnTime = 0;
  private isAuthenticating = false;
  private wasSkipped = false;
  private rateLimitedUntil = 0;
  private backoffMs = 5_000;
  private logOnTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly MAX_BACKOFF_MS = 600_000;

  constructor(
    config: AccountConfig,
    settings: AppConfig["settings"],
    claimCheck?: ClaimConflictCheck,
  ) {
    super();
    this.config = config;
    this.settings = settings;
    this.claimCheck = claimCheck;
    this.log = rootLog.child({ account: config.name });

    const tokenPath = join(settings.dataDirectory, "tokens", `${config.name}.txt`);
    const saved = readSavedToken(tokenPath);

    this.client = new SteamUser({
      machineIdType: SteamUser.EMachineIDType.PersistentRandom,
      dataDirectory: `${settings.dataDirectory}/steam/${config.name}`,
      renewRefreshTokens: true,
      autoRelogin: true,
    });

    this.state = {
      name: config.name,
      steamAccountName: saved?.accountName ?? null,
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
    if (this.wasSkipped) return;
    this.logOnTimer = setInterval(() => this.logOn(), this.settings.logOnIntervalMs);
    this.refreshTimer = setInterval(() => this.refreshGames(), this.settings.refreshGamesIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.logOnTimer) clearInterval(this.logOnTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.state.status === "offline" || this.state.status === "skipped") return;

    this.client.gamesPlayed([]);
    this.client.logOff();
    this.updateState({ status: "offline", connectedSince: null });
    this.log.info("Logged off");
  }

  private async logOn(): Promise<void> {
    if (this.wasSkipped || this.isAuthenticating) return;
    if (this.state.status === "farming") return;
    if (this.state.status === "paused") return;
    if (Date.now() - this.lastLogOnTime < this.settings.minRequestGapMs) return;
    if (Date.now() < this.rateLimitedUntil) return;

    // Check if saved account is already running on another config profile
    if (this.state.steamAccountName && this.claimCheck) {
      const conflict = this.claimCheck(this.state.steamId, this.state.steamAccountName);
      if (conflict) {
        this.wasSkipped = true;
        this.log.warn(
          `Steam account "${this.state.steamAccountName}" is already active under [${conflict}]. Skipping this profile to prevent kick loop.`,
        );
        this.updateState({ status: "skipped", lastError: `Duplicate session of [${conflict}]` });
        return;
      }
    }

    this.updateState({ status: "connecting" });
    this.lastLogOnTime = Date.now();
    this.isAuthenticating = true;
    this.log.info("Connecting to Steam...");

    try {
      const { refreshToken, accountName } = await authenticate(
        this.config,
        this.settings.dataDirectory,
        this.settings.qrLoginTimeoutMs,
      );

      const resolvedAccountName = accountName ?? this.state.steamAccountName;
      if (resolvedAccountName && this.claimCheck) {
        const conflict = this.claimCheck(null, resolvedAccountName);
        if (conflict) {
          this.wasSkipped = true;
          this.log.warn(
            `Authenticated Steam account "${resolvedAccountName}" is already active under [${conflict}]. Skipping to prevent kick loop.`,
          );
          this.updateState({ status: "skipped", lastError: `Duplicate session of [${conflict}]` });
          return;
        }
      }

      if (accountName) {
        this.state.steamAccountName = accountName;
      }
      this.client.logOn({ refreshToken });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof QRLoginTimeoutError) {
        this.wasSkipped = true;
        this.log.warn({ err: message }, "QR login timed out; skipping account for this run");
        this.updateState({ status: "skipped", lastError: message });
        return;
      }

      this.log.error({ err: message }, "Authentication failed");
      this.updateState({ status: "error", lastError: message });
      this.scheduleReconnect();
    } finally {
      this.isAuthenticating = false;
    }
  }

  private bindEvents(): void {
    this.client.on("accountInfo", (name: string) => {
      if (!name) return;
      const prev = this.state.steamAccountName;
      this.state.steamAccountName = name;
      const tokenPath = join(this.settings.dataDirectory, "tokens", `${this.config.name}.txt`);
      const saved = readSavedToken(tokenPath);
      if (saved?.refreshToken) {
        persistToken(tokenPath, saved.refreshToken, name);
      }
      if (!prev) {
        this.log.debug({ steamAccount: name }, "Steam account name resolved");
      }
    });

    this.client.on("loggedOn", () => {
      this.backoffMs = 5_000;
      const steamName = this.client.accountInfo?.name ?? this.state.steamAccountName;
      const steamId = this.client.steamID?.getSteamID64() ?? null;

      if (this.claimCheck) {
        const conflict = this.claimCheck(steamId, steamName);
        if (conflict) {
          this.wasSkipped = true;
          this.log.warn(
            `Steam account "${steamName ?? steamId}" is already active under [${conflict}]. Stopping to prevent kick loop.`,
          );
          this.client.logOff();
          this.updateState({ status: "skipped", lastError: `Duplicate session of [${conflict}]` });
          return;
        }
      }

      this.updateState({
        status: "farming",
        steamAccountName: steamName,
        steamId,
        lastError: null,
        connectedSince: new Date(),
      });
      const personaState = this.config.persona ?? SteamUser.EPersonaState.Online;
      this.client.setPersona(personaState);
      const steamInfo = this.state.steamAccountName ? ` (Steam: ${this.state.steamAccountName})` : "";
      const games = this.state.gamesPlaying.join(", ");
      this.log.info(`Farming active for [${games}]${steamInfo}`);
      this.refreshGames();
    });

    this.client.on("disconnected", (_eresult: number, msg?: string) => {
      this.updateState({ status: "reconnecting", lastError: msg ?? "Disconnected" });
      this.log.warn(msg ? { reason: msg } : {}, "Disconnected");
    });

    this.client.on("error", (err: Error & { eresult?: number }) => {
      if (err.eresult === SteamUser.EResult.LoggedInElsewhere) {
        this.updateState({ status: "reconnecting", lastError: "Kicked by other session" });
        this.log.warn(
          "Kicked by other session (ensure this Steam account is not also running under another profile or on your PC)",
        );
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
      if (
        err.eresult === SteamUser.EResult.InvalidPassword ||
        err.eresult === SteamUser.EResult.Expired ||
        err.eresult === SteamUser.EResult.AccessDenied
      ) {
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
