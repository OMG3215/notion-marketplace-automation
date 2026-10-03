export async function sendDiscordMessage(webhookUrl: string, content: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} ${body}`);
  }
}
