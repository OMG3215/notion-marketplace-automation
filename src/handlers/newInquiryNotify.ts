import type { Env } from "../lib/env";
import { sendDiscordMessage } from "../lib/discord";

// Notionのデータベースオートメーション「Send webhook」が送るペイロードの正確な形式は
// 公式ドキュメントで明言されていないため、プロパティ名をキーにしてオブジェクトを
// 再帰的に探索する作りにしてある。これによりペイロードの入れ子構造の違いに強くなる。
function deepFind(obj: unknown, targetKey: string, depth = 0): unknown {
  if (depth > 8 || obj === null || typeof obj !== "object") return undefined;
  const record = obj as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, targetKey)) {
    return record[targetKey];
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const found = deepFind(value, targetKey, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function extractText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => extractText((v as any)?.plain_text ?? (v as any)?.text?.content ?? v)).join("");
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.plain_text === "string") return v.plain_text;
    if (typeof v.email === "string") return v.email;
    if (Array.isArray(v.title)) return extractText(v.title);
    if (Array.isArray(v.rich_text)) return extractText(v.rich_text);
    if (typeof v.content === "string") return v.content;
  }
  return "";
}

function findPageUrl(body: unknown): string | null {
  const url = deepFind(body, "url");
  if (typeof url === "string" && url.startsWith("http")) return url;

  const id =
    deepFind(body, "page_id") ??
    deepFind(body, "pageId") ??
    deepFind(body, "entry_id") ??
    deepFind(body, "entryId") ??
    deepFind(body, "id");
  if (typeof id === "string") return `https://www.notion.so/${id.replace(/-/g, "")}`;

  return null;
}

function isAuthorized(request: Request, env: Env): boolean {
  const header = request.headers.get("x-webhook-secret");
  if (header && header === env.NEW_INQUIRY_WEBHOOK_SECRET) return true;

  const url = new URL(request.url);
  return url.searchParams.get("secret") === env.NEW_INQUIRY_WEBHOOK_SECRET;
}

export async function handleNewInquiryWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!isAuthorized(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const name = extractText(deepFind(body, "お名前")) || "(名前不明)";
  const email = extractText(deepFind(body, "メール")) || "(メール不明)";
  const templateName = extractText(deepFind(body, "ご利用いただいているテンプレート")) || "(不明)";
  const pageUrl = findPageUrl(body);

  const message =
    `📩 **新規問い合わせが届きました**\n\n` +
    `👤 ${name}\n` +
    `📧 ${email}\n` +
    `📦 テンプレート: ${templateName}\n\n` +
    (pageUrl ? `🔗 Notionで確認する: ${pageUrl}` : `🔗 Notionで確認してください`);

  await sendDiscordMessage(env, env.DISCORD_INQUIRY_WEBHOOK_URL, message);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
