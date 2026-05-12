# Steam 競合・市場分析ダッシュボード

Steam公開情報をもとに、競合タイトルの価格、レビュー、言語構成、推定販売本数、推定売上、現在同時接続者数、AIレビュー分析を確認するWebアプリです。

## セットアップ

```bash
npm install
npm run dev
```

ブラウザで http://localhost:3000 を開きます。

## 環境変数

`.env.local.example` をコピーして `.env.local` を作成できます。

```bash
cp .env.local.example .env.local
```

利用する環境変数:

- `GEMINI_API_KEY`: 開発用フォールバック。商用提供時はユーザーが画面で入力したGemini APIキーを優先します。
- `ITAD_API_KEY`: IsThereAnyDealの過去最安価格取得に使います。未設定でも動作します。
- `SUPABASE_URL`: 軽量メタ情報スナップショットの保存先。未設定なら保存をスキップします。
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase保存用キー。未設定なら保存をスキップします。

## 主な機能

- Steam URLまたはAppIDを最大5件まで分析
- 価格、エディション、過去最安価格の表示
- 総レビュー、Steam購入レビュー、好評率、言語別レビュー集計
- 現在同時接続者数の表示
- Gamalytic公開記事の考え方を参考にした説明可能な販売本数・売上推定
- 総売上とSteam手数料30%控除後売上の表示
- 言語別レビュー件数、言語別好評/不評比率のグラフ表示
- 代表200件または全文圧縮による任意AI分析
- 言語を指定したAIレビュー分析
- 全文レビュー取得後のプレイ時間別好評/不評グラフ
- CSV出力とMarkdownレポート出力

## 売上推定ロジック

売上推定はGamalyticの公開記事で触れられているレビュー倍率法を参考にした独自実装です。Gamalyticの非公開モデルや有料データは使っていません。

標準ケースでは、以下の流れで推定します。

1. 発売経過年数から基準レビュー倍率を決める。
2. 価格帯、好評率、レビュー投稿者の平均プレイ時間サンプルで倍率を補正する。
3. 最終倍率を18から85の範囲に収める。
4. `推定所有者 = 総レビュー数 * 最終レビュー倍率` とする。
5. `推定Steam販売本数 = 推定所有者 * Steam購入レビュー比率` とする。
6. `総売上 = 推定Steam販売本数 * 定価 * 実効価格係数` とする。
7. `手数料控除後売上 = 総売上 * 0.70` とする。

保守、標準、強気の3ケースを表示します。トップセラー順位、公開プロフィールpolling、同時接続者数履歴による推定は予約済みですが、初期実装では重み0です。

## データ保存方針

Supabaseが設定されている場合、分析時に軽量メタ情報だけ保存します。

保存するもの:

- AppID、タイトル名、取得日時
- 価格、レビュー数、Steam購入レビュー数、好評率
- 言語別集計
- 現在同時接続者数
- 推定所有者、推定Steam販売本数、総売上、手数料控除後売上、推定信頼度

保存しないもの:

- レビュー本文
- SteamID
- レビューID
- Gemini APIキー

レビュー本文はCSV出力やAI分析のために一時的にブラウザメモリへ保持します。ページをリロードすると破棄されます。

## Supabaseテーブル例

```sql
create table if not exists game_metric_snapshots (
  id bigserial primary key,
  app_id text not null,
  name text not null,
  captured_at timestamptz not null default now(),
  base_price numeric,
  current_price numeric,
  review_count integer not null,
  steam_purchase_review_count integer not null,
  positive_rate numeric not null,
  language_stats jsonb not null,
  current_players integer,
  estimated_owners integer not null,
  estimated_steam_copies_sold integer not null,
  gross_revenue numeric not null,
  net_revenue_after_steam_fee numeric not null,
  confidence text not null
);
```

## 注意点

- 推定値は実売上ではありません。競合調査用の参考値として扱ってください。
- 無料ゲームのベースゲーム売上は信頼度Lowになります。IAP/DLC売上は対象外です。
- 同時接続者数は現在値のみです。履歴推定はスナップショットが十分に貯まってから追加します。
- 大型タイトルの全文レビュー取得は時間とブラウザメモリを多く使います。
