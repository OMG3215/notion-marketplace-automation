import type { Env } from "./env";
import { queryAllRows, extractTitle } from "./notion";

interface SalesRow {
  createdAt: string; // 作成日時 (ISO string)
  templateName: string;
  email: string | null;
  price: number | null;
  eventKind: "purchase" | "refund" | "other";
}

// イベント種別は歴史的に日英混在("購入"/"Purchase", "返金"/"Refund")なのでどちらも吸収する
function classifyEvent(raw: string | null): SalesRow["eventKind"] {
  if (raw === "購入" || raw === "Purchase") return "purchase";
  if (raw === "返金" || raw === "Refund") return "refund";
  return "other";
}

async function loadAllSalesRows(env: Env): Promise<SalesRow[]> {
  const pages = await queryAllRows(env, env.DATA_SOURCE_SALES);

  return pages.map((page: any): SalesRow => {
    const props = page.properties ?? {};
    return {
      createdAt: props["作成日時"]?.created_time ?? page.created_time,
      templateName: extractTitle(props["テンプレート名"]),
      email: props["メールアドレス"]?.email ?? null,
      price: typeof props["販売価格"]?.number === "number" ? props["販売価格"].number : null,
      eventKind: classifyEvent(props["イベント"]?.select?.name ?? null),
    };
  });
}

function inPeriod(row: SalesRow, start: Date, end: Date): boolean {
  const t = new Date(row.createdAt).getTime();
  return t >= start.getTime() && t < end.getTime();
}

export interface PeriodAnalysis {
  totalSales: number;
  salesCount: number;
  topTemplates: { name: string; count: number; revenue: number }[];
  newBuyerCount: number;
  repeatBuyerCount: number;
  repeatRatePercent: number | null; // null = 計算不能(購入者0人)
  comparisonPercent: number | null; // 前期間比。null = 比較不能(前期間の売上が0)
}

export async function analyzeSalesPeriod(
  env: Env,
  periodStart: Date,
  periodEnd: Date,
  previousPeriodStart: Date,
  previousPeriodEnd: Date
): Promise<PeriodAnalysis> {
  const allRows = await loadAllSalesRows(env);

  const currentRows = allRows.filter((r) => inPeriod(r, periodStart, periodEnd));
  const previousRows = allRows.filter((r) => inPeriod(r, previousPeriodStart, previousPeriodEnd));

  const currentPurchases = currentRows.filter((r) => r.eventKind === "purchase");
  const currentRefunds = currentRows.filter((r) => r.eventKind === "refund");
  const previousPurchases = previousRows.filter((r) => r.eventKind === "purchase");

  const grossSales = currentPurchases.reduce((sum, r) => sum + (r.price ?? 0), 0);
  const refundedAmount = currentRefunds.reduce((sum, r) => sum + (r.price ?? 0), 0);
  const totalSales = grossSales - refundedAmount;
  const salesCount = currentPurchases.length;

  const byTemplate = new Map<string, { count: number; revenue: number }>();
  for (const row of currentPurchases) {
    const entry = byTemplate.get(row.templateName) ?? { count: 0, revenue: 0 };
    entry.count += 1;
    entry.revenue += row.price ?? 0;
    byTemplate.set(row.templateName, entry);
  }
  const topTemplates = [...byTemplate.entries()]
    .map(([name, v]) => ({ name, count: v.count, revenue: v.revenue }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // リピーター判定: 期間内の購入者のうち、期間開始より前に購入履歴がある人
  const priorBuyerEmails = new Set(
    allRows
      .filter((r) => r.eventKind === "purchase" && r.email && new Date(r.createdAt) < periodStart)
      .map((r) => r.email as string)
  );
  const buyerEmailsInPeriod = new Set(
    currentPurchases.filter((r) => r.email).map((r) => r.email as string)
  );

  let repeatBuyerCount = 0;
  for (const email of buyerEmailsInPeriod) {
    if (priorBuyerEmails.has(email)) repeatBuyerCount += 1;
  }
  const newBuyerCount = buyerEmailsInPeriod.size - repeatBuyerCount;
  const repeatRatePercent =
    buyerEmailsInPeriod.size > 0 ? (repeatBuyerCount / buyerEmailsInPeriod.size) * 100 : null;

  const previousTotalSales = previousPurchases.reduce((sum, r) => sum + (r.price ?? 0), 0);
  const comparisonPercent =
    previousTotalSales > 0 ? ((totalSales - previousTotalSales) / previousTotalSales) * 100 : null;

  return {
    totalSales,
    salesCount,
    topTemplates,
    newBuyerCount,
    repeatBuyerCount,
    repeatRatePercent,
    comparisonPercent,
  };
}

function formatPercent(value: number | null): string {
  if (value === null) return "比較不可(前期間データなし)";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatTopTemplates(topTemplates: PeriodAnalysis["topTemplates"]): string {
  if (topTemplates.length === 0) return "(該当なし)";
  return topTemplates
    .map((t, i) => `${i + 1}. ${t.name}（$${t.revenue.toFixed(2)} / ${t.count}件）`)
    .join("\n");
}

// Notion AIを使わず、集計結果から定型文のサマリ・アクション提案を作る(AIクレジットを消費しない)
function buildSummary(a: PeriodAnalysis, periodLabel: string): string {
  const topName = a.topTemplates[0]?.name ?? "該当テンプレートなし";
  const repeatText =
    a.repeatRatePercent === null
      ? "リピート購入者は確認できませんでした。"
      : `リピート率は${a.repeatRatePercent.toFixed(1)}%（リピーター${a.repeatBuyerCount}人/新規${a.newBuyerCount}人）でした。`;

  return (
    `${periodLabel}の総売上は$${a.totalSales.toFixed(2)}（${a.salesCount}件）でした。` +
    `前期間比は${formatPercent(a.comparisonPercent)}です。` +
    `最も売れたテンプレートは「${topName}」でした。${repeatText}`
  );
}

function buildNextActions(a: PeriodAnalysis): string {
  const actions: string[] = [];

  if (a.comparisonPercent !== null && a.comparisonPercent < 0) {
    actions.push("売上が前期間比で減少しているため、プロモーションや割引施策を検討する");
  }
  if (a.repeatRatePercent !== null && a.repeatRatePercent < 10) {
    actions.push("リピート率が低いため、購入者へのフォローアップメールや関連テンプレートの案内を検討する");
  }
  if (a.topTemplates[0]) {
    actions.push(`「${a.topTemplates[0].name}」の需要が高いため、関連テンプレートや上位版の展開を検討する`);
  }
  if (actions.length === 0) {
    actions.push("特に大きな変化はありません。次期間も同様の運用を継続する");
  }

  return actions.map((action) => `- [ ] ${action}`).join("\n");
}

export function buildReportProperties(a: PeriodAnalysis, periodLabel: string) {
  return {
    総売上: { number: a.totalSales },
    販売数: { number: a.salesCount },
    トップテンプレート: {
      rich_text: [{ type: "text", text: { content: formatTopTemplates(a.topTemplates) } }],
    },
    リピーター数: { number: a.repeatBuyerCount },
    リピート率: {
      rich_text: [
        {
          type: "text",
          text: {
            content: a.repeatRatePercent === null ? "算出不可" : `${a.repeatRatePercent.toFixed(1)}%`,
          },
        },
      ],
    },
    前月比: { rich_text: [{ type: "text", text: { content: formatPercent(a.comparisonPercent) } }] },
    分析サマリ: { rich_text: [{ type: "text", text: { content: buildSummary(a, periodLabel) } }] },
    次のアクション: { rich_text: [{ type: "text", text: { content: buildNextActions(a) } }] },
  };
}

export function buildDiscordAnalysisBlock(a: PeriodAnalysis): string {
  return (
    `💰 総売上: $${a.totalSales.toFixed(2)}（前期間比 ${formatPercent(a.comparisonPercent)}）\n` +
    `📦 販売数: ${a.salesCount}件\n` +
    `🔁 リピート率: ${a.repeatRatePercent === null ? "算出不可" : `${a.repeatRatePercent.toFixed(1)}%`}\n` +
    `🏆 トップテンプレート: ${a.topTemplates[0]?.name ?? "(該当なし)"}`
  );
}
