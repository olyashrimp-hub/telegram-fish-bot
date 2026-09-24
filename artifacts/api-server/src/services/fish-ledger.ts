import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  db,
  fishLotsTable,
  fishUsersTable,
  type FishUser,
} from "@workspace/db";

export type FishTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const FISH_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export async function ensureFishUserRecord(
  tx: FishTransaction,
  telegramId: number,
  displayName: string,
): Promise<void> {
  await tx
    .insert(fishUsersTable)
    .values({ telegramId, displayName })
    .onConflictDoNothing({ target: fishUsersTable.telegramId });

  await tx
    .update(fishUsersTable)
    .set({ displayName })
    .where(eq(fishUsersTable.telegramId, telegramId));
}

export async function getFishUserForUpdate(
  tx: FishTransaction,
  telegramId: number,
  displayName?: string,
): Promise<FishUser> {
  if (displayName) {
    await ensureFishUserRecord(tx, telegramId, displayName);
  }

  const [user] = await tx
    .select()
    .from(fishUsersTable)
    .where(eq(fishUsersTable.telegramId, telegramId))
    .for("update");

  if (!user) {
    throw new Error(`Fish user ${telegramId} does not exist.`);
  }

  await backfillLegacyLot(tx, user);
  return user;
}

export async function getFishUsersForUpdate(
  tx: FishTransaction,
  users: Array<{ telegramId: number; displayName: string }>,
): Promise<FishUser[]> {
  for (const user of users) {
    await ensureFishUserRecord(tx, user.telegramId, user.displayName);
  }

  const ids = users.map((user) => user.telegramId);
  const lockedUsers = await tx
    .select()
    .from(fishUsersTable)
    .where(inArray(fishUsersTable.telegramId, ids))
    .orderBy(asc(fishUsersTable.telegramId))
    .for("update");

  for (const user of lockedUsers) {
    await backfillLegacyLot(tx, user);
  }

  return lockedUsers;
}

export async function addFishLotForLockedUser(
  tx: FishTransaction,
  user: FishUser,
  amount: number,
  source: string,
  acquiredAt: Date,
): Promise<number> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Fish lot amount must be a positive integer.");
  }

  const protectedUntil =
    user.fridgeExpiresAt && user.fridgeExpiresAt.getTime() > acquiredAt.getTime()
      ? user.fridgeExpiresAt
      : null;

  await tx.insert(fishLotsTable).values({
    telegramId: user.telegramId,
    amount,
    remainingAmount: amount,
    source,
    acquiredAt,
    protectedUntil,
  });

  const nextBalance = user.balance + amount;
  await tx
    .update(fishUsersTable)
    .set({ balance: nextBalance })
    .where(eq(fishUsersTable.telegramId, user.telegramId));

  user.balance = nextBalance;
  return nextBalance;
}

export async function spendFishLotsForLockedUser(
  tx: FishTransaction,
  user: FishUser,
  amount: number,
  allowNegative = false,
): Promise<number> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Fish spending amount must be a positive integer.");
  }

  const lots = await tx
    .select()
    .from(fishLotsTable)
    .where(
      and(
        eq(fishLotsTable.telegramId, user.telegramId),
        gt(fishLotsTable.remainingAmount, 0),
      ),
    )
    .orderBy(asc(fishLotsTable.acquiredAt), asc(fishLotsTable.id))
    .for("update");

  const available = lots.reduce((total, lot) => total + lot.remainingAmount, 0);
  if (!allowNegative && available < amount) {
    throw new Error("Insufficient fish balance.");
  }

  let remainingToSpend = amount;
  for (const lot of lots) {
    if (remainingToSpend <= 0) {
      break;
    }

    const spentFromLot = Math.min(lot.remainingAmount, remainingToSpend);
    await tx
      .update(fishLotsTable)
      .set({ remainingAmount: lot.remainingAmount - spentFromLot })
      .where(eq(fishLotsTable.id, lot.id));
    remainingToSpend -= spentFromLot;
  }

  const nextBalance = user.balance - amount;
  await tx
    .update(fishUsersTable)
    .set({ balance: nextBalance })
    .where(eq(fishUsersTable.telegramId, user.telegramId));

  user.balance = nextBalance;
  return nextBalance;
}

export async function protectExistingFishLots(
  tx: FishTransaction,
  telegramId: number,
  protectedUntil: Date,
): Promise<void> {
  await tx
    .update(fishLotsTable)
    .set({ protectedUntil })
    .where(
      and(
        eq(fishLotsTable.telegramId, telegramId),
        gt(fishLotsTable.remainingAmount, 0),
        sql`(${fishLotsTable.protectedUntil} IS NULL OR ${fishLotsTable.protectedUntil} < ${protectedUntil})`,
      ),
    );
}

async function backfillLegacyLot(
  tx: FishTransaction,
  user: FishUser,
): Promise<void> {
  const lots = await tx
    .select({ remainingAmount: fishLotsTable.remainingAmount })
    .from(fishLotsTable)
    .where(
      and(
        eq(fishLotsTable.telegramId, user.telegramId),
        gt(fishLotsTable.remainingAmount, 0),
      ),
    );
  const trackedBalance = lots.reduce(
    (total, lot) => total + lot.remainingAmount,
    0,
  );

  if (user.balance > trackedBalance) {
    const legacyAmount = user.balance - trackedBalance;
    await tx.insert(fishLotsTable).values({
      telegramId: user.telegramId,
      amount: legacyAmount,
      remainingAmount: legacyAmount,
      source: "legacy_balance",
      acquiredAt: user.createdAt,
      protectedUntil: user.fridgeExpiresAt,
    });
  }
}