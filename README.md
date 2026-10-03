# notion-marketplace-automation

Pipedream（2026年3月末サポート終了）で動かしていた以下4つのワークフローを、
Cloudflare Workers 1つに移植したものです。

| 元のPipedreamワークフロー | このWorkerでの実装 |
|---|---|
| Notion Marketplace 通知（Webhook受信） | `POST /webhooks/marketplace-sales`（HTTPエンドポイント） |
| Notion 問合せ / 返信済み（Notion更新をポーリング） | cron `*/5 * * * *`（5分おきにステータス=送信待ちを検索） |
| Notion-template-WEEKLYreport | cron `0 9 * * 0`（毎週日曜 9:00 UTC） |
| Notion-template-MONTHLY report | cron `0 22 28-31 * *`（JST毎月1日 7:00相当） |

## なぜCloudflare Workersか

- マーケットプレイスからの売上Webhookは**常時起動の公開URL**が必要で、Claude Codeのセッション/Webhook機能はセッション終了で失効するため不向きです。
- レポート作成・問い合わせポーリングはcronで定期実行する必要があり、Workersの Cron Triggers でまとめて面倒を見られます。
- 無料枠で月10万リクエスト程度まで動くため、この規模の個人運用には十分です。

## ディレクトリ構成

```
src/
  index.ts                 # Workerのエントリポイント（HTTPルーティング / cron振り分け）
  handlers/
    marketplaceWebhook.ts  # ①売上Webhook受信 → Notion作成 → Discord通知
    inquiryReply.ts         # ②問い合わせ自動返信（5分おきポーリング）
    weeklyReport.ts         # ③週次レポート雛形作成
    monthlyReport.ts        # ④月次レポート雛形作成
  lib/
    notion.ts               # Notion API (2025-09-03, data_sources) 薄いラッパー
    discord.ts               # Discord Incoming Webhook送信
    gmail.ts                  # Gmail API送信（OAuth refresh tokenベース）
    env.ts                     # 環境変数/シークレットの型定義
```

## 事前準備（1回だけ）

### 1. Node.js / wrangler

```bash
npm install
npx wrangler login   # Cloudflareアカウントでログイン(ブラウザが開きます)
```

Cloudflareアカウントが無ければ https://dash.cloudflare.com/sign-up で無料登録してください（クレジットカード不要）。

### 2. Notion Internal Integration を作る

1. https://www.notion.so/profile/integrations で「+ New integration」
2. ワークスペースを選び、Capabilities は Read content / Update content / Insert content にチェック
3. 発行された **Internal Integration Secret**（`secret_...` or `ntn_...`）を控える
4. 以下3つのデータベースをこのインテグレーションに接続する（各ページ右上「...」→「Connections」→ 作成したインテグレーションを追加）
   - Marketplace 売上管理（取引ID/メールアドレス/テンプレート名/イベント/販売価格/クーポンコード/購入日時のプロパティがある想定）
   - Notion-問い合わせフォーム（ステータス[Status型]/返信文/件名/メール/お名前/ご利用いただいているテンプレートのプロパティがある想定）
   - 売上分析レポート（レポート名/レポート種別/ステータス/分析期間のプロパティがある想定）

   ※ `wrangler.toml` の `DATA_SOURCE_SALES` / `DATA_SOURCE_INQUIRY` / `DATA_SOURCE_REPORT` には、
   元のPipedream設定から読み取った既存のdata_source_idを設定済みです。データベースを作り直した場合はここを更新してください。

   ※ **重要**: プロパティ名・型（特に「ステータス」がSelectかStatusか）は実際のデータベースに合わせて
   `src/handlers/*.ts` 内のプロパティ定義を調整してください。動かない場合はまずここを疑ってください。

### 3. Discord Incoming Webhook を3つ作る

元のワークフローが投稿していたチャンネルそれぞれで:
サーバー設定 → 連携サービス → ウェブフック → 新しいウェブフック → URLをコピー

- マケプレ売上管理通知チャンネル → `DISCORD_SALES_WEBHOOK_URL`
- notion-問合せチャンネル → `DISCORD_INQUIRY_WEBHOOK_URL`
- notion-テンプレレポートチャンネル → `DISCORD_REPORT_WEBHOOK_URL`

(同じチャンネルでよければ同じURLを使い回してOKです)

### 4. Gmail送信用のOAuthクレデンシャルを取得する

`murameeee@gmail.com` から送信するため、Gmail APIのOAuth2 refresh tokenを発行します。

1. https://console.cloud.google.com/ でプロジェクトを作成
2. 「APIとサービス」→「ライブラリ」で **Gmail API** を有効化
3. 「APIとサービス」→「OAuth同意画面」を設定（テストユーザーに murameeee@gmail.com を追加）
4. 「認証情報」→「OAuthクライアントID」を作成（アプリケーションの種類: **デスクトップアプリ**）→ クライアントID・シークレットを控える
5. [Google OAuth Playground](https://developers.google.com/oauthplayground) を開く
   - 右上の歯車アイコン →「Use your own OAuth credentials」にチェックし、手順4のクライアントID/シークレットを入力
   - 左側のScopeに `https://www.googleapis.com/auth/gmail.send` を入力して「Authorize APIs」
   - murameeee@gmail.com でログイン・許可
   - 「Exchange authorization code for tokens」を押し、**Refresh token** を控える

控えた `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` を後でシークレット登録します。

### 5. マーケットプレイス側のWebhook認証用シークレットを決める

`MARKETPLACE_WEBHOOK_SECRET` は、好きな長いランダム文字列（例: `openssl rand -hex 32` で生成）を決めてください。
Webhook URLは `https://<あなたのworker名>.<サブドメイン>.workers.dev/webhooks/marketplace-sales?secret=<このシークレット>` の形で
マーケットプレイス側のWebhook設定URL欄にそのまま登録します（カスタムヘッダーを設定できる場合は `X-Webhook-Secret` ヘッダーでも可）。

## デプロイ手順

```bash
npm install

# シークレットを1つずつ登録(対話式でペーストを求められます)
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put MARKETPLACE_WEBHOOK_SECRET
npx wrangler secret put DISCORD_SALES_WEBHOOK_URL
npx wrangler secret put DISCORD_INQUIRY_WEBHOOK_URL
npx wrangler secret put DISCORD_REPORT_WEBHOOK_URL
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN

npm run deploy
```

デプロイ後に表示される `https://notion-marketplace-automation.<サブドメイン>.workers.dev` が本番URLです。
マーケットプレイス側のWebhook設定を、元のPipedream URL (`https://eogbj0vxa0vorvy.m.pipedream.net`) から
この新しいURL (`/webhooks/marketplace-sales?secret=...` 付き) に差し替えてください。

## ローカルでの動作確認

```bash
cp .dev.vars.example .dev.vars   # 値を埋める
npm run dev
```

```bash
# Webhookのテスト
curl -X POST "http://localhost:8787/webhooks/marketplace-sales?secret=xxx" \
  -H "Content-Type: application/json" \
  -d '{"acquisitionId":"test-1","customerEmail":"a@example.com","templateName":"テスト","totalCustomerPayment":1000,"event":"purchase"}'

# cronのテスト (--test-scheduled でwrangler devを起動している場合)
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

ログは `npm run tail`（本番）または `wrangler dev` のコンソール出力で確認できます。

## 元ワークフローからの変更点（移行時の確認事項）

- **①イベントラベルの修正**: 元のコードは `purchase` のとき Notionに「返金」、それ以外を「購入」と記録する逆転したバグがありました。
  このWorkerでは `purchase → 購入` / `refund → 返金` に修正しています。元の（逆転した）挙動が必要であれば `marketplaceWebhook.ts` の該当箇所を戻してください。
- **②問い合わせ検知方式の簡略化**: 元はNotionの更新イベントを都度受け取って「ステータスが送信待ちに変わったか」を判定していましたが、
  このWorkerでは5分おきに「現在ステータスが送信待ちの行」を直接検索します。動作結果は同じで、ポーリング間隔中の見落としに対してむしろ堅牢です。
- **③④月次/週次の対象期間計算**: ロジックは同一の結果になるよう書き直しましたが、タイムゾーン計算方法が変わっているため、
  初回実行後はNotionに作成されたレポートの「分析期間」が元の想定と一致しているか一度目視確認してください。

## 動作確認チェックリスト

- [ ] Notion Internal Integrationが3つのデータベースに接続されている
- [ ] 3つのDiscordチャンネルで通知が届く
- [ ] テスト用の問い合わせ行（ステータス=送信待ち）を作って、5分以内に返信メール・ステータス更新・Discord通知が走る
- [ ] マーケットプレイスのテスト購入(またはcurl)でNotion行作成とDiscord通知が走る
- [ ] 月初・週初を待たずに `runWeeklyReport` / `runMonthlyReport` を一時的に手動実行して期間・文言を確認（`wrangler dev --test-scheduled` の `/__scheduled?cron=...` 参照）
- [ ] 上記が全部OKなら、マーケットプレイス側のWebhook URLをPipedreamからこのWorkerに切り替える
- [ ] Pipedream側のワークフローを無効化する
