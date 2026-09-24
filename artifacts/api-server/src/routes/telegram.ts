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
      chatType: message.chat.type ?? "unknown",
      telegramId: message.from.id,
      displayName: getTelegramDisplayName(message.from),
    });
  }

  if (!text) {
    res.json({ ok: true });
    return;
  }

  const isBalanceCommand = /^(?:\/balance(?:@[a-zA-Z0-9_]+)?|баланс|профиль)$/iu.test(
    text.trim(),
  );
  if (isBalanceCommand) {
    const profile = await getFishProfile({
      telegramId: message.from.id,
      displayName: getTelegramDisplayName(message.from),
    });
    const responseText = `🐟 Баланс: ${profile.balance} 🐟\n${formatFridgeStatus(profile.fridgeExpiresAt)}`;

    try {
      await sendTelegramMessage(message.chat.id, responseText, message.message_id);
    } catch (error) {
      req.log.error({ err: error }, "Could not answer Telegram balance command");
    }

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
      req.log.error({ err: error }, "Could not answer Telegram fridge command");
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
      req.log.error({ err: error }, "Could not answer Telegram deduction command");
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

function formatFridgeStatus(expiresAt: Date | null, now = new Date()): string {
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
    return "❄️ Холодильник: нет";
  }

  const totalHours = Math.ceil(
    (expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000),
  );
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `❄️ Холодильник: активен ещё ${days} дн. ${hours} ч.`;
}

export default router;