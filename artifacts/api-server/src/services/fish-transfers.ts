import { asc, eq, inArray } from "drizzle-orm";
import { db, fishUsersTable, type FishUser } from "@workspace/db";
import {
  FISH_EXPIRY_MS,
  addFishLotForLockedUser,
  getFishUserForUpdate,
  getFishUsersForUpdate,
  protectExistingFishLots,
  spendFishLotsForLockedUser,
  type FishTransaction,
} from "./fish-ledger";
import {
  getLootNextClaimAt,
  isLootOnCooldown,
  LOOT_COST,
  resolveLootOutcome,
  type LootResult,
} from "./loot";

export const MAIN_ADMIN_TELEGRAM_ID = 5145751097;

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

export type FridgePurchaseResult =
  | { ok: true; balance: number; expiresAt: Date }
  | { ok: false };

export type FishProfile = {
  balance: number;
  fridgeExpiresAt: Date | null;
  lastDailyAt: Date | null;
  lastLootAt: Date | null;
};

export type DeductionResult =
  | { ok: true; balance: number }
  | { ok: false; reason: "fridge-protected" | "not-authorized" | "insufficient-balance" };

const DAILY_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const FRIDGE_COST = 150;

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
    const user = await getFishUserForUpdate(tx, telegramId, displayName);

    if (user.lastDailyAt) {
      const nextClaimAt = new Date(user.lastDailyAt.getTime() + DAILY_COOLDOWN_MS);
      if (now.getTime() < nextClaimAt.getTime()) {
        return { ok: false, nextClaimAt };
      }
    }

    const amount = randomInteger(1, 10);
    const balance = await addFishLotForLockedUser(
      tx,
      user,
      amount,
      "daily",
      now,
    );
    await tx
      .update(fishUsersTable)
      .set({ lastDailyAt: now })
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
    const user = await getFishUserForUpdate(tx, telegramId, displayName);

    if (user.lastLootAt) {
      if (isLootOnCooldown(user.lastLootAt, now)) {
        const nextClaimAt = getLootNextClaimAt(user.lastLootAt);
        return { ok: false, reason: "cooldown", nextClaimAt };
      }
    }

    if (user.balance < LOOT_COST) {
      return { ok: false, reason: "insufficient-balance" };
    }

    const outcome = resolveLootOutcome(user.balance);
    if (outcome.outcome === "piranha") {
      await spendFishLotsForLockedUser(tx, user, 15, true);
    } else {
      await spendFishLotsForLockedUser(tx, user, LOOT_COST);
      await addFishLotForLockedUser(tx, user, outcome.amount, "loot", now);
    }

    await tx
      .update(fishUsersTable)
      .set({ lastLootAt: now })
      .where(eq(fishUsersTable.telegramId, telegramId));

    return { ...outcome, balance: user.balance };
  });
}

export async function transferFish({
  senderTelegramId,
  senderDisplayName,
  recipientTelegramId,
  recipientDisplayName,
  amount,
  now = new Date(),
}: {
  senderTelegramId: number;
  senderDisplayName: string;
  recipientTelegramId: number;
  recipientDisplayName: string;
  amount: number;
  now?: Date;
}): Promise<TransferResult> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, failure: { kind: "invalid-amount" } };
  }

  return db.transaction(async (tx) => {
    const users = await getFishUsersForUpdate(tx, [
      { telegramId: senderTelegramId, displayName: senderDisplayName },
      { telegramId: recipientTelegramId, displayName: recipientDisplayName },
    ]);
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

    await spendFishLotsForLockedUser(tx, sender, amount);
    await addFishLotForLockedUser(tx, recipient, amount, "transfer", now);

    return { ok: true, sender, recipient };
  });
}

export async function buyFridge({
  telegramId,
  displayName,
  now = new Date(),
}: {
  telegramId: number;
  displayName: string;
  now?: Date;
}): Promise<FridgePurchaseResult> {
  return db.transaction(async (tx) => {
    const user = await getFishUserForUpdate(tx, telegramId, displayName);
    if (user.balance < FRIDGE_COST) {
      return { ok: false };
    }

    const balance = await spendFishLotsForLockedUser(tx, user, FRIDGE_COST);
    const expiresAt = new Date(now.getTime() + FISH_EXPIRY_MS);

    await tx
      .update(fishUsersTable)
      .set({ fridgeExpiresAt: expiresAt })
      .where(eq(fishUsersTable.telegramId, telegramId));
    await protectExistingFishLots(tx, telegramId, expiresAt);

    return { ok: true, balance, expiresAt };
  });
}

export async function getFishProfile({
  telegramId,
  displayName,
}: {
  telegramId: number;
  displayName: string;
}): Promise<FishProfile> {
  return db.transaction(async (tx) => {
    const user = await getFishUserForUpdate(tx, telegramId, displayName);
    return {
      balance: user.balance,
      fridgeExpiresAt: user.fridgeExpiresAt,
      lastDailyAt: user.lastDailyAt,
      lastLootAt: user.lastLootAt,
    };
  });
}

export async function deductFish({
  actorTelegramId,
  targetTelegramId,
  targetDisplayName,
  amount,
  now = new Date(),
}: {
  actorTelegramId: number;
  targetTelegramId: number;
  targetDisplayName: string;
  amount: number;
  now?: Date;
}): Promise<DeductionResult> {
  return db.transaction(async (tx) => {
    const user = await getFishUserForUpdate(tx, targetTelegramId, targetDisplayName);
    const fridgeActive =
      user.fridgeExpiresAt && user.fridgeExpiresAt.getTime() > now.getTime();

    if (fridgeActive && actorTelegramId !== MAIN_ADMIN_TELEGRAM_ID) {
      return { ok: false, reason: "fridge-protected" };
    }
    if (actorTelegramId !== MAIN_ADMIN_TELEGRAM_ID) {
      return { ok: false, reason: "not-authorized" };
    }
    if (user.balance < amount) {
      return { ok: false, reason: "insufficient-balance" };
    }

    const balance = await spendFishLotsForLockedUser(tx, user, amount);
    return { ok: true, balance };
  });
}

export async function lockFishUsers(
  tx: FishTransaction,
  ids: number[],
): Promise<FishUser[]> {
  return tx
    .select()
    .from(fishUsersTable)
    .where(inArray(fishUsersTable.telegramId, ids))
    .orderBy(asc(fishUsersTable.telegramId))
    .for("update");
}

export { FISH_EXPIRY_MS };

function randomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}