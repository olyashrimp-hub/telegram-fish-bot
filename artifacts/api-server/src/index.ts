import app from "./app";
import { logger } from "./lib/logger";
import { registerTelegramWebhook } from "./services/telegram";
import { startActivityScheduler } from "./services/activity";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startActivityScheduler();

  if (process.env.NODE_ENV === "production") {
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    if (!webhookUrl) {
      logger.warn(
        "TELEGRAM_WEBHOOK_URL is not configured; Telegram webhook registration was skipped.",
      );
      return;
    }

    void registerTelegramWebhook(webhookUrl).catch((error) => {
      logger.error({ err: error }, "Could not register Telegram webhook");
    });
  }
});
