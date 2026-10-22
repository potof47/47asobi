#!/usr/bin/env python3
"""ツムツム自動プレイツール (Android: adb / iPhone: WebDriverAgent)

画面をスクリーンショット → ツムを円検出 → 見た目で種類分け →
同じツムの最長チェーンを探す → 指でなぞる操作を adb で送る。

使い方:
  python3 tsumbot.py --dry-run            # 1回だけ認識して debug.png を出力 (タップしない)
  python3 tsumbot.py                      # 自動プレイ開始 (Ctrl+C で停止)
  python3 tsumbot.py --ios                # iPhone (WebDriverAgent 起動済みであること)
  python3 tsumbot.py --image shot.png     # 保存済みスクショで認識だけ確認
"""
import argparse, subprocess, time, random, sys, json, base64, urllib.request
import cv2, numpy as np


def screencap(serial=None):
    cmd = ["adb"] + (["-s", serial] if serial else []) + ["exec-out", "screencap", "-p"]
    data = subprocess.run(cmd, capture_output=True, check=True).stdout
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("スクリーンショット取得に失敗 (adb接続/USBデバッグを確認)")
    return img


class WDA:
    """iPhone 用: WebDriverAgent (HTTP) 経由でスクショとタッチ操作を行う"""

    def __init__(self, url):
        self.url = url.rstrip("/")
        self.sid = self._req("POST", "/session", {"capabilities": {}})
        self.sid = self.sid.get("sessionId") or self.sid["value"]["sessionId"]
        size = self._req("GET", f"/session/{self.sid}/window/size")["value"]
        self.pw, self.ph = size["width"], size["height"]  # ポイント単位

    def _req(self, method, path, body=None):
        r = urllib.request.Request(self.url + path, method=method,
                                   data=json.dumps(body).encode() if body is not None else None,
                                   headers={"Content-Type": "application/json"})
        return json.load(urllib.request.urlopen(r, timeout=30))

    def screencap(self):
        b = self._req("GET", "/screenshot")["value"]
        return cv2.imdecode(np.frombuffer(base64.b64decode(b), np.uint8), cv2.IMREAD_COLOR)

    def swipe_path(self, path, img_size):
        k = self.pw / img_size[0]  # ピクセル -> ポイント
        pts = [(int(x * k), int(y * k)) for x, y in path]
        acts = [{"type": "pointerMove", "duration": 0, "x": pts[0][0], "y": pts[0][1]},
                {"type": "pointerDown", "button": 0}]
        acts += [{"type": "pointerMove", "duration": 30, "x": x, "y": y} for x, y in pts[1:]]
        acts.append({"type": "pointerUp", "button": 0})
        self._req("POST", f"/session/{self.sid}/actions", {"actions": [
            {"type": "pointer", "id": "finger", "parameters": {"pointerType": "touch"}, "actions": acts}]})


def detect(img, region, rmin, rmax):
    """盤面(region=割合 x0,y0,x1,y1)内のツムを検出 -> [(x,y,r,特徴ベクトル)]"""
    h, w = img.shape[:2]
    x0, y0, x1, y1 = (int(region[0] * w), int(region[1] * h), int(region[2] * w), int(region[3] * h))
    crop = img[y0:y1, x0:x1]
    gray = cv2.medianBlur(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), 5)
    r_lo, r_hi = int(rmin * w), int(rmax * w)
    cs = cv2.HoughCircles(gray, cv2.HOUGH_GRADIENT, dp=1.2, minDist=int(r_lo * 1.5),
                          param1=100, param2=28, minRadius=r_lo, maxRadius=r_hi)
    if cs is None:
        return []
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
    out = []
    for cx, cy, r in cs[0]:
        cx, cy, r = int(cx), int(cy), int(r)
        k = max(int(r * 0.7), 3)
        if cy - k < 0 or cx - k < 0 or cy + k > lab.shape[0] or cx + k > lab.shape[1]:
            continue
        patch = lab[cy - k:cy + k, cx - k:cx + k]
        small = cv2.resize(patch, (6, 6), interpolation=cv2.INTER_AREA).astype(np.float32).ravel()
        out.append((cx + x0, cy + y0, r, small))
    return out


def cluster(tsums, thresh):
    """特徴が近いものを同じ種類にまとめる (leader法)"""
    leaders, labels = [], []
    for *_, f in tsums:
        best, bd = -1, 1e9
        for i, (lf, n) in enumerate(leaders):
            d = np.linalg.norm(f - lf) / np.sqrt(len(f))
            if d < bd:
                best, bd = i, d
        if best >= 0 and bd < thresh:
            lf, n = leaders[best]
            leaders[best] = ((lf * n + f) / (n + 1), n + 1)
            labels.append(best)
        else:
            leaders.append((f, 1))
            labels.append(len(leaders) - 1)
    return labels


def best_chain(tsums, labels, link, tries=40):
    n = len(tsums)
    pos = np.array([(t[0], t[1]) for t in tsums], dtype=np.float32)
    rad = float(np.median([t[2] for t in tsums]))
    adj = [[] for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j and labels[i] == labels[j] and np.linalg.norm(pos[i] - pos[j]) <= rad * link:
                adj[i].append(j)
    best = []
    starts = list(range(n))
    for t in range(tries):
        s = random.choice(starts)
        chain, seen = [s], {s}
        while True:
            cur = chain[-1]
            nxt = [j for j in adj[cur] if j not in seen]
            if not nxt:
                break
            # 近い順 + 少しランダム (行き止まりを減らすため次の候補が少ないものを優先)
            nxt.sort(key=lambda j: (sum(1 for k in adj[j] if k not in seen), random.random()))
            j = nxt[0]
            chain.append(j); seen.add(j)
        if len(chain) > len(best):
            best = chain
    return [(int(pos[i][0]), int(pos[i][1])) for i in best]


def swipe_path(path, step_ms=0, serial=None):
    """複数点をなぞる (Android 12+ の input motionevent を1回のshellで連続実行)"""
    cmds = [f"input motionevent DOWN {path[0][0]} {path[0][1]}"]
    cmds += [f"input motionevent MOVE {x} {y}" for x, y in path[1:]]
    cmds.append(f"input motionevent UP {path[-1][0]} {path[-1][1]}")
    adb = ["adb"] + (["-s", serial] if serial else []) + ["shell", "; ".join(cmds)]
    subprocess.run(adb, check=True)


def annotate(img, tsums, labels, chain, path_out):
    pal = [(0, 0, 255), (0, 200, 0), (255, 0, 0), (0, 200, 255), (255, 0, 255), (255, 255, 0),
           (128, 128, 255), (0, 128, 255), (128, 0, 128), (200, 200, 0)]
    for (x, y, r, _), l in zip(tsums, labels):
        cv2.circle(img, (x, y), r, pal[l % len(pal)], 2)
        cv2.putText(img, str(l), (x - 6, y + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)
    for a, b in zip(chain, chain[1:]):
        cv2.line(img, a, b, (255, 255, 255), 4)
    cv2.imwrite(path_out, img)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ios", metavar="WDA_URL", nargs="?", const="http://localhost:8100",
                    help="iPhone で動かす。WebDriverAgent の URL (省略時 http://localhost:8100)")
    ap.add_argument("--serial", help="adb デバイスのシリアル")
    ap.add_argument("--image", help="adb を使わずこの画像で認識だけ行う")
    ap.add_argument("--dry-run", action="store_true", help="1回認識して debug.png を出力するだけ")
    ap.add_argument("--region", type=float, nargs=4, default=[0.0, 0.30, 1.0, 0.85],
                    metavar=("X0", "Y0", "X1", "Y1"), help="盤面の範囲(画面に対する割合)")
    ap.add_argument("--rmin", type=float, default=0.030, help="ツム半径の最小(画面幅に対する割合)")
    ap.add_argument("--rmax", type=float, default=0.060, help="ツム半径の最大(画面幅に対する割合)")
    ap.add_argument("--same", type=float, default=18.0, help="同じツムとみなす色距離 (小さいほど厳しい)")
    ap.add_argument("--link", type=float, default=2.6, help="つなげられる距離(半径の倍数)")
    ap.add_argument("--min-chain", type=int, default=3)
    ap.add_argument("--wait", type=float, default=0.8, help="1回なぞった後の待ち秒数")
    args = ap.parse_args()

    wda = WDA(args.ios) if args.ios and not args.image else None
    while True:
        img = cv2.imread(args.image) if args.image else (wda.screencap() if wda else screencap(args.serial))
        tsums = detect(img, args.region, args.rmin, args.rmax)
        labels = cluster(tsums, args.same) if tsums else []
        chain = best_chain(tsums, labels, args.link) if tsums else []
        print(f"ツム {len(tsums)}個 / 種類 {len(set(labels))} / チェーン {len(chain)}")
        if args.dry_run or args.image:
            annotate(img.copy(), tsums, labels, chain, "debug.png")
            print("debug.png に認識結果を出力しました")
            return
        if len(chain) >= args.min_chain:
            if wda:
                wda.swipe_path(chain, (img.shape[1], img.shape[0]))
            else:
                swipe_path(chain, serial=args.serial)
        time.sleep(args.wait)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
