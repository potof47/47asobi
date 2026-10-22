# tsumbot — ツムツム自動プレイ (Android + adb)

## 準備
1. Android 端末で「開発者向けオプション → USBデバッグ」をON、PCにつなぐ (`adb devices` で見えること)
2. `pip install opencv-python-headless numpy`
3. 端末は Android 12 以上 (`input motionevent` を使用)

## 使い方
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
