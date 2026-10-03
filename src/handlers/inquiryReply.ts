import type { Env } from "../lib/env";
import { extractRichText, extractTitle, queryDataSource, updatePage } from "../lib/notion";
import { sendReplyEmail } from "../lib/gmail";
import { sendDiscordMessage } from "../lib/discord";

// 元のPipedreamソース(notion-updated-page)は「ステータスプロパティが変化したこと」を
// 検知してから「変化後の値が送信待ちか」を確認する2段構成でしたが、
// 最終的に必要なのは「現在ステータスが送信待ちの行をすべて処理する」ことなので、
// cronポーリングでは直接 ステータス=送信待ち を検索するだけで同じ結果になり、
// 見落とし(ポーリング間隔中の変化)にも強くなります。
export async function runInquiryReplyPoll(env: Env): Promise<void> {
  const result = await queryDataSource(env, env.DATA_SOURCE_INQUIRY, {
    property: "ステータス",
    status: { equals: "送信待ち" },
  });

  const pages: any[] = result.results ?? [];

  for (const page of pages) {
    try {
      await processPage(env, page);
    } catch (err) {
      // 1件の失敗で他の問い合わせ処理を止めない
      console.error(`inquiry reply failed for page ${page.id}:`, err);
    }
  }
}

async function processPage(env: Env, page: any): Promise<void> {
  const properties = page.properties ?? {};

  const replyText = extractRichText(properties["返信文"]);
  const subject = extractRichText(properties["件名"]);
  const toEmail: string | null = properties["メール"]?.email ?? null;

  if (!toEmail) {
    console.error(`inquiry page ${page.id} has no email, skipping`);
    return;
  }
  if (!replyText || !subject) {
    console.error(`inquiry page ${page.id} is missing 返信文 or 件名, skipping`);
    return;
  }

  await sendReplyEmail(env, { to: toEmail, subject, body: replyText });

  await updatePage(env, page.id, {
    ステータス: { status: { name: "完了" } },
    返信日時: { date: { start: new Date().toISOString() } },
  });

  const name = extractTitle(properties["お名前"]);
  const templateName = extractRichText(properties["ご利用いただいているテンプレート"]);

  const message =
    `✅ **返信を送信しました**\n\n` +
    `👤 お名前: ${name}\n` +
    `📦 テンプレート: ${templateName}\n` +
    `📧 送信先: ${toEmail}\n\n` +
    `🔗 Notionで確認: ${page.url}`;

  await sendDiscordMessage(env.DISCORD_INQUIRY_WEBHOOK_URL, message);
}
