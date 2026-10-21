// ストーリー自動周回ツール
//
// 使い方（スマホ・PCどちらも）:
//   1. ゲーム（index.html）をブラウザで開く（ホーム画面まで進めておく）
//   2. 開発者ツールのコンソール、または「ブックマークレット」でこのファイルの中身を実行する
//        PC: F12 → Console にこのファイルの中身を貼り付けて Enter
//        スマホ: tools/auto-story-bookmarklet.txt の1行をブックマークに登録 → ゲームのページで開く
//   3. 画面左上に小さなパネルが出るので、設定して「スタート」
//
// コンソールから直接動かすこともできる:
//   autoStory.start({ mode: "repeat", stage: 12, speed: 8 })
//   autoStory.stop()
//
// オプション:
//   mode     "repeat"  … 同じステージを周回（既定）。stage で番号を指定（1〜400。省略で今の進行の最新）
//            "advance" … クリアしたら次のステージへ進む（toStage まで）
//   stage    開始ステージ（1始まり）。未開放のところは最新の開放済みステージにする
//   toStage  advance の終点（既定 400）
//   count    クリア回数の上限（0 = 無制限）
//   speed    1ターンを何倍速で進めるか（1〜30。既定 6）
//   onFail   "retry" … 全滅したら同じステージをやり直す（既定）/ "stop" … 止める
//   maxFail  連続で全滅したら止める回数（既定 5）
//   useSS    SSが使えるときは撃つ（既定 true）
//
// 注意: ひとりプレイ専用（協力プレイ中は動かない）。放置中はタブを閉じない・画面を消さない。
(() => {
  if (window.autoStory && window.autoStory.stop) window.autoStory.stop();

  const DEF = { mode: "repeat", stage: 0, toStage: 400, count: 0, speed: 6, onFail: "retry", maxFail: 5, useSS: true };
  const BATTLE_STATES = ["aim", "shoot", "enemy", "wave"];

  let cfg = { ...DEF };
  let timer = null;
  let wait = 0;        // 画面が切り替わったあとの待ち（tick数）
  let curId = null;    // いま遊んでいるステージ番号（0始まり）
  let failRun = 0;
  const stats = { clears: 0, fails: 0, startedAt: 0, coins: 0, gems: 0, drops: 0, lastRank: "" };
  let startSnap = null;

  const g = name => (0, eval)(name);   // ゲームの let 変数をグローバルから読む
  const maxUnlocked = () => Math.min(storyProgress(), STORY_COUNT - 1);

  function pickTarget(a) {
    const en = g("enemies").filter(e => !e.dead);
    if (!en.length) return null;
    // 回復役 → ほかの敵 → 爆弾 の順。同じなら近いほう
    const rank = e => (e.kind === "healer" ? 0 : e.kind === "bomb" ? 2 : 1);
    en.sort((p, q) => rank(p) - rank(q) || Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
    return en[0];
  }

  function aimAt(a, e) {
    let tx = e.x, ty = e.y;
    // 弱点が自分の側を向いているなら、弱点に当たる位置を狙う
    if (e.weak !== null && e.weak !== undefined) {
      const wx = Math.cos(e.weak), wy = Math.sin(e.weak);
      const ux = a.x - e.x, uy = a.y - e.y, ul = Math.hypot(ux, uy) || 1;
      if ((ux * wx + uy * wy) / ul > 0.3) { tx = e.x + wx * e.r * 0.55; ty = e.y + wy * e.r * 0.55; }
    }
    const dx = tx - a.x, dy = ty - a.y, len = Math.hypot(dx, dy) || 1;
    return { dx: dx / len, dy: dy / len };
  }

  function takeTurn() {
    const a = g("allies")[g("cur")];
    if (!a) return;
    const e = pickTarget(a);
    if (!e) return;
    const { dx, dy } = aimAt(a, e);
    ssArmed = cfg.useSS && a.ssLeft === 0;
    fire(dx, dy);
  }

  function begin(id) {
    curId = id;
    wait = 6;
    startQuest("s" + id);
    if (g("state") !== "aim") {
      // 編成の問題などで始められなかった
      status("開始できません（編成を確認してください）");
      stop();
    }
  }

  function nextStage() {
    if (cfg.mode === "advance" && curId + 1 < Math.min(cfg.toStage, STORY_COUNT) && storyUnlocked(curId + 1)) return curId + 1;
    return curId;
  }

  function onClear() {
    stats.clears++;
    failRun = 0;
    const r = g("lastResult");
    if (r) { stats.coins += r.coin || 0; stats.gems += r.gem || 0; stats.drops += r.drop ? 1 : 0; stats.lastRank = r.rank || ""; }
    if (cfg.count && stats.clears >= cfg.count) { status(`完了: ${stats.clears}回クリア`); stop(); return; }
    if (cfg.mode === "advance" && curId + 1 >= Math.min(cfg.toStage, STORY_COUNT)) { status("終点のステージまで到達しました"); stop(); return; }
    begin(nextStage());
  }

  function onFail() {
    stats.fails++;
    failRun++;
    if (cfg.onFail === "stop" || failRun >= cfg.maxFail) {
      status(`全滅が続いたので停止（${failRun}回連続）。キャラを強化してからもう一度どうぞ`);
      stop();
      return;
    }
    begin(curId);
  }

  function tick() {
    try {
      if (g("coop").inBattle) { status("協力プレイ中は動きません"); stop(); return; }
      if (g("talk")) { talk = null; return; }   // ストーリーの会話は閉じる
      if (wait > 0) { wait--; return; }
      const s = g("state");
      // 倍速: 戦闘中は update() を追加で回す（描画は通常どおり）
      if (BATTLE_STATES.includes(s)) {
        for (let i = 1; i < cfg.speed; i++) {
          update();
          const t = g("state");
          if (t === "aim" || t === "clear" || t === "over") break;
        }
      }
      const st = g("state");
      if (st === "aim") takeTurn();
      else if (st === "clear") { wait = 4; onClear(); }
      else if (st === "over") { wait = 4; onFail(); }
      else if (!BATTLE_STATES.includes(st)) begin(curId);   // ホームなどに戻っていたら再開
      render();
    } catch (err) {
      console.error("[autoStory]", err);
      status("エラー: " + err.message);
      stop();
    }
  }

  // ---- パネル -------------------------------------------------------------
  let panel = null, msgEl = null;
  function status(t) { if (msgEl) msgEl.textContent = t; console.log("[autoStory] " + t); }
  function render() {
    if (!msgEl || !timer) return;
    const sec = Math.round((Date.now() - stats.startedAt) / 1000);
    msgEl.textContent = `周回中 ${curId + 1}話目 / クリア ${stats.clears}回 / 全滅 ${stats.fails}回 / ${Math.floor(sec / 60)}分${sec % 60}秒`
      + ` / コイン+${stats.coins.toLocaleString()} ジェム+${stats.gems}`;
  }
  function buildPanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.style.cssText = "position:fixed;left:6px;top:6px;z-index:99999;background:rgba(10,14,40,.92);color:#fff;font:12px sans-serif;"
      + "padding:8px;border:1px solid #ffd35c;border-radius:8px;max-width:230px;line-height:1.5";
    panel.innerHTML = `<b style="color:#ffd35c">ストーリー自動周回</b>
      <div>モード <select data-k="mode"><option value="repeat">同じ話を周回</option><option value="advance">次の話へ進む</option></select></div>
      <div>開始の話 <input data-k="stage" type="number" min="0" max="400" value="0" style="width:56px"> <small>(0=最新)</small></div>
      <div>終点の話 <input data-k="toStage" type="number" min="1" max="400" value="400" style="width:56px"></div>
      <div>回数 <input data-k="count" type="number" min="0" value="0" style="width:56px"> <small>(0=無制限)</small></div>
      <div>倍速 <input data-k="speed" type="number" min="1" max="30" value="6" style="width:46px"></div>
      <div><label><input data-k="onFail" type="checkbox" checked> 全滅したらやり直す</label></div>
      <div><button data-a="go">スタート</button> <button data-a="stop">ストップ</button> <button data-a="hide">▲</button></div>
      <div data-m style="color:#cfd6ff;margin-top:4px">待機中</div>`;
    document.body.appendChild(panel);
    msgEl = panel.querySelector("[data-m]");
    panel.addEventListener("pointerdown", ev => ev.stopPropagation());
    panel.addEventListener("click", ev => {
      const a = ev.target.dataset.a;
      if (a === "go") {
        const v = k => panel.querySelector(`[data-k=${k}]`);
        start({
          mode: v("mode").value, stage: +v("stage").value, toStage: +v("toStage").value || 400,
          count: +v("count").value, speed: +v("speed").value || 6, onFail: v("onFail").checked ? "retry" : "stop",
        });
      } else if (a === "stop") { stop(); status("停止しました"); }
      else if (a === "hide") panel.style.display = "none";
    });
  }

  // ---- 開始・停止 -----------------------------------------------------------
  function start(opt = {}) {
    stop();
    cfg = { ...DEF, ...opt };
    cfg.speed = Math.max(1, Math.min(30, cfg.speed | 0 || 1));
    if (!g("save")) { console.warn("[autoStory] ゲームのセーブが読み込まれていません"); return; }
    const top = maxUnlocked();
    // 開始ステージ: 指定があればその話（未開放なら最新の開放済み）、なければ最新
    let id = cfg.stage > 0 ? Math.min(cfg.stage - 1, top) : top;
    if (!storyUnlocked(id)) id = top;
    Object.assign(stats, { clears: 0, fails: 0, coins: 0, gems: 0, drops: 0, lastRank: "", startedAt: Date.now() });
    failRun = 0;
    timer = setInterval(tick, 40);
    begin(id);
    status(`スタート: ${id + 1}話目 (${cfg.mode === "advance" ? "進む" : "周回"}, ${cfg.speed}倍速)`);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  buildPanel();
  window.autoStory = { start, stop, stats, get config() { return cfg; } };
  console.log("[autoStory] 準備OK。パネルの「スタート」か autoStory.start({...}) で開始");
})();
