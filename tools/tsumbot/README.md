# tsumbot — ツムツム自動プレイ (Android / iPhone)

## 準備
1. Android 端末で「開発者向けオプション → USBデバッグ」をON、PCにつなぐ (`adb devices` で見えること)
2. `pip install opencv-python-headless numpy`
3. 端末は Android 12 以上 (`input motionevent` を使用)

## iPhone で使う
iPhone には adb がないため、WebDriverAgent (WDA) 経由で画面取得とタッチ操作を行います (脱獄不要・Mac 推奨)。
1. Mac に Xcode を入れ、[WebDriverAgent](https://github.com/appium/WebDriverAgent) を自分の Apple ID で署名して iPhone にインストール
   (設定 → 一般 → VPNとデバイス管理 で信頼、設定 → プライバシーとセキュリティ → デベロッパモード ON)
2. WDA を起動して PC の 8100 番に転送する。例: `pip install tidevice && tidevice wdaproxy -B <WDAのBundleID> --port 8100`
   (または `go-ios` の `ios runwda` + `ios forward 8100 8100`)
3. ツムツムを開いてプレイ画面にして実行:
```
python3 tsumbot.py --ios --dry-run   # 認識確認 (debug.png)
python3 tsumbot.py --ios             # 自動プレイ
```
無料 Apple ID の署名は7日で切れるので再インストールが必要です。

## 使い方 (Android)
```
python3 tsumbot.py --dry-run     # 認識だけ。debug.png を見て調整
python3 tsumbot.py               # 自動プレイ (Ctrl+C で停止)
```
ゲーム画面を開いてプレイ中の状態で実行します。

## 調整 (debug.png を見ながら)
- ツムを拾えていない → `--rmin/--rmax` (ツム半径/画面幅)、`--region`(盤面範囲)
- 違うツムが同じ番号になる → `--same` を小さく / 同じツムが別番号 → 大きく
- つながらない → `--link` を大きく

## 注意
- 未検証の雛形です。実機の画面に合わせた調整が必要です。
- 自動操作は LINE のサービス利用規約に反する可能性があり、アカウント制限のリスクがあります。自己責任で。
