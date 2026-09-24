import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  fishTransfersTable,
  fishUsersTable,
  type FishUser,
} from "@workspace/db";

export type TransferFailure =
  | { kind: "negative-balance" }
  | { kind: "insufficient-balance"; balance: number }
  | { kind: "invalid-amount" };

export type TransferResult =
  | { ok: true; sender: FishUser; recipient: FishUser }
  | { ok: false; failure: TransferFailure };

export type DailyResult =
  | { ok: true; amount: number; balance: number }
  | { ok: false; nextClaimAt: Date };

export type LootResult =
  | { ok: true; outcome: "piranha"; balance: number }
  | {
      ok: true;
      outcome: "common" | "great" | "super" | "jackpot";
      amount: number;
      balance: number;
    }
  | { ok: false; reason: "cooldown"; nextClaimAt: Date }
  | { ok: false; reason: "insufficient-balance" };

const DAILY_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const LOOT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LOOT_COST = 10;

export async function claimDailyFish({
  telegramId,
  displayName,
  now = new Date(),
}: {
  telegramId: number;
  displayName: string;
  now?: Date;
}): Promise<DailyResult> {
  return db.transaction(async (tx) => {
    await ensureUser(tx, telegramId, displayName);

    const [user] = await tx
      .select()
      .from(fishUsersTable)
      .where(eq(fishUsersTable.telegramId, telegramId))
      .for("update");

    if (!user) {
      throw new Error("Fish user was not created before claiming the daily bonus.");
    }

    if (user.lastDailyAt) {
      const nextClaimAt = new Date(user.lastDailyAt.getTime() + DAILY_COOLDOWN_MS);
      if (now.getTime() < nextClaimAt.getTime()) {
        return { ok: false, nextClaimAt };
      }
    }

    const amount = Math.floor(Math.random() * 10) + 1;
    const balance = user.balance + amount;

    await tx
      .update(fishUsersTable)
      .set({
        balance: sql`${fishUsersTable.balance} + ${amount}`,
        lastDailyAt: now,
      })
      .where(eq(fishUsersTable.telegramId, telegramId));

    return { ok: true, amount, balance };
  });
}

export async function openLootChest({
  telegramId,
  displayName,
  now = new Date(),
}: {
  telegramId: number;
  displayName: string;
  now?: Date;
}): Promise<LootResult> {
  return db.transaction(async (tx) => {
    await ensureUser(tx, telegramId, displayName);

    const [user] = await tx
      .select()
      .from(fishUsersTable)
      .where(eq(fishUsersTable.telegramId, telegramId))
      .for("update");

    if (!user) {
      throw new Error("Fish user was not created before opening the loot chest.");
    }

    if (user.lastLootAt) {
      const nextClaimAt = new Date(user.lastLootAt.getTime() + LOOT_COOLDOWN_MS);
      if (now.getTime() < nextClaimAt.getTime()) {
        return { ok: false, reason: "cooldown", nextClaimAt };
      }
    }

    if (user.balance < LOOT_COST) {
      return { ok: false, reason: "insufficient-balance" };
    }

    const roll = Math.floor(Math.random() * 100);
    let outcome: LootResult;
    if (roll < 10) {
      outcome = { ok: true, outcome: "piranha", balance: user.balance - 15 };
    } else if (roll < 60) {
      const amount = randomInteger(15, 25);
      outcome = { ok: true, outcome: "common", amount, balance: user.balance - LOOT_COST + amount };
    } else if (roll < 90) {
      const amount = randomInteger(26, 30);
      outcome = { ok: true, outcome: "great", amount, balance: user.balance - LOOT_COST + amount };
    } else if (roll < 95) {
      const amount = randomInteger(31, 35);
      outcome = { ok: true, outcome: "super", amount, balance: user.balance - LOOT_COST + amount };
    } else {
      outcome = { ok: true, outcome: "jackpot", amount: 40, balance: user.balance - LOOT_COST + 40 };
    }

    const balanceChange =
      outcome.outcome === "piranha" ? -15 : outcome.balance - user.balance;
    await tx
      .update(fishUsersTable)
      .set({
        balance: sql`${fishUsersTable.balance} + ${balanceChange}`,
        lastLootAt: now,
      })
      .where(eq(fishUsersTable.telegramId, telegramId));

    return outcome;
  });
}

export async function transferFish({
  senderTelegramId,
  senderDisplayName,
  recipientTelegramId,
  recipientDisplayName,
  amount,
}: {
  senderTelegramId: number;
  senderDisplayName: string;
  recipientTelegramId: number;
  recipientDisplayName: string;
  amount: number;
}): Promise<TransferResult> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, failure: { kind: "invalid-amount" } };
  }

  return db.transaction(async (tx) => {
    await ensureUser(tx, senderTelegramId, senderDisplayName);
    await ensureUser(tx, recipientTelegramId, recipientDisplayName);

    const userIds = [...new Set([senderTelegramId, recipientTelegramId])];
    const users = await tx
      .select()
      .from(fishUsersTable)
      .where(inArray(fishUsersTable.telegramId, userIds))
      .orderBy(asc(fishUsersTable.telegramId))
      .for("update");

    const sender = users.find((user) => user.telegramId === senderTelegramId);
    const recipient = users.find((user) => user.telegramId === recipientTelegramId);

    if (!sender || !recipient) {
      throw new Error("Fish users were not created before the transfer.");
    }

    if (sender.balance < 0) {
      return { ok: false, failure: { kind: "negative-balance" } };
    }

    if (sender.balance < amount) {
      return {
        ok: false,
        failure: { kind: "insufficient-balance", balance: sender.balance },
      };
    }

    await tx
      .update(fishUsersTable)
      .set({ balance: sql`${fishUsersTable.balance} - ${amount}` })
      .where(eq(fishUsersTable.telegramId, senderTelegramId));

    await tx
      .update(fishUsersTable)
      .set({ balance: sql`${fishUsersTable.balance} + ${amount}` })
      .where(eq(fishUsersTable.telegramId, recipientTelegramId));

    await tx.insert(fishTransfersTable).values({
      senderTelegramId,
      recipientTelegramId,
      amount,
    });

    return {
      ok: true,
      sender: { ...sender, balance: sender.balance - amount },
      recipient: { ...recipient, balance: recipient.balance + amount },
    };
  });
}

async function ensureUser(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  telegramId: number,
  displayName: string,
) {
  await tx
    .insert(fishUsersTable)
    .values({ telegramId, displayName })
    .onConflictDoNothing({ target: fishUsersTable.telegramId });

  await tx
    .update(fishUsersTable)
    .set({ displayName })
    .where(eq(fishUsersTable.telegramId, telegramId));
}

function randomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}