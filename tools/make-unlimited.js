// index.html から「アイテム無制限版」unlimited.html を作る
// 使い方: node tools/make-unlimited.js
const fs = require("fs");
let s = fs.readFileSync("index.html", "utf8");

function patch(from, to, label) {
  if (!s.includes(from)) throw new Error("パッチ対象が見つかりません: " + label);
  s = s.replace(from, to);
}

// 元のゲームのセーブと混ざらないよう、保存先を分ける
patch('const SAVE_KEY = "mflick-save-v1";', 'const SAVE_KEY = "mflick-save-unlimited-v1";', "SAVE_KEY");
patch("<title>モンスター・フリック</title>", "<title>モンスター・フリック（無制限版）</title>", "title");

// 無制限版でランキングへスコアを送らない
patch('const RANKING = { url: "", key: "" };', 'const RANKING = { url: "", key: "" }; // 無制限版では常に無効', "RANKING");

// config.json の online 設定（Supabase）を読まない → 全国ランキング・スコアアタック・協力レイド・助っ人のオンライン送信を無効にする
patch("if (on.url && on.key) {", "if (false && on.url && on.key) {", "online config");

// ジェム・コイン・結晶を常に満タンにする
const refill = `
// ---- 無制限版: ジェム・コイン・結晶が減らない -----------------------------------
const UNLIMITED = { gems: 9999999, coins: 9999999, cr: 9999, tickets: 9999 };
function refillItems() {
  if (!save) return;
  save.gems = UNLIMITED.gems;
  save.coins = UNLIMITED.coins;
  for (const k of EL_KEYS) save.cr[k] = UNLIMITED.cr;
  save.skinTickets = UNLIMITED.tickets; // 着せ替えチケット
}
`;
patch("function persist() {", refill + "function persist() {\n  refillItems();", "persist");
patch("function update() {\n  frameNo++;", "function update() {\n  refillItems();\n  frameNo++;", "update");
patch("\nloadSave();\n", "\nloadSave();\nrefillItems();\n", "loadSave call");

// 元のサイト用のオフライン設定・ホーム画面追加は使わない
patch('<link rel="manifest" href="manifest.json">', "", "manifest");
patch('navigator.serviceWorker.register("sw.js")', 'Promise.resolve()', "service worker");

fs.writeFileSync("unlimited.html", s);
console.log("unlimited.html を作りました");
