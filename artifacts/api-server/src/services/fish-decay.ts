import { and, asc, eq, gt, inArray } from "drizzle-orm";
import {
  db,
  fishLotsTable,
  fishUserChatsTable,
  fishUsersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { FISH_EXPIRY_MS, getFishUserForUpdate } from "./fish-ledger";
import { sendTelegramMessage } from "./telegram";

const UTC_PLUS_7_TIME_ZONE = "Asia/Ho_Chi_Minh";
const DECAY_INTERVAL_MS = 30_000;

export function startFishDecayScheduler(): void {
  let lastRunDate: string | null = null;
  let isRunning = false;

  const run = async (force = false) => {
    if (isRunning) {
      return;
    }

    const now = new Date();
    const local = getLocalClock(now);
    if (!force && (local.hour !== 0 || local.minute > 1 || lastRunDate === local.date)) {
      return;
    }

    isRunning = true;
    lastRunDate = local.date;
    try {
      await expireFish(now);
    } catch (error) {
      logger.error({ err: error }, "Fish decay job failed");
    } finally {
      isRunning = false;
    }
  };

  void run(true);
  setInterval(() => void run(), DECAY_INTERVAL_MS).unref();
}

async function expireFish(now: Date): Promise<void> {
  const users = await db
    .select({ telegramId: fishUsersTable.telegramId })
    .from(fishUsersTable)
    .where(gt(fishUsersTable.balance, 0));

  for (const { telegramId } of users) {
    const result = await expireUserFish(telegramId, now);
    if (!result || result.expiredAmount <= 0) {
      continue;
    }

    const chats = await db
      .select({ chatId: fishUserChatsTable.chatId })
      .from(fishUserChatsTable)
      .where(
        and(
          eq(fishUserChatsTable.telegramId, telegramId),
          inArray(fishUserChatsTable.chatType, ["group", "supergroup"]),
        ),
      );

    const sentTo = new Set<number>();
    for (const { chatId } of chats) {
      if (sentTo.has(chatId)) {
        continue;
      }
      sentTo.add(chatId);

      try {
        await sendTelegramMessage(
          chatId,
          `🐟 ${result.displayName}, у вас стухло ${result.expiredAmount} рыб, так как вы не положили их в холодильник!`,
        );
      } catch (error) {
        logger.error({ err: error, chatId, telegramId }, "Could not send fish decay notification");
      }
    }
  }
}

async function expireUserFish(
  telegramId: number,
  now: Date,
): Promise<{ displayName: string; expiredAmount: number } | null> {
  return db.transaction(async (tx) => {
    const user = await getFishUserForUpdate(tx, telegramId);
    if (!user || (user.fridgeExpiresAt && user.fridgeExpiresAt.getTime() > now.getTime())) {
      return null;
    }

    const lots = await tx
      .select()
      .from(fishLotsTable)
      .where(
        and(
          eq(fishLotsTable.telegramId, telegramId),
          gt(fishLotsTable.remainingAmount, 0),
        ),
      )
      .orderBy(asc(fishLotsTable.acquiredAt), asc(fishLotsTable.id))
      .for("update");

    const expiredLots = lots.filter((lot) => {
      const naturalExpiry = lot.acquiredAt.getTime() + FISH_EXPIRY_MS;
      const protectedExpiry = lot.protectedUntil?.getTime() ?? 0;
      return Math.max(naturalExpiry, protectedExpiry) <= now.getTime();
    });
    const expiredAmount = expiredLots.reduce(
      (total, lot) => total + lot.remainingAmount,
      0,
    );

    if (expiredAmount <= 0) {
      return null;
    }

    for (const lot of expiredLots) {
      await tx
        .update(fishLotsTable)
        .set({ remainingAmount: 0 })
        .where(eq(fishLotsTable.id, lot.id));
    }

    await tx
      .update(fishUsersTable)
      .set({ balance: user.balance - expiredAmount })
      .where(eq(fishUsersTable.telegramId, telegramId));

    return { displayName: user.displayName, expiredAmount };
  });
}

function getLocalClock(date: Date): {
  date: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: UTC_PLUS_7_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}