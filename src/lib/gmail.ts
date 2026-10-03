import type { Env } from "./env";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Url(input: string): string {
  return bytesToBase64(new TextEncoder().encode(input))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// RFC 2047 encoded-word (日本語の表示名・件名用)
function encodeWord(text: string): string {
  const base64 = bytesToBase64(new TextEncoder().encode(text));
  return `=?UTF-8?B?${base64}?=`;
}

async function getAccessToken(env: Env): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Gmail OAuth token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

export async function sendReplyEmail(env: Env, input: SendEmailInput): Promise<void> {
  const accessToken = await getAccessToken(env);

  const fromHeader = `${encodeWord(env.GMAIL_FROM_NAME)} <${env.GMAIL_FROM_EMAIL}>`;
  const subjectHeader = encodeWord(input.subject);
  const bodyBase64 = bytesToBase64(new TextEncoder().encode(input.body));

  const message = [
    `From: ${fromHeader}`,
    `To: ${input.to}`,
    `Subject: ${subjectHeader}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    bodyBase64,
  ].join("\r\n");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64Url(message) }),
  });

  if (!res.ok) {
    throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
  }
}
