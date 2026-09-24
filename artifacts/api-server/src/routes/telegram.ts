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
  openLootChest,
  transferFish,
} from "../services/fish-transfers";
import { recordChatMessage } from "../services/activity";

const router: IRouter = Router();

router.post("/telegram/webhook", async (req, res) => {
  const secret = req.header("x-telegram-bot-api-secret-token");
  if (!isValidTelegramWebhookSecret(secret)) {
    res.status(401).json({ ok: false });
    return;
  }

  const update = req.body as TelegramUpdate;
  const message = update?.message;
  const text = message?.text;

  if (!message || !message.from) {
    res.json({ ok: true });
    return;
  }

  if (!message.from.is_bot) {
    await recordChatMessage({
      chatId: message.chat.id,
      telegramId: message.from.id,
      displayName: getTelegramDisplayName(message.from),
    });
  }

  if (!text) {
    res.json({ ok: true });
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
      req.log.error({ err: error }, "Could not answer Telegram daily command");
    }

    res.json({ ok: true });
    return;
  }

  const isLootCommand = /^(?:\/loot(?:@[a-zA-Z0-9_]+)?|сундук)$/iu.test(text.trim());
  if (isLootCommand) {
    const loot = await openLootChest({
      telegramId: message.from.id,
      displayName: getTelegramDisplayName(message.from),
    });

    const responseText = !loot.ok
      ? loot.reason === "insufficient-balance"
        ? "❌ Сундук стоит 10 🐟! У вас недостаточно рыбок."
        : `⏳ Следующий сундук можно открыть через ${formatRemainingTime(loot.nextClaimAt)}.`
      : loot.outcome === "piranha"
        ? `Упс, похоже сегодня не ваш день. Из сундука выпрыгивает пиранья, больно кусает вас. Вы теряете 5 рыб. Ваш баланс: ${loot.balance} 🐟`
        : loot.outcome === "common"
          ? `📦 Вы открыли сундук и нашли ${loot.amount} 🐟! Ваш баланс: ${loot.balance} 🐟`
          : loot.outcome === "great"
            ? `📦 Отличная находка! В сундуке оказалось ${loot.amount} 🐟! Ваш баланс: ${loot.balance} 🐟`
            : loot.outcome === "super"
              ? `📦 Супер-удача! В сундуке оказалось ${loot.amount} 🐟! Ваш баланс: ${loot.balance} 🐟`
              : `🎉 СОКРОВИЩЕ! Вы нашли джекпот — 40 🐟! Ваш баланс: ${loot.balance} 🐟`;

    try {
      await sendTelegramMessage(message.chat.id, responseText, message.message_id);
    } catch (error) {
      req.log.error({ err: error }, "Could not answer Telegram loot command");
    }

    res.json({ ok: true });
    return;
  }

  const isFishCommand = /^(?:\/pay(?:@[a-zA-Z0-9_]+)?|подарить)\b/iu.test(text.trim());
  if (!isFishCommand) {
    res.json({ ok: true });
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
    req.log.error({ err: error }, "Could not answer Telegram fish command");
  }

  res.json({ ok: true });
});

function formatRemainingTime(nextClaimAt: Date, now = new Date()): string {
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

export default router;