import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  activitySettlementsTable,
  chatActivityTable,
  db,
  fishUsersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendTelegramMessage } from "./telegram";

const UTC_PLUS_7_TIME_ZONE = "Asia/Ho_Chi_Minh";
const SETTLEMENT_HOUR = 23;
const SETTLEMENT_MINUTE = 59;
const SCHEDULER_INTERVAL_MS = 30_000;
const REWARDS = [5, 3, 1] as const;

type ActivityWinner = {
  displayName: string;
  telegramId: number;
  reward: number;
};

export async function recordChatMessage({
  chatId,
  telegramId,
  displayName,
  messageDate = new Date(),
}: {
  chatId: number;
  telegramId: number;
  displayName: string;
  messageDate?: Date;
}): Promise<void> {
  const activityDate = getActivityDate(messageDate);

  await db.transaction(async (tx) => {
    await tx
      .insert(fishUsersTable)
      .values({ telegramId, displayName })
      .onConflictDoNothing({ target: fishUsersTable.telegramId });

    await tx
      .update(fishUsersTable)
      .set({ displayName })
      .where(eq(fishUsersTable.telegramId, telegramId));

    await tx
      .insert(chatActivityTable)
      .values({
        chatId,
        telegramId,
        displayName,
        activityDate,
        messageCount: 1,
      })
      .onConflictDoUpdate({
        target: [
          chatActivityTable.chatId,
          chatActivityTable.telegramId,
          chatActivityTable.activityDate,
        ],
        set: {
          displayName,
          messageCount: sql`${chatActivityTable.messageCount} + 1`,
        },
      });
  });
}

export function startActivityScheduler(): void {
  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    try {
      await settleDueActivity();
    } catch (error) {
      logger.error({ err: error }, "Activity settlement failed");
    } finally {
      isRunning = false;
    }
  };

  void run();
  setInterval(() => void run(), SCHEDULER_INTERVAL_MS).unref();
}

async function settleDueActivity(): Promise<void> {
  const now = new Date();
  const local = getLocalClock(now);
  const activityDate =
    local.minutesSinceMidnight >= SETTLEMENT_HOUR * 60 + SETTLEMENT_MINUTE
      ? local.date
      : getPreviousDate(local.date);

  const chats = await db
    .select({ chatId: chatActivityTable.chatId })
    .from(chatActivityTable)
    .where(eq(chatActivityTable.activityDate, activityDate))
    .groupBy(chatActivityTable.chatId);

  for (const { chatId } of chats) {
    const winners = await settleChatActivity(chatId, activityDate);
    if (!winners) {
      continue;
    }

    try {
      await sendTelegramMessage(chatId, formatActivitySummary(winners));
    } catch (error) {
      logger.error({ err: error, chatId, activityDate }, "Could not send activity summary");
    }
  }
}

async function settleChatActivity(
  chatId: number,
  activityDate: string,
): Promise<ActivityWinner[] | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(chatActivityTable)
      .where(
        and(
          eq(chatActivityTable.chatId, chatId),
          eq(chatActivityTable.activityDate, activityDate),
        ),
      )
      .orderBy(desc(chatActivityTable.messageCount), asc(chatActivityTable.telegramId))
      .for("update");

    if (rows.length === 0) {
      return null;
    }

    const [settlement] = await tx
      .insert(activitySettlementsTable)
      .values({ chatId, activityDate })
      .onConflictDoNothing({
        target: [
          activitySettlementsTable.chatId,
          activitySettlementsTable.activityDate,
        ],
      })
      .returning({ id: activitySettlementsTable.id });

    if (!settlement) {
      return null;
    }

    const winners = rows.slice(0, 3).map((row, index) => ({
      displayName: row.displayName,
      telegramId: row.telegramId,
      reward: REWARDS[index]!,
    }));

    for (const winner of winners) {
      await tx
        .update(fishUsersTable)
        .set({ balance: sql`${fishUsersTable.balance} + ${winner.reward}` })
        .where(eq(fishUsersTable.telegramId, winner.telegramId));
    }

    await tx
      .delete(chatActivityTable)
      .where(
        and(
          eq(chatActivityTable.chatId, chatId),
          eq(chatActivityTable.activityDate, activityDate),
        ),
      );

    return winners;
  });
}

function formatActivitySummary(winners: ActivityWinner[]): string {
  const medals = ["🥇", "🥈", "🥉"];
  const lines = winners.map(
    (winner, index) =>
      `${medals[index]} ${index + 1} место: ${winner.displayName} (+${winner.reward} 🐟)`,
  );

  return `🏆 Итоги активности за день!\n\n${lines.join("\n")}\n\nНаграды автоматически зачислены! Счётчик обнулён, всем удачи завтра!`;
}

function getActivityDate(date: Date): string {
  return getLocalClock(date).date;
}

function getLocalClock(date: Date): {
  date: string;
  minutesSinceMidnight: number;
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
    minutesSinceMidnight: Number(values.hour) * 60 + Number(values.minute),
  };
}

function getPreviousDate(activityDate: string): string {
  const [year, month, day] = activityDate.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return previous.toISOString().slice(0, 10);
}