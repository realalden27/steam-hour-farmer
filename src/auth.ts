import { LoginSession, EAuthTokenPlatformType } from "steam-session";
import SteamTotp from "steam-totp";
import qrcode from "qrcode-terminal";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { AccountConfig } from "./config.js";
import { log } from "./logger.js";

const LOGIN_TIMEOUT_MS = 120_000;

export interface AuthResult {
  refreshToken: string;
  accountName?: string;
}

export async function authenticate(account: AccountConfig, dataDir: string): Promise<AuthResult> {
  const tokenPath = join(dataDir, "tokens", `${account.name}.txt`);

  const saved = readSavedToken(tokenPath);
  if (saved) {
    const displayAccount = saved.accountName || account.name;
    log.info({ account: displayAccount }, "Using saved refresh token");
    return saved;
  }

  if (account.loginMethod === "credentials" && account.accountName && account.password) {
    log.info({ account: account.name }, "Authenticating with credentials");
    const result = await loginWithCredentials(account);
    persistToken(tokenPath, result.refreshToken, result.accountName);
    return result;
  }

  log.info({ account: account.name }, "Authenticating with QR code");
  const result = await loginWithQR(account.name);
  persistToken(tokenPath, result.refreshToken, result.accountName);
  return result;
}

export function clearSavedToken(accountName: string, dataDir: string): void {
  const tokenPath = join(dataDir, "tokens", `${accountName}.txt`);
  if (!existsSync(tokenPath)) return;
  writeFileSync(tokenPath, "", "utf-8");
  log.debug({ account: accountName }, "Cleared saved refresh token");
}

async function loginWithCredentials(account: AccountConfig): Promise<AuthResult> {
  if (!account.accountName) throw new Error("accountName required for credential login");
  if (!account.password) throw new Error("password required for credential login");

  const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
  session.loginTimeout = LOGIN_TIMEOUT_MS;

  const startResult = await session.startWithCredentials({
    accountName: account.accountName,
    password: account.password,
    steamGuardCode: account.sharedSecret
      ? SteamTotp.generateAuthCode(account.sharedSecret)
      : undefined,
  });

  if (startResult.actionRequired) {
    log.info({ account: account.name }, "Steam Guard approval required...");
  }

  return new Promise<AuthResult>((resolve, reject) => {
    session.on("authenticated", () => {
      if (!session.refreshToken) return reject(new Error("No refresh token received"));
      resolve({
        refreshToken: session.refreshToken,
        accountName: session.accountName || account.accountName,
      });
    });
    session.on("timeout", () => reject(new Error("Login timed out")));
    session.on("error", (err) => reject(err));
  });
}

async function loginWithQR(accountName: string): Promise<AuthResult> {
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
  session.loginTimeout = LOGIN_TIMEOUT_MS;

  const startResult = await session.startWithQR();
  if (!startResult.qrChallengeUrl) {
    throw new Error("Failed to retrieve QR code challenge URL from Steam");
  }

  console.log(`\n  Scan this QR code with your Steam mobile app (account: ${accountName}):\n`);
  qrcode.generate(startResult.qrChallengeUrl, { small: true });

  return new Promise<AuthResult>((resolve, reject) => {
    session.on("remoteInteraction", () => {
      log.info("QR scanned - approve the login on your phone");
    });

    session.on("authenticated", () => {
      if (!session.refreshToken) return reject(new Error("No refresh token received"));
      const resolvedAccount = session.accountName || session.steamID?.toString();
      log.info({ steamID: session.steamID?.toString(), account: resolvedAccount }, "QR authentication successful");
      resolve({
        refreshToken: session.refreshToken,
        accountName: session.accountName,
      });
    });

    session.on("timeout", () => reject(new Error("QR login timed out (2 min)")));
    session.on("error", (err) => reject(err));
  });
}

export function readSavedToken(tokenPath: string): AuthResult | null {
  if (!existsSync(tokenPath)) return null;
  const raw = readFileSync(tokenPath, "utf-8").trim();
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    if (data.refreshToken) {
      return {
        refreshToken: data.refreshToken,
        accountName: data.accountName,
      };
    }
  } catch {
    // Legacy plain text format fallback
  }

  return { refreshToken: raw };
}

export function persistToken(tokenPath: string, token: string, accountName?: string): void {
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify({ refreshToken: token, accountName }), "utf-8");
  log.debug("Refresh token saved");
}

