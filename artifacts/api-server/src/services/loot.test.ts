import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  formatLootResponse,
  formatRemainingTime,
  getLootBalanceChange,
  getLootNextClaimAt,
  isLootOnCooldown,
  LOOT_COOLDOWN_MS,
  resolveLootOutcome,
  type LootSuccess,
} from "./loot.ts";

const balance = 100;

function randomSequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1)!;
}

describe("loot probabilities", () => {
  it("uses exactly 10% / 50% / 30% / 5% / 5% probability bands", () => {
    const counts = {
      piranha: 0,
      common: 0,
      great: 0,
      super: 0,
      jackpot: 0,
    };

    for (let roll = 0; roll < 100; roll += 1) {
      const result = resolveLootOutcome(balance, () => roll / 100);
      counts[result.outcome] += 1;
    }

    assert.deepEqual(counts, {
      piranha: 10,
      common: 50,
      great: 30,
      super: 5,
      jackpot: 5,
    });
  });
});

describe("loot rewards and balance changes", () => {
  it("returns piranha with a 10-fish cost plus a 5-fish penalty", () => {
    const result = resolveLootOutcome(balance, randomSequence(0));

    assert.deepEqual(result, { ok: true, outcome: "piranha", balance: 85 });
    assert.equal(getLootBalanceChange(result, balance), -15);
    assert.match(
      formatLootResponse(result),
      /Вы теряете 5 рыб\. Ваш баланс: 85 🐟$/,
    );
  });

  it("keeps common rewards in the 15–25 range", () => {
    const minimum = resolveLootOutcome(balance, randomSequence(0.1, 0));
    const maximum = resolveLootOutcome(balance, randomSequence(0.5999, 0.9999));

    assert.equal(minimum.outcome, "common");
    assert.equal(minimum.amount, 15);
    assert.equal(minimum.balance, 105);
    assert.equal(maximum.outcome, "common");
    assert.equal(maximum.amount, 25);
    assert.equal(maximum.balance, 115);
  });

  it("keeps great rewards in the 26–30 range", () => {
    const minimum = resolveLootOutcome(balance, randomSequence(0.6, 0));
    const maximum = resolveLootOutcome(balance, randomSequence(0.8999, 0.9999));

    assert.equal(minimum.outcome, "great");
    assert.equal(minimum.amount, 26);
    assert.equal(maximum.outcome, "great");
    assert.equal(maximum.amount, 30);
    assert.equal(minimum.balance, 116);
    assert.equal(maximum.balance, 120);
  });

  it("keeps super rewards in the 31–35 range", () => {
    const minimum = resolveLootOutcome(balance, randomSequence(0.9, 0));
    const maximum = resolveLootOutcome(balance, randomSequence(0.9499, 0.9999));

    assert.equal(minimum.outcome, "super");
    assert.equal(minimum.amount, 31);
    assert.equal(maximum.outcome, "super");
    assert.equal(maximum.amount, 35);
    assert.equal(minimum.balance, 121);
    assert.equal(maximum.balance, 125);
  });

  it("returns a fixed 40-fish jackpot and updates the balance", () => {
    const result = resolveLootOutcome(balance, randomSequence(0.95));

    assert.deepEqual(result, {
      ok: true,
      outcome: "jackpot",
      amount: 40,
      balance: 130,
    });
    assert.equal(getLootBalanceChange(result, balance), 30);
    assert.equal(
      formatLootResponse(result),
      "🎉 СОКРОВИЩЕ! Вы нашли джекпот — 40 🐟! Ваш баланс: 130 🐟",
    );
  });
});

describe("loot cooldown and response timer", () => {
  const openedAt = new Date("2026-09-24T00:00:00.000Z");

  it("blocks opening before 24 hours and allows it at the boundary", () => {
    const nextClaimAt = getLootNextClaimAt(openedAt);

    assert.equal(nextClaimAt.getTime() - openedAt.getTime(), LOOT_COOLDOWN_MS);
    assert.equal(
      isLootOnCooldown(openedAt, new Date("2026-09-24T23:59:59.999Z")),
      true,
    );
    assert.equal(isLootOnCooldown(openedAt, nextClaimAt), false);
  });

  it("formats remaining cooldown as HH:MM:SS", () => {
    const nextClaimAt = getLootNextClaimAt(openedAt);
    const now = new Date("2026-09-24T12:34:56.000Z");

    assert.equal(formatRemainingTime(nextClaimAt, now), "11:25:04");
    assert.equal(formatRemainingTime(nextClaimAt, nextClaimAt), "00:00:00");
    assert.equal(
      formatLootResponse(
        { ok: false, reason: "cooldown", nextClaimAt },
        now,
      ),
      "⏳ Следующий сундук можно открыть через 11:25:04.",
    );
  });

  it("formats every chest result with its updated balance", () => {
    const results: Array<[LootSuccess, string]> = [
      [
        { ok: true, outcome: "piranha", balance: 85 },
        "Упс, похоже сегодня не ваш день. Из сундука выпрыгивает пиранья, больно кусает вас. Вы теряете 5 рыб. Ваш баланс: 85 🐟",
      ],
      [
        { ok: true, outcome: "common", amount: 20, balance: 110 },
        "📦 Вы открыли сундук и нашли 20 🐟! Ваш баланс: 110 🐟",
      ],
      [
        { ok: true, outcome: "great", amount: 28, balance: 118 },
        "📦 Отличная находка! В сундуке оказалось 28 🐟! Ваш баланс: 118 🐟",
      ],
      [
        { ok: true, outcome: "super", amount: 33, balance: 123 },
        "📦 Супер-удача! В сундуке оказалось 33 🐟! Ваш баланс: 123 🐟",
      ],
      [
        { ok: true, outcome: "jackpot", amount: 40, balance: 130 },
        "🎉 СОКРОВИЩЕ! Вы нашли джекпот — 40 🐟! Ваш баланс: 130 🐟",
      ],
    ];

    for (const [result, expectedText] of results) {
      assert.equal(formatLootResponse(result), expectedText);
    }

    assert.equal(
      formatLootResponse({ ok: false, reason: "insufficient-balance" }),
      "❌ Сундук стоит 10 🐟! У вас недостаточно рыбок.",
    );
  });
});