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
  chat: { id: number };
  from?: TelegramUser;
  text?: string;
  reply_to_message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
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

  const response = await fetch(
    `https://api.telegram.org/bot${getTelegramToken()}/setWebhook`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: parsedUrl.toString(),
        secret_token: getTelegramWebhookSecret(),
        allowed_updates: ["message"],
      }),
    },
  );

  const result = (await response.json()) as {
    ok?: boolean;
    description?: string;
  };
  if (!response.ok || !result.ok) {
    logger.error(
      { status: response.status, description: result.description },
      "Telegram setWebhook failed",
    );
    throw new Error(
      `Telegram setWebhook failed with status ${response.status}.`,
    );
  }

  logger.info(
    { webhookUrl: parsedUrl.toString() },
    "Telegram webhook registered",
  );
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