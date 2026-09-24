import { Router, type IRouter } from "express";
import {
  getTelegramDisplayName,
  isValidTelegramWebhookSecret,
  parseFishCommand,
  sendTelegramMessage,
  type TelegramUpdate,
} from "../services/telegram";
import {
  claimDailyFish,
  buyFridge,
  deductFish,
  getFishProfile,
  openLootChest,
  transferFish,
} from "../services/fish-transfers";

import { formatLootResponse } from "../services/loot";
import { recordChatMessage } from "../services/activity";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/telegram/webhook", async (req, res) => {
  const secret = req.header("x-telegram-bot-api-secret-token");
  if (!isValidTelegramWebhookSecret(secret)) {
    res.status(401).json({ ok: false });
    return;
  }

  try {
    await handleTelegramUpdate(req.body as TelegramUpdate);
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Could not process Telegram update");
    res.status(500).json({ ok: false });
  }
});

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update?.message;
  const text = message?.text;

  if (!message || !message.from) {
    return;
  }

  if (!message.from.is_bot) {
    await recordChatMessage({
      chatId: message.chat.id,
      chatType: message.chat.type ?? "unknown",
      telegramId: message.from.id,
      displayName: getTelegramDisplayName(message.from),
    });
  }

  if (!text) {
    return;
  }

  const isBalanceCommand =
    /^(?:\/balance(?:@[a-zA-Z0-9_]+)?|баланс|мои рыбки|профиль)$/iu.test(
      text.trim(),
    );
  if (isBalanceCommand) {
    const profileUser = message.reply_to_message?.from ?? message.from;
    const profile = await getFishProfile({
      telegramId: profileUser.id,
      displayName: getTelegramDisplayName(profileUser),
    });
    const now = new Date();
    const responseText = [
      `🎣 Профиль ${getTelegramDisplayName(profileUser)}:`,
      `🐟 Баланс: ${profile.balance} рыб`,
      formatFridgeStatus(profile.fridgeExpiresAt, now),
      formatBonusStatus("/daily", profile.lastDailyAt, 3 * 24 * 60 * 60 * 1000, now),
      formatBonusStatus("/loot", profile.lastLootAt, 24 * 60 * 60 * 1000, now),
    ].join("\n");

    try {
      await sendTelegramMessage(message.chat.id, responseText, message.message_id);
    } catch (error) {
      logger.error({ err: error }, "Could not answer Telegram balance command");
    }

    return;
  }

  const isDailyCommand = /^\/daily(?:@[a-zA-Z0-9_]+)?$/iu.test(text.trim());
  if (isDailyCommand) {
    const daily = await claimDailyFish({
      telegramId: message.from.id,
      displayName: getTelegramDisplayName(message.from),
    });

    const responseText = daily.ok
      ? `Вы поймали ${daily.amount} 🐟, так держать! Ваш баланс: ${daily.balance} 🐟`
      : "❌ Бонус можно получать только раз в 3 дня.";

    try {
      await sendTelegramMessage(message.chat.id, responseText, message.message_id);
    } catch (error) {
      logger.error({ err: error }, "Could not answer Telegram daily command");
    }

    return;
  }

  const isFridgeCommand =
    /^(?:\/buy_fridge(?:@[a-zA-Z0-9_]+)?|\/fridge(?:@[a-zA-Z0-9_]+)?|купить холодильник)$/iu.test(
      text.trim(),
    );
  if (isFridgeCommand) {
    const fridge = await buyFridge({
      telegramId: message.from.id,
      displayName: getTelegramDisplayName(message.from),
    });
    const displayName = getTelegramDisplayName(message.from);
    const responseText = fridge.ok
      ? `❄️ ${displayName}, вы успешно купили холодильник за 150 🐟! Теперь ваши рыбки в безопасности на 7 дней.`
      : "❌ Холодильник стоит 150 🐟! У вас недостаточно рыбок.";

    try {
      await sendTelegramMessage(message.chat.id, responseText, message.message_id);
    } catch (error) {
      logger.error({ err: error }, "Could not answer Telegram fridge command");
    }

    return;
  }

  const isLootCommand = /^(?:\/loot(?:@[a-zA-Z0-9_]+)?|сундук)$/iu.test(text.trim());
  if (isLootCommand) {
    const loot = await openLootChest({
      telegramId: message.from.id,
      displayName: getTelegramDisplayName(message.from),
    });

    try {
      await sendTelegramMessage(
        message.chat.id,
        formatLootResponse(loot),
        message.message_id,
      );
    } catch (error) {
      logger.error({ err: error }, "Could not answer Telegram loot command");
    }

    return;
  }    const rouletteMatch = text.trim().match(/^\/roulette(?:\@[a-zA-Z0-9_]+)?(?:\s+(\d+))?$/i);
    if (rouletteMatch) {
      const bet = parseInt(rouletteMatch[1] || "1", 10);
      const userProfile = await getFishProfile({
        telegramId: message.from.id,
        displayName: getTelegramDisplayName(message.from),
      });

        let responseText = "";
        if (userProfile.balance < bet) {
          responseText = `❌ У вас недостаточно рыбок для ставки ${bet}! Ваш баланс: ${userProfile.balance}`;
        } else {
          const isWin = Math.random() < 0.5;

          if (isWin) {
            const winBalance = userProfile.balance + bet;
            responseText = `🎰 Выигрыш! Вы выиграли ${bet} 🐟. Остаток: ${winBalance} 🐟`;
          } else {
            const newBalance = userProfile.balance - bet;
            responseText = `🎰 Проигрыш! Вы потеряли ${bet} 🐟. Остаток: ${newBalance} 🐟`;
          }
        }

        try {

        await sendTelegramMessage(message.chat.id, responseText, message.message_id);
      } catch (error) {
        logger.error({ err: error }, "Could not answer Telegram roulette command");
      }


      try {
        await sendTelegramMessage(message.chat.id, responseText, message.message_id);
      } catch (error) {
        logger.error({ err: error }, "Could not answer Telegram roulette command");
      }

      return;
    }


  const deductionMatch = text.trim().match(/^-([0-9]+)\s+рыб(?:ок|ы)?$/iu);
  if (deductionMatch) {
    const target = message.reply_to_message?.from;
    const amount = Number(deductionMatch[1]);
    let responseText: string;

    if (!target) {
      responseText = "❌ Используйте эту команду в ответ на сообщение пользователя.";
    } else {
      const result = await deductFish({
        actorTelegramId: message.from.id,
        targetTelegramId: target.id,
        targetDisplayName: getTelegramDisplayName(target),
        amount,
      });
      responseText =
        !result.ok && result.reason === "fridge-protected"
          ? "❌ У игрока активен холодильник! Списать рыбки может только главный администратор."
          : !result.ok && result.reason === "not-authorized"
            ? "❌ Недостаточно прав для списания рыбок."
            : !result.ok
              ? "❌ У игрока недостаточно рыбок."
              : `✅ Списано ${amount} 🐟. Новый баланс: ${result.balance} 🐟`;
    }

    try {
      await sendTelegramMessage(message.chat.id, responseText, message.message_id);
    } catch (error) {
      logger.error({ err: error }, "Could not answer Telegram deduction command");
    }

    return;
  }

  const isFishCommand = /^(?:\/pay(?:@[a-zA-Z0-9_]+)?|подарить)\b/iu.test(text.trim());
  if (!isFishCommand) {
    return;
  }

  const replyAuthor = message.reply_to_message?.from;
  const amount = parseFishCommand(text);

  let responseText: string;
  if (!replyAuthor) {
    responseText = "❌ Используйте эту команду в ответ на сообщение пользователя.";
  } else if (!amount) {
    responseText = "❌ Укажите положительное целое число рыбок.";
  } else {
    const result = await transferFish({
      senderTelegramId: message.from.id,
      senderDisplayName: getTelegramDisplayName(message.from),
      recipientTelegramId: replyAuthor.id,
      recipientDisplayName: getTelegramDisplayName(replyAuthor),
      amount,
    });

    if (!result.ok) {
      responseText =
        result.failure.kind === "negative-balance"
          ? "❌ У вас отрицательный баланс! Вы не можете дарить рыбок."
          : result.failure.kind === "insufficient-balance"
            ? `❌ У вас недостаточно рыбок на балансе! Доступно: ${result.failure.balance} 🐟.`
            : "❌ Сумма перевода должна быть больше 0.";
    } else {
      responseText = `🎁 ${result.sender.displayName} перевел ${amount} 🐟 пользователю ${result.recipient.displayName}!`;
    }
  }

  try {
    await sendTelegramMessage(message.chat.id, responseText, message.message_id);
  } catch (error) {
    logger.error({ err: error }, "Could not answer Telegram fish command");
  }
}

function formatFridgeStatus(expiresAt: Date | null, now = new Date()): string {
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
    return "❄️ Холодильник: отсутствует";
  }

  const remaining = formatRemainingParts(expiresAt, now);
  return `❄️ Холодильник: активен до ${formatDateTime(expiresAt)} (осталось ${remaining.days} дн. ${remaining.hours} ч.)`;
}

function formatBonusStatus(
  command: string,
  lastUsedAt: Date | null,
  cooldownMs: number,
  now: Date,
): string {
  if (!lastUsedAt || lastUsedAt.getTime() + cooldownMs <= now.getTime()) {
    return `🎁 ${command}: доступен`;
  }

  const remaining = formatRemainingParts(
    new Date(lastUsedAt.getTime() + cooldownMs),
    now,
  );
  return `🎁 ${command}: через ${remaining.days} дн. ${remaining.hours} ч. ${remaining.minutes} мин.`;
}

function formatRemainingParts(target: Date, now: Date): {
  days: number;
  hours: number;
  minutes: number;
} {
  const totalMinutes = Math.max(
    0,
    Math.ceil((target.getTime() - now.getTime()) / (60 * 1000)),
  );
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return { days, hours, minutes };
}

function formatDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.day}.${values.month} ${values.hour}:${values.minute}`;
}

export default router;