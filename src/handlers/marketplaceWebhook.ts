import type { Env } from "../lib/env";
import { createPage } from "../lib/notion";
import { sendDiscordMessage } from "../lib/discord";

interface MarketplacePayload {
  acquisitionId?: string;
  customerEmail?: string;
  templateName?: string;
  totalCustomerPayment?: number | string;
  couponCode?: string;
  time?: string;
  event?: string; // "purchase" | "refund"
}

function isAuthorized(request: Request, env: Env): boolean {
  const header = request.headers.get("x-webhook-secret");
  if (header && header === env.MARKETPLACE_WEBHOOK_SECRET) return true;

  const url = new URL(request.url);
  const query = url.searchParams.get("secret");
  return query === env.MARKETPLACE_WEBHOOK_SECRET;
}

export async function handleMarketplaceWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!isAuthorized(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: MarketplacePayload;
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const acquisitionId = payload.acquisitionId ?? "";
  const customerEmail = payload.customerEmail ?? "";
  const templateName = payload.templateName ?? "";
  const couponCode = payload.couponCode ?? "";
  const rawEvent = payload.event ?? "";
  const totalPrice =
    payload.totalCustomerPayment !== undefined && payload.totalCustomerPayment !== null
      ? Number(payload.totalCustomerPayment) / 100
      : null;

  // 元のPipedreamワークフローでは "purchase" のとき "返金"、それ以外で "購入" になっており
  // イベント種別とラベルが逆転していたため、ここでは意味の通る対応に修正しています
  // (purchase→購入 / refund→返金)。元の挙動に戻したい場合はご連絡ください。
  const eventLabel = rawEvent === "purchase" ? "購入" : rawEvent === "refund" ? "返金" : rawEvent;

  let formattedTime: string | null = null;
  if (payload.time) {
    const parsed = new Date(payload.time);
    formattedTime = Number.isNaN(parsed.getTime()) ? payload.time : parsed.toISOString();
  }

  const properties: Record<string, unknown> = {
    取引ID: { type: "rich_text", rich_text: [{ type: "text", text: { content: acquisitionId } }] },
    メールアドレス: { type: "email", email: customerEmail || null },
    テンプレート名: { type: "title", title: [{ type: "text", text: { content: templateName } }] },
    イベント: { type: "select", select: { name: eventLabel } },
  };

  if (totalPrice !== null && !Number.isNaN(totalPrice)) {
    properties["販売価格"] = { type: "number", number: totalPrice };
  }

  if (couponCode) {
    properties["クーポンコード"] = {
      type: "rich_text",
      rich_text: [{ type: "text", text: { content: couponCode } }],
    };
  }

  if (formattedTime) {
    properties["購入日時"] = { type: "date", date: { start: formattedTime } };
  }

  await createPage(env, env.DATA_SOURCE_SALES, properties);

  const priceText = totalPrice !== null ? `$${totalPrice}` : "不明";
  const message =
    `🎉 Notion テンプレが購入されました！\n\n` +
    `🟢 購入か返金か: ${eventLabel}\n` +
    `📦 テンプレート: ${templateName}\n` +
    `💰 価格: ${priceText}\n` +
    `🏷 クーポン: ${couponCode}\n` +
    `🔖 取引ID: ${acquisitionId}\n` +
    `📩Email：${customerEmail}`;

  await sendDiscordMessage(env.DISCORD_SALES_WEBHOOK_URL, message);

  return new Response(
    JSON.stringify({ ok: true, acquisitionId, eventLabel }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
