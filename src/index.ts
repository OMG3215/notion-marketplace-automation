import type { Env } from "./lib/env";
import { handleMarketplaceWebhook } from "./handlers/marketplaceWebhook";
import { runInquiryReplyPoll } from "./handlers/inquiryReply";
import { runWeeklyReport } from "./handlers/weeklyReport";
import { runMonthlyReport, shouldRunMonthlyReport } from "./handlers/monthlyReport";

const INQUIRY_POLL_CRON = "*/5 * * * *";
// Cloudflareの曜日は 1〜7(1=日曜) という独自ルールで "0" は無効なため "SUN" を使う
const WEEKLY_REPORT_CRON = "0 9 * * SUN";
const MONTHLY_REPORT_CHECK_CRON = "0 22 28-31 * *";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/webhooks/marketplace-sales") {
      return handleMarketplaceWebhook(request, env);
    }

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);

    switch (event.cron) {
      case INQUIRY_POLL_CRON:
        await runInquiryReplyPoll(env);
        break;

      case WEEKLY_REPORT_CRON:
        await runWeeklyReport(env, now);
        break;

      case MONTHLY_REPORT_CHECK_CRON:
        if (shouldRunMonthlyReport(now)) {
          await runMonthlyReport(env, now);
        }
        break;

      default:
        console.error(`unknown cron pattern: ${event.cron}`);
    }
  },
};
