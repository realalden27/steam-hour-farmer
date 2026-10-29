import { readFileSync, existsSync } from "fs";
import { z } from "zod";
import dotenv from "dotenv";
import { log } from "./logger.js";

const MAX_SIMULTANEOUS_GAMES = 32;

export const AccountSchema = z.object({
  name: z.string().min(1),
  accountName: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  sharedSecret: z.string().optional(),
  games: z
    .array(z.union([z.number().int().positive(), z.string().min(1)]))
    .min(1, "At least one game is required")
    .max(MAX_SIMULTANEOUS_GAMES, `Steam allows max ${MAX_SIMULTANEOUS_GAMES} simultaneous games`),
  persona: z.number().int().min(0).max(7).default(1),
  enabled: z.boolean().default(true),
  loginMethod: z.enum(["credentials", "qr"]).default("credentials"),
});

export const ConfigSchema = z.object({
  accounts: z.array(AccountSchema).min(1, "At least one account is required"),
  settings: z
    .object({
      logOnIntervalMs: z.number().positive().default(600_000),
      refreshGamesIntervalMs: z.number().positive().default(300_000),
      minRequestGapMs: z.number().positive().default(60_000),
      dataDirectory: z.string().default("data"),
    })
    .default({}),
});

export type AccountConfig = z.infer<typeof AccountSchema>;
export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  dotenv.config();

  if (existsSync("config.json")) {
    log.info("Loading config from config.json");
    const raw = JSON.parse(readFileSync("config.json", "utf-8"));
    return ConfigSchema.parse(raw);
  }

  const { ACCOUNT_NAME, PASSWORD, GAMES, SHARED_SECRET, PERSONA } = process.env;

  if (!GAMES) throw new Error("No config.json and no GAMES env var. See README.");

  const rawPersona = PERSONA !== undefined ? parseInt(PERSONA, 10) : 1;
  const persona = Number.isNaN(rawPersona) ? 1 : rawPersona;

  if (!ACCOUNT_NAME && !PASSWORD) {
    log.info("No credentials found - will use QR code login");
    return ConfigSchema.parse({
      accounts: [
        {
          name: "default",
          games: parseGamesList(GAMES),
          persona,
          loginMethod: "qr",
        },
      ],
    });
  }

  if (!ACCOUNT_NAME || !PASSWORD) {
    throw new Error("Both ACCOUNT_NAME and PASSWORD are required, or omit both for QR login.");
  }

  return ConfigSchema.parse({
    accounts: [
      {
        name: ACCOUNT_NAME,
        accountName: ACCOUNT_NAME,
        password: PASSWORD,
        sharedSecret: SHARED_SECRET || undefined,
        games: parseGamesList(GAMES),
        persona,
        loginMethod: "credentials",
      },
    ],
  });
}

function parseGamesList(raw: string): (number | string)[] {
  return raw
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return null;
      const asNumber = parseInt(trimmed, 10);
      return Number.isNaN(asNumber) ? trimmed : asNumber;
    })
    .filter((g): g is number | string => g !== null);
}

