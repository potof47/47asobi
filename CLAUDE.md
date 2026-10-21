# このリポジトリで作業するときのルール

- `index.html`（本編）を変更したら、必ず `node tools/make-unlimited.js` を実行して
  `unlimited.html`（アイテム無制限版）も同じコミットに含めること。
- 本編に新しい通貨・チケットなどの消費アイテムを足したら、`tools/make-unlimited.js` の
  `refillItems()` にも追加すること。
- 本編に新しいオンライン通信（Supabase など）を足したら、無制限版から本番サーバーへ
  送信されないことを確認すること（現在は `config.json` の online 設定を読まないことで無効化）。
- `.github/workflows/sync-unlimited.yml` が、`index.html` の更新時に `unlimited.html` を自動で作り直す。
