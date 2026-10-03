export interface Env {
  // vars (wrangler.toml [vars])
  NOTION_VERSION: string;
  DATA_SOURCE_SALES: string;
  DATA_SOURCE_INQUIRY: string;
  DATA_SOURCE_REPORT: string;
  GMAIL_FROM_EMAIL: string;
  GMAIL_FROM_NAME: string;

  // secrets (wrangler secret put)
  NOTION_TOKEN: string;
  MARKETPLACE_WEBHOOK_SECRET: string;
  DISCORD_SALES_WEBHOOK_URL: string;
  DISCORD_INQUIRY_WEBHOOK_URL: string;
  DISCORD_REPORT_WEBHOOK_URL: string;
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
}
