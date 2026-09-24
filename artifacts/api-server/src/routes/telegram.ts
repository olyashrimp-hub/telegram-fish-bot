import { Router, type IRouter } from "express";
import {
  getTelegramDisplayName,
  parseFishCommand,
  sendTelegramMessage,
  type TelegramUpdate,
} from "../services/telegram";
import { claimDailyFish, transferFish } from "../services/fish-transfers";

const router: IRouter = Router();

router.post("/telegram/webhook", async (req, res) => {
  const update = req.body as TelegramUpdate;
  const message = update?.message;
  const text = message?.text;

  if (!message || !message.from || !text) {
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

export default router;