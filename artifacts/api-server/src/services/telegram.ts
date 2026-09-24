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

export async function registerTelegramWebhook(webhookUrl: string): Promise<void> {
  const parsedUrl = new URL(webhookUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("TELEGRAM_WEBHOOK_URL must use HTTPS.");
  }

  await callTelegramApi<boolean>(
    "setWebhook",
    {
      url: parsedUrl.toString(),
      secret_token: getTelegramWebhookSecret(),
      allowed_updates: ["message"],
    },
    20_000,
  );
  logger.info({ webhookUrl: parsedUrl.toString() }, "Telegram webhook registered.");
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