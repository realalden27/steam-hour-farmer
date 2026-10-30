import pino from "pino";
import pinoPretty from "pino-pretty";

const CORE_LOG_FIELDS = new Set(["account", "level", "time", "pid", "hostname", "msg", "v"]);

function formatValue(value: unknown, depth = 0): string {
  if (typeof value === "string") {
    return /^[\w./:-]+$/.test(value) ? value : JSON.stringify(value);
  }
  if (value === null || typeof value !== "object") {
    return String(value);
  }
  if (depth >= 3) {
    return "[Object]";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatValue(item, depth + 1)).join(", ")}]`;
  }

  const fields = Object.entries(value)
    .map(([key, fieldValue]) => `${key}=${formatValue(fieldValue, depth + 1)}`);
  return `{${fields.join(", ")}}`;
}

function formatLogMessage(log: Record<string, unknown>, messageKey: string): string {
  const message = typeof log[messageKey] === "string" ? log[messageKey] : "";
  const account = typeof log.account === "string" ? `[${log.account}] ` : "";
  const fields = Object.entries(log)
    .filter(([key]) => !CORE_LOG_FIELDS.has(key))
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  const details = fields.length > 0 ? ` ${fields.join(" ")}` : "";

  return `${account}${message}${details}`;
}

const prettyStream = pinoPretty({
  colorize: true,
  translateTime: "HH:MM:ss",
  hideObject: true,
  messageFormat: formatLogMessage,
});

export const log = pino({ level: process.env.LOG_LEVEL ?? "info" }, prettyStream);
