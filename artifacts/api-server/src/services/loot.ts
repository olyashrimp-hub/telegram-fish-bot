export type LootSuccess =
  | { ok: true; outcome: "piranha"; balance: number }
  | {
      ok: true;
      outcome: "common" | "great" | "super" | "jackpot";
      amount: number;
      balance: number;
    };

export type LootResult =
  | LootSuccess
  | { ok: false; reason: "cooldown"; nextClaimAt: Date }
  | { ok: false; reason: "insufficient-balance" };

export const LOOT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const LOOT_COST = 10;

export function resolveLootOutcome(
  balance: number,
  random: () => number = Math.random,
): LootSuccess {
  const roll = Math.floor(random() * 100);

  if (roll < 10) {
    return { ok: true, outcome: "piranha", balance: balance - LOOT_COST - 5 };
  }

  if (roll < 60) {
    const amount = randomInteger(15, 25, random);
    return {
      ok: true,
      outcome: "common",
      amount,
      balance: balance - LOOT_COST + amount,
    };
  }

  if (roll < 90) {
    const amount = randomInteger(26, 30, random);
    return {
      ok: true,
      outcome: "great",
      amount,
      balance: balance - LOOT_COST + amount,
    };
  }

  if (roll < 95) {
    const amount = randomInteger(31, 35, random);
    return {
      ok: true,
      outcome: "super",
      amount,
      balance: balance - LOOT_COST + amount,
    };
  }

  return { ok: true, outcome: "jackpot", amount: 40, balance: balance - LOOT_COST + 40 };
}

export function getLootBalanceChange(result: LootSuccess, currentBalance: number): number {
  return result.outcome === "piranha"
    ? -LOOT_COST - 5
    : result.balance - currentBalance;
}

export function getLootNextClaimAt(lastLootAt: Date): Date {
  return new Date(lastLootAt.getTime() + LOOT_COOLDOWN_MS);
}

export function isLootOnCooldown(lastLootAt: Date | null, now: Date): boolean {
  return lastLootAt !== null && now.getTime() < getLootNextClaimAt(lastLootAt).getTime();
}

export function formatRemainingTime(nextClaimAt: Date, now = new Date()): string {
  const totalSeconds = Math.max(
    0,
    Math.ceil((nextClaimAt.getTime() - now.getTime()) / 1000),
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function formatLootResponse(result: LootResult, now = new Date()): string {
  if (!result.ok) {
    return result.reason === "insufficient-balance"
      ? "❌ Сундук стоит 10 🐟! У вас недостаточно рыбок."
      : `⏳ Следующий сундук можно открыть через ${formatRemainingTime(result.nextClaimAt, now)}.`;
  }

  if (result.outcome === "piranha") {
    return `Упс, похоже сегодня не ваш день. Из сундука выпрыгивает пиранья, больно кусает вас. Вы теряете 5 рыб. Ваш баланс: ${result.balance} 🐟`;
  }

  if (result.outcome === "common") {
    return `📦 Вы открыли сундук и нашли ${result.amount} 🐟! Ваш баланс: ${result.balance} 🐟`;
  }

  if (result.outcome === "great") {
    return `📦 Отличная находка! В сундуке оказалось ${result.amount} 🐟! Ваш баланс: ${result.balance} 🐟`;
  }

  if (result.outcome === "super") {
    return `📦 Супер-удача! В сундуке оказалось ${result.amount} 🐟! Ваш баланс: ${result.balance} 🐟`;
  }

  return `🎉 СОКРОВИЩЕ! Вы нашли джекпот — 40 🐟! Ваш баланс: ${result.balance} 🐟`;
}

function randomInteger(
  min: number,
  max: number,
  random: () => number,
): number {
  return Math.floor(random() * (max - min + 1)) + min;
}