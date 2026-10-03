import type { Env } from "../lib/env";
import { createPage } from "../lib/notion";
import { sendDiscordMessage } from "../lib/discord";

function toDateOnly(date: Date): string {
  return date.toISOString().split("T")[0];
}

// cronは毎日22:00 UTC(28〜31日のみ)に発火する。22:00 UTC + 9h = 翌日7:00 JST なので、
// 「UTCでの翌日が1日」の時だけ実行すれば「JST 毎月1日 7:00」と等価になる。
export function shouldRunMonthlyReport(now: Date): boolean {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return tomorrow.getUTCDate() === 1;
}

// この発火時点でのUTC日付はまだ「先月」のまま(JSTで日付が変わる直前)なので、
// now.getUTCFullYear()/getUTCMonth() がそのまま「対象月(先月)」になる。
export async function runMonthlyReport(env: Env, now: Date): Promise<void> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-indexed, 既に「先月」を指す

  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0)); // 月末日

  const reportName = `${year}年${String(month).padStart(2, "0")}月 売上分析`;

  const properties = {
    レポート名: { title: [{ text: { content: reportName } }] },
    レポート種別: { select: { name: "月次" } },
    ステータス: { status: { name: "未分析" } },
    分析期間: { date: { start: toDateOnly(periodStart), end: toDateOnly(periodEnd) } },
  };

  const page = await createPage(env, env.DATA_SOURCE_REPORT, properties);

  const message =
    `📊 **月次分析の準備ができました**\n\n` +
    `📅 対象期間: ${year}年${String(month).padStart(2, "0")}月\n` +
    `📝 レポート: ${reportName}\n\n` +
    `🔗 Notionで確認: ${page.url}`;

  await sendDiscordMessage(env.DISCORD_REPORT_WEBHOOK_URL, message);
}
