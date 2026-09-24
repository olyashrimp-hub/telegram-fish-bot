import { createHash, timingSafeEqual } from "node:crypto";
import { logger } from "../lib/logger";

export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
};

export type TelegramMessage = {
  message_id: number;
  chat: { id: number; type?: string };
  from?: TelegramUser;
  text?: string;
  reply_to_message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramApiResponse<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
};

const TELEGRAM_POLL_TIMEOUT_SECONDS = 25;
const TELEGRAM_REQUEST_TIMEOUT_MS = (TELEGRAM_POLL_TIMEOUT_SECONDS + 10) * 1000;

function getTelegramToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram integration.");
  }

  return token;
}

export function getTelegramWebhookSecret(): string {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (configuredSecret) {
    return configuredSecret;
  }

  return createHash("sha256").update(getTelegramToken()).digest("hex");
}

export function isValidTelegramWebhookSecret(
  receivedSecret: string | undefined,
): boolean {
  if (!receivedSecret) {
    return false;
  }

  let expected: Buffer;
  try {
    expected = Buffer.from(getTelegramWebhookSecret());
  } catch {
    return false;
  }

  const received = Buffer.from(receivedSecret);

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export async function deleteTelegramWebhook(): Promise<void> {
  await callTelegramApi<boolean>(
    "deleteWebhook",
    { drop_pending_updates: false },
    20_000,
  );
  logger.info("Telegram webhook deleted; long polling is ready.");
}

export function startTelegramPolling(
  handleUpdate: (update: TelegramUpdate) => Promise<void>,
): void {
  if (!isTelegramPollingEnabled()) {
    logger.info("Telegram long polling is disabled for this environment.");
    return;
  }

  void runTelegramPolling(handleUpdate);
}

async function runTelegramPolling(
  handleUpdate: (update: TelegramUpdate) => Promise<void>,
): Promise<void> {
  let nextOffset: number | undefined;
  let retryDelayMs = 1_000;

  while (true) {
    try {
      await deleteTelegramWebhook();
      break;
    } catch (error) {
      logger.error(
        { err: error, retryDelayMs },
        "Could not delete Telegram webhook before polling; retrying",
      );
      await sleep(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
    }
  }

  retryDelayMs = 1_000;
  logger.info(
    { timeoutSeconds: TELEGRAM_POLL_TIMEOUT_SECONDS },
    "Telegram long polling started.",
  );

  while (true) {
    try {
      const updates = await getTelegramUpdates(nextOffset);
      retryDelayMs = 1_000;

      for (const update of updates) {
        try {
          await handleUpdate(update);
          nextOffset = update.update_id + 1;
        } catch (error) {
          logger.error(
            { err: error, updateId: update.update_id },
            "Could not process Telegram update; retrying the same update",
          );
          await sleep(1_000);
          break;
        }
      }
    } catch (error) {
      logger.error(
        { err: error, retryDelayMs },
        "Telegram long polling network error; reconnecting",
      );
      await sleep(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
    }
  }
}

async function getTelegramUpdates(
  offset: number | undefined,
): Promise<TelegramUpdate[]> {
  return callTelegramApi<TelegramUpdate[]>(
    "getUpdates",
    {
      ...(offset === undefined ? {} : { offset }),
      timeout: TELEGRAM_POLL_TIMEOUT_SECONDS,
      allowed_updates: ["message"],
    },
    TELEGRAM_REQUEST_TIMEOUT_MS,
  );
}

async function callTelegramApi<T>(
  method: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${getTelegramToken()}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    const result = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok || !result.ok || result.result === undefined) {
      throw new Error(
        `Telegram ${method} failed with status ${response.status}: ${
          result.description ?? "unknown error"
        }`,
      );
    }

    return result.result;
  } finally {
    clearTimeout(timeout);
  }
}

function isTelegramPollingEnabled(): boolean {
  const configured = process.env.TELEGRAM_POLLING_ENABLED;
  if (configured === "true") {
    return true;
  }
  if (configured === "false") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function parseFishCommand(text: string): number | null {
  const match = text.trim().match(/^(?:\/pay(?:@[a-zA-Z0-9_]+)?|подарить)\s+([0-9]+)$/iu);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function getTelegramDisplayName(user: TelegramUser): string {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return fullName || user.username || `Пользователь ${user.id}`;
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyToMessageId?: number,
): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${getTelegramToken()}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    logger.error({ status: response.status, body }, "Telegram sendMessage failed");
    throw new Error(`Telegram sendMessage failed with status ${response.status}.`);
  }
}