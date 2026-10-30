import { describe, it, expect } from "vitest";
import { AccountSchema, ConfigSchema } from "../src/config.js";

describe("AccountSchema", () => {
  it("accepts valid credentials account", () => {
    const result = AccountSchema.parse({
      name: "main",
      accountName: "user",
      password: "pass",
      games: [440],
    });
    expect(result.enabled).toBe(true);
    expect(result.loginMethod).toBe("credentials");
  });

  it("accepts QR-only account without credentials", () => {
    const result = AccountSchema.parse({
      name: "alt",
      games: [730],
      loginMethod: "qr",
    });
    expect(result.accountName).toBeUndefined();
    expect(result.password).toBeUndefined();
  });

  it("rejects more than 32 games", () => {
    const games = Array.from({ length: 33 }, (_, i) => i + 1);
    expect(() => AccountSchema.parse({ name: "t", games })).toThrow();
  });

  it("rejects empty games list", () => {
    expect(() =>
      AccountSchema.parse({ name: "t", accountName: "u", password: "p", games: [] }),
    ).toThrow();
  });

  it("handles mixed app IDs and custom game names", () => {
    const result = AccountSchema.parse({
      name: "t",
      games: [440, "My Custom Game"],
    });
    expect(result.games).toEqual([440, "My Custom Game"]);
  });

  it("defaults enabled to true", () => {
    const result = AccountSchema.parse({ name: "t", games: [440] });
    expect(result.enabled).toBe(true);
  });

  it("rejects invalid persona values", () => {
    expect(() =>
      AccountSchema.parse({ name: "t", games: [440], persona: 99 }),
    ).toThrow();
  });
});

describe("ConfigSchema", () => {
  it("applies default settings", () => {
    const config = ConfigSchema.parse({
      accounts: [{ name: "t", games: [440] }],
    });
    expect(config.settings.logOnIntervalMs).toBe(600_000);
    expect(config.settings.refreshGamesIntervalMs).toBe(300_000);
    expect(config.settings.minRequestGapMs).toBe(60_000);
    expect(config.settings.qrLoginTimeoutMs).toBe(120_000);
    expect(config.settings.dataDirectory).toBe("data");
  });

  it("rejects empty accounts array", () => {
    expect(() => ConfigSchema.parse({ accounts: [] })).toThrow();
  });

  it("accepts multiple QR-only accounts with unique names", () => {
    const config = ConfigSchema.parse({
      accounts: [
        { name: "main", games: [440], loginMethod: "qr" },
        { name: "alt", games: [730], loginMethod: "qr" },
      ],
    });

    expect(config.accounts).toHaveLength(2);
    expect(config.accounts.map((account) => account.loginMethod)).toEqual(["qr", "qr"]);
  });

  it("rejects duplicate account names", () => {
    expect(() =>
      ConfigSchema.parse({
        accounts: [
          { name: "same", games: [440], loginMethod: "qr" },
          { name: "same", games: [730], loginMethod: "qr" },
        ],
      }),
    ).toThrow("Account names must be unique");
  });

  it("rejects duplicate Steam accountName across accounts", () => {
    expect(() =>
      ConfigSchema.parse({
        accounts: [
          { name: "main", accountName: "alden", password: "p1", games: [440] },
          { name: "alt", accountName: "ALDEN", password: "p2", games: [730] },
        ],
      }),
    ).toThrow(/is configured more than once/);
  });

  it("accepts custom settings", () => {
    const config = ConfigSchema.parse({
      accounts: [{ name: "t", games: [440] }],
      settings: { logOnIntervalMs: 120_000, qrLoginTimeoutMs: 30_000, dataDirectory: "custom" },
    });
    expect(config.settings.logOnIntervalMs).toBe(120_000);
    expect(config.settings.qrLoginTimeoutMs).toBe(30_000);
    expect(config.settings.dataDirectory).toBe("custom");
  });

  it("rejects a non-positive QR login timeout", () => {
    expect(() =>
      ConfigSchema.parse({
        accounts: [{ name: "t", games: [440] }],
        settings: { qrLoginTimeoutMs: 0 },
      }),
    ).toThrow();
  });
});
