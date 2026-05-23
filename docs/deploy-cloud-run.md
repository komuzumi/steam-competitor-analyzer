# Cloud Run公開手順

このアプリはCloud Runで公開する前提です。GitHub Pagesのような静的ホスティングでは、Next.jsのAPIルートやSteam取得処理をそのまま動かせません。

## 方針

- 認証なしで公開します。note購入者へのURL案内や販売管理はnote側で行います。
- DBは使いません。
- Gemini APIキーは利用者が画面で入力します。サーバー環境変数には設定しません。
- `ITAD_API_KEY` は任意です。未設定でも基本分析は動きますが、過去最安価格は取得できません。

## Google Cloud側の準備

1. Google Cloudプロジェクトを作成します。
2. Billingを有効化します。
3. 以下のAPIを有効化します。
   - Cloud Run
   - Cloud Build
   - Artifact Registry
4. ローカルでgcloud CLIにログインします。

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

## デプロイ

リポジトリルートで実行します。

```bash
gcloud run deploy steam-competitor-analyzer \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated
```

Cloud Runはコンテナの `PORT` 環境変数を使います。このアプリのDockerfileは `PORT=8080`、`HOSTNAME=0.0.0.0` で起動するように設定済みです。

## 任意の環境変数

ITADの過去最安価格を使う場合だけ設定します。

```bash
gcloud run services update steam-competitor-analyzer \
  --region asia-northeast1 \
  --set-env-vars ITAD_API_KEY=YOUR_ITAD_API_KEY
```

Gemini APIキーは設定しません。利用者がアプリ画面で自分のGemini APIキーを入力します。

## ローカルDocker確認

```bash
docker build -t steam-competitor-analyzer .
docker run --rm -p 8080:8080 steam-competitor-analyzer
```

ブラウザで http://127.0.0.1:8080 を開きます。

## 課金について

Cloud Runは低アクセスなら無料枠内で始められる可能性があります。ただし、外部通信量、Cloud Build、Artifact Registry、アクセス増加、長時間実行で課金が発生する可能性があります。公開前に予算アラートを設定してください。

## 独自ドメイン

Cloud Runのサービス詳細からカスタムドメインをマッピングできます。最初はCloud Runの標準URLで検証し、販売導線が固まってから独自ドメインへ切り替える運用で問題ありません。
