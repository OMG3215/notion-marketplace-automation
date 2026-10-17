import type { Env } from "../lib/env";
import { createPage } from "../lib/notion";
import { sendDiscordMessage } from "../lib/discord";
import { analyzeSalesPeriod, buildReportProperties, buildDiscordAnalysisBlock } from "../lib/salesAnalysis";

function toDateOnly(date: Date): string {
  return date.toISOString().split("T")[0];
}

// cron: "0 9 * * SUN" (毎週日曜 9:00 UTC、元のPipedream設定と同じタイムゾーン)
export async function runWeeklyReport(env: Env, now: Date): Promise<void> {
  const periodEnd = now;
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousPeriodStart = new Date(periodStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousPeriodEnd = periodStart;

  const start = toDateOnly(periodStart);
  const end = toDateOnly(periodEnd);
  const reportName = `${end}週 売上分析`;

  const analysis = await analyzeSalesPeriod(env, periodStart, periodEnd, previousPeriodStart, previousPeriodEnd);

  const properties = {
    レポート名: { title: [{ text: { content: reportName } }] },
    レポート種別: { select: { name: "週次" } },
    ステータス: { status: { name: "完了" } },
    分析期間: { date: { start, end } },
    ...buildReportProperties(analysis, `${start}〜${end}`),
  };

  const page = await createPage(env, env.DATA_SOURCE_REPORT, properties);

  const message =
    `📊 **週次分析が完了しました**\n\n` +
    `📅 対象期間: ${start} 〜 ${end}\n` +
    `📝 レポート: ${reportName}\n\n` +
    `${buildDiscordAnalysisBlock(analysis)}\n\n` +
    `🔗 Notionで確認: ${page.url}`;

  await sendDiscordMessage(env, env.DISCORD_REPORT_WEBHOOK_URL, message);
}
