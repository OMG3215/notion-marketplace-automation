import type { Env } from "./env";

export async function sendDiscordMessage(env: Env, webhookUrl: string, content: string): Promise<void> {
  const mention = env.DISCORD_MENTION_USER_ID ? `<@${env.DISCORD_MENTION_USER_ID}> ` : "";

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: `${mention}${content}` }),
  });

  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} ${body}`);
  }
}
