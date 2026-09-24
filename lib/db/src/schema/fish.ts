import { bigint, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fishUsersTable = pgTable(
  "fish_users",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    displayName: text("display_name").notNull(),
    balance: integer("balance").notNull().default(0),
    lastDailyAt: timestamp("last_daily_at", { withTimezone: true }),
    lastLootAt: timestamp("last_loot_at", { withTimezone: true }),
    fridgeExpiresAt: timestamp("fridge_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    telegramIdUnique: uniqueIndex("fish_users_telegram_id_unique").on(table.telegramId),
  }),
);

export const fishTransfersTable = pgTable("fish_transfers", {
  id: serial("id").primaryKey(),
  senderTelegramId: bigint("sender_telegram_id", { mode: "number" }).notNull(),
  recipientTelegramId: bigint("recipient_telegram_id", { mode: "number" }).notNull(),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fishLotsTable = pgTable("fish_lots", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  amount: integer("amount").notNull(),
  remainingAmount: integer("remaining_amount").notNull(),
  source: text("source").notNull(),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
  protectedUntil: timestamp("protected_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fishUserChatsTable = pgTable(
  "fish_user_chats",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    chatType: text("chat_type").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userChatUnique: uniqueIndex("fish_user_chats_user_chat_unique").on(
      table.telegramId,
      table.chatId,
    ),
  }),
);

export const insertFishUserSchema = createInsertSchema(fishUsersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFishUser = z.infer<typeof insertFishUserSchema>;
export type FishUser = typeof fishUsersTable.$inferSelect;
export type FishTransfer = typeof fishTransfersTable.$inferSelect;