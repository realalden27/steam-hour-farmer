import { afterEach, describe, expect, it, vi } from "vitest";

const { authenticateMock, readSavedTokenMock, persistTokenMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  readSavedTokenMock: vi.fn(),
  persistTokenMock: vi.fn(),
}));

vi.mock("../src/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth.js")>()),
  authenticate: authenticateMock,
  readSavedToken: readSavedTokenMock,
  persistToken: persistTokenMock,
}));

import { QRLoginTimeoutError } from "../src/auth.js";
import { SteamAccount } from "../src/account.js";
import { ConfigSchema } from "../src/config.js";

describe("SteamAccount", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("skips a timed-out QR account for the rest of the run", async () => {
    vi.useFakeTimers();
    const config = ConfigSchema.parse({
      accounts: [{ name: "main", games: [440], loginMethod: "qr" }],
      settings: { logOnIntervalMs: 10, qrLoginTimeoutMs: 1_000 },
    });
    const account = new SteamAccount(config.accounts[0]!, config.settings);
    authenticateMock.mockRejectedValue(new QRLoginTimeoutError(config.settings.qrLoginTimeoutMs));

    await account.start();

    expect(authenticateMock).toHaveBeenCalledOnce();
    expect(authenticateMock).toHaveBeenCalledWith(
      config.accounts[0],
      config.settings.dataDirectory,
      1_000,
    );
    expect(account.getState().status).toBe("skipped");

    await vi.advanceTimersByTimeAsync(100);

    expect(authenticateMock).toHaveBeenCalledOnce();
    await account.stop();
  });

  it("initializes steamAccountName from saved token while preserving configured account name", () => {
    readSavedTokenMock.mockReturnValue({
      refreshToken: "token-abc",
      accountName: "Alden",
    });

    const config = ConfigSchema.parse({
      accounts: [{ name: "main", games: [1623730], loginMethod: "qr" }],
    });
    const account = new SteamAccount(config.accounts[0]!, config.settings);

    const state = account.getState();
    expect(state.name).toBe("main");
    expect(state.steamAccountName).toBe("Alden");
  });

  it("preserves configured account name and stores steamAccountName when accountInfo fires", () => {
    const config = ConfigSchema.parse({
      accounts: [{ name: "alt", games: [1623730], loginMethod: "qr" }],
    });
    const account = new SteamAccount(config.accounts[0]!, config.settings);

    // Simulate client accountInfo event
    (account as unknown as { client: { emit: (event: string, ...args: unknown[]) => void } }).client.emit(
      "accountInfo",
      "TestAcc",
    );

    const state = account.getState();
    expect(state.name).toBe("alt");
    expect(state.steamAccountName).toBe("TestAcc");
  });

  it("skips logon when claimCheck detects duplicate active Steam account", async () => {
    readSavedTokenMock.mockReturnValue({
      refreshToken: "token-abc",
      accountName: "Alden",
    });

    const config = ConfigSchema.parse({
      accounts: [{ name: "alt", games: [1623730], loginMethod: "qr" }],
    });

    const claimCheck = vi.fn((_id: string | null, name: string | null) =>
      name === "Alden" ? "main" : null,
    );
    const account = new SteamAccount(config.accounts[0]!, config.settings, claimCheck);

    await account.start();

    expect(account.getState().status).toBe("skipped");
    expect(account.getState().lastError).toContain("Duplicate session of [main]");
    await account.stop();
  });
});
