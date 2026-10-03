import type { Env } from "../lib/env";
import { createPage } from "../lib/notion";
import { sendDiscordMessage } from "../lib/discord";

function toDateOnly(date: Date): string {
  return date.toISOString().split("T")[0];
}

// cron: "0 9 * * SUN" (毎週日曜 9:00 UTC、元のPipedream設定と同じタイムゾーン)
export async function runWeeklyReport(env: Env, now: Date): Promise<void> {
  const end = toDateOnly(now);
  const start = toDateOnly(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));

  const reportName = `${end}週 売上分析`;

  const properties = {
    レポート名: { title: [{ text: { content: reportName } }] },
    レポート種別: { select: { name: "週次" } },
    ステータス: { status: { name: "未分析" } },
    分析期間: { date: { start, end } },
  };

  const page = await createPage(env, env.DATA_SOURCE_REPORT, properties);

  const message =
    `📊 **週次分析の準備ができました**\n\n` +
    `📅 対象期間: ${start} 〜 ${end}\n` +
    `📝 レポート: ${reportName}\n\n` +
    `🔗 Notionで確認: ${page.url}`;

  await sendDiscordMessage(env.DISCORD_REPORT_WEBHOOK_URL, message);
}
