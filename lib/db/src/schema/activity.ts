import { bigint, date, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chatActivityTable = pgTable(
  "chat_activity",
  {
    id: serial("id").primaryKey(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    displayName: text("display_name").notNull(),
    activityDate: date("activity_date", { mode: "string" }).notNull(),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    chatUserDateUnique: uniqueIndex("chat_activity_chat_user_date_unique").on(
      table.chatId,
      table.telegramId,
      table.activityDate,
    ),
  }),
);

export const activitySettlementsTable = pgTable(
  "activity_settlements",
  {
    id: serial("id").primaryKey(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    activityDate: date("activity_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    chatDateUnique: uniqueIndex("activity_settlements_chat_date_unique").on(
      table.chatId,
      table.activityDate,
    ),
  }),
);

export const insertChatActivitySchema = createInsertSchema(chatActivityTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertChatActivity = z.infer<typeof insertChatActivitySchema>;
export type ChatActivity = typeof chatActivityTable.$inferSelect;
export type ActivitySettlement = typeof activitySettlementsTable.$inferSelect;