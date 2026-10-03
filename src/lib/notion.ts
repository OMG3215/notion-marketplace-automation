import type { Env } from "./env";

// Notion API 2025-09-03 (データソースAPI)への薄いラッパー。
// 参考: https://developers.notion.com/docs/upgrade-guide-2025-09-03

async function notionFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": env.NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${init.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }

  return res.json();
}

export function createPage(env: Env, dataSourceId: string, properties: Record<string, unknown>) {
  return notionFetch(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties,
    }),
  });
}

export function updatePage(env: Env, pageId: string, properties: Record<string, unknown>) {
  return notionFetch(env, `/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}

export function queryDataSource(env: Env, dataSourceId: string, filter: Record<string, unknown>) {
  return notionFetch(env, `/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body: JSON.stringify({ filter }),
  });
}

// Notionの rich_text プロパティから結合済みプレーンテキストを取り出す
export function extractRichText(property: any): string {
  if (!property?.rich_text || !Array.isArray(property.rich_text)) return "";
  return property.rich_text.map((item: any) => item.plain_text ?? "").join("");
}

export function extractTitle(property: any): string {
  if (!property?.title || !Array.isArray(property.title)) return "";
  return property.title.map((item: any) => item.plain_text ?? "").join("");
}
