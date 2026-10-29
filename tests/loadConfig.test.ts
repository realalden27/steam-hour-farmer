import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("dotenv", () => ({
  default: {
    config: vi.fn(),
  },
}));

import { loadConfig, type AccountConfig } from "../src/config.js";

describe("loadConfig()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ACCOUNT_NAME;
    delete process.env.PASSWORD;
    delete process.env.GAMES;
    delete process.env.SHARED_SECRET;
    delete process.env.PERSONA;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws error when neither config.json nor GAMES env var is present", () => {
    expect(() => loadConfig()).toThrow("No config.json and no GAMES env var. See README.");
  });

  it("loads config in QR mode when GAMES is set without credentials", () => {
    process.env.GAMES = "440,730";
    const config = loadConfig();

    expect(config.accounts).toHaveLength(1);
    const account = config.accounts[0] as AccountConfig;
    expect(account.name).toBe("default");
    expect(account.loginMethod).toBe("qr");
    expect(account.games).toEqual([440, 730]);
  });

  it("loads config in credentials mode when credentials and GAMES are set", () => {
    process.env.ACCOUNT_NAME = "testuser";
    process.env.PASSWORD = "testpass";
    process.env.GAMES = "440,CustomGame,730";
    process.env.PERSONA = "1";
    process.env.SHARED_SECRET = "secret123";

    const config = loadConfig();
    expect(config.accounts).toHaveLength(1);
    const account = config.accounts[0] as AccountConfig;
    expect(account.name).toBe("testuser");
    expect(account.accountName).toBe("testuser");
    expect(account.password).toBe("testpass");
    expect(account.sharedSecret).toBe("secret123");
    expect(account.persona).toBe(1);
    expect(account.loginMethod).toBe("credentials");
    expect(account.games).toEqual([440, "CustomGame", 730]);
  });

  it("throws error when ACCOUNT_NAME is provided without PASSWORD", () => {
    process.env.ACCOUNT_NAME = "testuser";
    process.env.GAMES = "440";

    expect(() => loadConfig()).toThrow(
      "Both ACCOUNT_NAME and PASSWORD are required, or omit both for QR login."
    );
  });
});

