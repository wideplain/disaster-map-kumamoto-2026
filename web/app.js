"use strict";

/* ===========================================================
   指標定義
   =========================================================== */

// 実データは「未集計の列はキーごと省略」されることがある（値が明示的な
// null ではなく undefined になる）。undefined を null に正規化しないまま
// テンプレートリテラルに渡すと "undefined" という文字列がそのまま画面に
// 出てしまうため、値を読み出す入口はすべてこの関数を通す
function numOrNull(v) {
  return typeof v === "number" ? v : null;
}

function sumOrNull(...vals) {
  const known = vals.filter((v) => v !== null && v !== undefined);
  if (known.length === 0) return null;
  return vals.reduce((acc, v) => acc + (v === null || v === undefined ? 0 : v), 0);
}

// components を持つ指標は複数フィールドの合算値。一部だけnullの市町村がある場合、
// 既知分だけの合計を値として扱い（sumOrNullの挙動どおり）、UI側では
// 「不明分あり」の注記を出す判断材料として components を使う
const METRICS = [
  { key: "evacuees", label: "避難者数", unit: "人", color: "#1baf7a",
    summaryKey: "evacuees", get: (m) => (m ? numOrNull(m.evacuees) : null) },
  { key: "shelters", label: "避難所数", unit: "カ所", color: "#008300",
    summaryKey: "shelters", get: (m) => (m ? numOrNull(m.shelters) : null) },
  { key: "deaths", label: "死者数", unit: "人", color: "#e34948",
    summaryKey: "deaths", get: (m) => (m ? numOrNull(m.deaths) : null) },
  { key: "injured", label: "負傷者数", unit: "人", color: "#e87ba4",
    summaryKey: "injured", components: ["injured_light", "injured_moderate", "injured_severe"],
    get: (m) => (m ? sumOrNull(m.injured_light, m.injured_moderate, m.injured_severe) : null) },
  { key: "houses", label: "住家被害", unit: "棟", color: "#eb6834",
    summaryKey: "houses", components: ["houses_full", "houses_large_half", "houses_half", "houses_partial", "houses_unclassified"],
    get: (m) => (m ? sumOrNull(m.houses_full, m.houses_large_half, m.houses_half, m.houses_partial, m.houses_unclassified) : null) },
  { key: "water_outage", label: "断水戸数", unit: "戸", color: "#2a78d6",
    summaryKey: "water_outage", get: (m) => (m ? numOrNull(m.water_outage) : null) },
  { key: "water_stations", label: "給水所数", unit: "カ所", color: "#4a3aa7",
    get: (m) => (m ? numOrNull(m.water_stations) : null) },
  { key: "power_outage", label: "停電戸数", unit: "戸", color: "#eda100",
    get: (m) => (m ? numOrNull(m.power_outage) : null) },
];

function metricByKey(key) {
  return METRICS.find((m) => m.key === key);
}

// 一部成分だけnullの「既知分のみの合計」かどうか（全部null=データなしとは区別する）
function hasUnknownComponent(metric, rec) {
  if (!metric.components || !rec) return false;
  const values = metric.components.map((f) => rec[f]);
  const hasNull = values.some((v) => v === null || v === undefined);
  const hasNumber = values.some((v) => typeof v === "number");
  return hasNull && hasNumber;
}

// 指標の値を表示用に整形する。負傷者数・住家被害のように一部成分が不明な
// 場合は合計値に「（ほか不明分あり）」を付けて、既知分のみの合計であることを示す
function formatMetricValue(metric, rec) {
  const val = metric.get(rec);
  if (val === null || val === undefined) return "データなし";
  const base = `${formatNumber(val)}${metric.unit}`;
  return hasUnknownComponent(metric, rec) ? `${base}（ほか不明分あり）` : base;
}

// water_outage_max（ピーク時断水戸数）と water_outage（現在値）は別の報から
// とられていることがあり、集計時点のズレで max < 現在値 になることがある。
// その場合は矛盾して見えるため、ピーク値そのものを表示しない
function isWaterPeakValid(rec) {
  return (
    !!rec &&
    typeof rec.water_outage === "number" &&
    typeof rec.water_outage_max === "number" &&
    rec.water_outage_max >= rec.water_outage
  );
}

/* ===========================================================
   状態
   =========================================================== */

let map = null;
let muniData = null;
let data = null;

const state = {
  metric: "evacuees",
  snapshotIndex: 0,
  selected: null,
  playTimer: null,
  globalMaxCache: {},
  top5: [],
  allCircles: [],
};

// prefers-reduced-motion: CSSのtransitionはメディアクエリ側で止まるが、
// MapLibreの円のアニメーション(paintのtransition)とflyToのカメラ移動は
// JS側の設定なので、ここを見てduration/speedを0にする必要がある
const REDUCED_MOTION = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;
const CIRCLE_TRANSITION = REDUCED_MOTION ? { duration: 0, delay: 0 } : { duration: 500, delay: 0 };

function currentSnapshot() {
  return data.snapshots[state.snapshotIndex];
}
function getCurrentMetric() {
  return metricByKey(state.metric);
}

/* ===========================================================
   日時（Asia/Tokyo固定で文字列から直接読み取る）
   実行環境のローカルタイムゾーンに依存させないため Date のローカル変換は使わない
   =========================================================== */

function parseJST(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

function weekdayJa(y, mo, d) {
  return WEEKDAY_JA[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateTimeJa(iso) {
  const p = parseJST(iso);
  return `${p.mo}月${p.d}日（${weekdayJa(p.y, p.mo, p.d)}）${pad2(p.h)}:${pad2(p.mi)}時点`;
}

function formatNumber(v) {
  return typeof v === "number" ? v.toLocaleString("ja-JP") : v;
}

/* ===========================================================
   円の半径スケール
   =========================================================== */

const RADIUS_MIN = 4;
const RADIUS_MAX = 46;
const RADIUS_ZERO = 2;

function valueToRadius(value, max) {
  if (!max || max <= 0) return RADIUS_MIN;
  const t = Math.sqrt(Math.max(0, value) / max);
  return RADIUS_MIN + t * (RADIUS_MAX - RADIUS_MIN);
}

// 時点をまたいで同じスケールを使うことで、スライダー操作時の円の伸縮が
// 実際の増減として正しく読めるようにする（時点ごとの正規化だと誤読を招く）
function getGlobalMax(key) {
  if (state.globalMaxCache[key] !== undefined) return state.globalMaxCache[key];
  const metric = metricByKey(key);
  let max = 0;
  data.snapshots.forEach((s) => {
    Object.values(s.municipalities).forEach((rec) => {
      const v = metric.get(rec);
      if (typeof v === "number" && v > max) max = v;
    });
  });
  state.globalMaxCache[key] = max;
  return max;
}

function toNiceNumber(n) {
  if (n <= 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / mag;
  let nice;
  if (norm < 1.5) nice = 1;
  else if (norm < 3.5) nice = 2;
  else if (norm < 7.5) nice = 5;
  else nice = 10;
  return nice * mag;
}

function hexToRgba(hex, alpha) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ===========================================================
   GeoJSON 構築
   =========================================================== */

function buildGeoJSON(snapshot, metric, globalMax) {
  const features = [];
  for (const name of Object.keys(muniData)) {
    const rec = snapshot.municipalities[name];
    if (!rec) continue; // この時点では未集計・対象外の市町村
    const value = metric.get(rec);
    if (value === null || value === undefined) continue; // null は非表示
    const isZero = value === 0;
    const radius = isZero ? RADIUS_ZERO : valueToRadius(value, globalMax);
    const color = isZero ? "#898781" : metric.color;
    const loc = muniData[name];
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [loc.lng, loc.lat] },
      properties: {
        name,
        value,
        radius,
        color,
        fillOpacity: isZero ? 0 : 0.5,
        strokeWidth: isZero ? 1.5 : 2,
        hitRadius: Math.max(radius + 10, 18),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/* ===========================================================
   地図初期化
   =========================================================== */

function initMap() {
  map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        pale: {
          type: "raster",
          tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 18,
          attribution:
            '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
        },
      },
      layers: [{ id: "pale", type: "raster", source: "pale" }],
    },
    center: [130.9, 32.6],
    zoom: 8.5,
    minZoom: 6,
    maxZoom: 18,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", onMapLoad);
}

function onMapLoad() {
  map.addSource("municipalities", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "circle-fill",
    type: "circle",
    source: "municipalities",
    paint: {
      "circle-radius": ["get", "radius"],
      "circle-color": ["get", "color"],
      "circle-opacity": ["get", "fillOpacity"],
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": ["get", "strokeWidth"],
      "circle-radius-transition": CIRCLE_TRANSITION,
      "circle-opacity-transition": CIRCLE_TRANSITION,
      "circle-stroke-width-transition": CIRCLE_TRANSITION,
    },
  });

  map.addLayer({
    id: "circle-ring",
    type: "circle",
    source: "municipalities",
    paint: {
      "circle-radius": ["+", ["get", "radius"], 1.5],
      "circle-opacity": 0,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
      "circle-stroke-opacity": ["case", ["==", ["get", "fillOpacity"], 0], 0, 1],
      "circle-radius-transition": CIRCLE_TRANSITION,
    },
  });

  // クリック・ホバー判定用に見た目より大きい透明レイヤーを重ねる（小さい円は指/カーソルで拾いにくいため）
  map.addLayer({
    id: "circle-hit",
    type: "circle",
    source: "municipalities",
    paint: {
      "circle-radius": ["get", "hitRadius"],
      "circle-opacity": 0,
      "circle-stroke-opacity": 0,
    },
  });

  addEpicenterMarker();

  map.on("mouseenter", "circle-hit", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "circle-hit", () => {
    map.getCanvas().style.cursor = "";
    hideTooltip();
  });
  map.on("mousemove", "circle-hit", (e) => {
    if (e.features && e.features.length) showTooltip(e.features[0], e.lngLat);
  });
  map.on("click", "circle-hit", (e) => {
    if (e.features && e.features.length) selectMunicipality(e.features[0].properties.name);
  });

  map.on("move", layoutOverlayLabels);

  renderAll();
}

function addEpicenterMarker() {
  const ll = data.event.epicenter_latlng;
  if (!ll) return;
  const el = document.createElement("div");
  el.className = "epicenter-marker";
  el.innerHTML = '<div class="epicenter-mark">×</div><div class="epicenter-label">震央</div>';
  new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([ll[1], ll[0]]).addTo(map);
}

function flyToMuni(name) {
  const loc = muniData[name];
  if (!loc) return;
  const center = [loc.lng, loc.lat];
  const zoom = Math.max(map.getZoom(), 10.3);
  if (REDUCED_MOTION) map.jumpTo({ center, zoom });
  else map.flyTo({ center, zoom, speed: 0.9 });
}

/* ===========================================================
   ツールチップ
   =========================================================== */

const tooltipPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 });

function showTooltip(feature, lngLat) {
  const name = feature.properties.name;
  const rec = currentSnapshot().municipalities[name];
  if (!rec) return;
  const metric = getCurrentMetric();
  const others = ["evacuees", "deaths", "water_outage"].filter((k) => k !== metric.key).slice(0, 2);
  const mainLine = `${metric.label}: <strong>${formatMetricValue(metric, rec)}</strong>`;
  const subLines = others
    .map((k) => {
      const m = metricByKey(k);
      const v = m.get(rec);
      return `<span>${m.label} ${typeof v === "number" ? formatMetricValue(m, rec) : "—"}</span>`;
    })
    .join("");
  const html = `<div class="tooltip-name">${name}</div><div class="tooltip-main">${mainLine}</div><div class="tooltip-sub">${subLines}</div>`;
  tooltipPopup.setLngLat(lngLat).setHTML(html).addTo(map);
}

function hideTooltip() {
  tooltipPopup.remove();
}

/* ===========================================================
   上位5市町村の直接ラベル（HTMLオーバーレイ・衝突回避つき）

   実データでは隣接市町村（宇城市/氷川町/八代市/宇土市など10〜30km圏)が
   密集するため、単純に円の直下へラベルを置くと円やラベル同士が重なる。
   値の大きい順に「円の右→左→上→下」の候補位置を試し、既に置いたラベルの
   矩形および全市町村の円の矩形のどちらとも重ならない最初の候補を採用する。
   全候補が衝突する場合はそのラベルだけ非表示にする（円とホバーは残す）。

   フォント表示を system-ui に統一しグリフ配信への依存を避けるため
   MapLibreのsymbolレイヤーではなくDOM要素で描画する。
   =========================================================== */

// フォントサイズはCSSの .map-label と揃える（可読性の最低ライン13pxに統一）
const LABEL_H = 20;
const LABEL_PAD_X = 5;
const LABEL_GAP = 6;
const LABEL_FONT = '700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif';

let _measureCtx; // undefined = not yet resolved, null = unavailable (fallback estimate)

// canvas.measureText は「実測」に近い幅が取れるが、DOMを持たないテスト環境
// (Node vm ハーネス)でも同じ衝突回避ロジックを検証できるよう、canvasが
// 無ければ文字種ごとの概算幅にフォールバックする。フォールバックは実際の
// 描画幅よりわずかに広めに見積もり、衝突判定を安全側に倒す。
function measureLabelWidth(text) {
  if (_measureCtx === undefined) {
    try {
      const c = document.createElement("canvas");
      _measureCtx = (c.getContext && c.getContext("2d")) || null;
      if (_measureCtx) _measureCtx.font = LABEL_FONT;
    } catch (e) {
      _measureCtx = null;
    }
  }
  if (_measureCtx) return _measureCtx.measureText(text).width;

  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += 5.3; // 13px基準（LABEL_FONTと同じサイズ）に再較正
    else if (/[　-鿿＀-￯]/.test(ch)) w += 14.2; // 全角・漢字・かな
    else w += 8.9; // 半角英数字
  }
  return w;
}

function rectsOverlap(a, b) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

// projectFn(lng,lat) -> {x,y} を差し替え可能にしておくことで、
// ブラウザでは map.project、Nodeテストでは自前のメルカトル投影を使い回せる
function computeLabelLayout(topItems, allCircles, projectFn) {
  const circleBoxes = allCircles.map((c) => {
    const p = projectFn(c.lng, c.lat);
    return { name: c.name, x1: p.x - c.radius, y1: p.y - c.radius, x2: p.x + c.radius, y2: p.y + c.radius };
  });

  const placedBoxes = [];
  const results = [];

  topItems.forEach((item) => {
    const p = projectFn(item.lng, item.lat);
    const w = measureLabelWidth(item.text) + LABEL_PAD_X * 2;
    const h = LABEL_H;
    const gap = item.radius + LABEL_GAP;
    const candidates = [
      { x: p.x + gap, y: p.y - h / 2 }, // 右
      { x: p.x - gap - w, y: p.y - h / 2 }, // 左
      { x: p.x - w / 2, y: p.y - gap - h }, // 上
      { x: p.x - w / 2, y: p.y + gap }, // 下
    ];

    let chosen = null;
    for (const c of candidates) {
      const box = { x1: c.x, y1: c.y, x2: c.x + w, y2: c.y + h };
      const hitsCircle = circleBoxes.some((cb) => cb.name !== item.name && rectsOverlap(box, cb));
      const hitsLabel = placedBoxes.some((pb) => rectsOverlap(box, pb));
      if (!hitsCircle && !hitsLabel) {
        chosen = box;
        break;
      }
    }

    if (chosen) {
      placedBoxes.push(chosen);
      results.push({ name: item.name, text: item.text, x: chosen.x1, y: chosen.y1, w, h, visible: true });
    } else {
      results.push({ name: item.name, text: item.text, visible: false });
    }
  });

  return results;
}

function updateTop5(features, metric) {
  const withVal = features.map((f) => ({
    name: f.properties.name,
    value: f.properties.value,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    radius: f.properties.radius,
  }));
  withVal.sort((a, b) => b.value - a.value);
  state.top5 = withVal.slice(0, 5).map((item) => ({
    ...item,
    text: `${item.name} ${formatNumber(item.value)}${metric.unit}`,
  }));
  state.allCircles = withVal; // 衝突判定は上位5だけでなく全円が対象
  layoutOverlayLabels();
}

// パン・ズーム・時点/指標切替のたびに呼ばれる。円同士の画面上の相対距離は
// ズームで変わるため、位置決めではなく毎回レイアウトをやり直す
function layoutOverlayLabels() {
  if (!map || !state.top5.length) {
    renderLabelDom([]);
    return;
  }
  const placements = computeLabelLayout(state.top5, state.allCircles, (lng, lat) => map.project([lng, lat]));
  renderLabelDom(placements);
}

function renderLabelDom(placements) {
  const el = document.getElementById("overlay-labels");
  el.innerHTML = "";
  placements.forEach((p) => {
    if (!p.visible) return;
    const div = document.createElement("div");
    div.className = "map-label";
    div.style.left = p.x + "px";
    div.style.top = p.y + "px";
    div.style.width = p.w + "px";
    div.style.height = p.h + "px";
    div.textContent = p.text;
    el.appendChild(div);
  });
}

/* ===========================================================
   統計ヘッダー（県合計）
   =========================================================== */

// 円は市町村ごとの座標を持つデータのみを描くため、pref が熊本県以外の
// 市町村（隣接県の参考掲載分）は「熊本県合計」の代替合算には含めない
function isKumamotoMuni(name) {
  const loc = muniData[name];
  return !!loc && loc.pref === "熊本県";
}

function sumAcrossMuniOrNull(snapshot, metric) {
  const vals = Object.entries(snapshot.municipalities)
    .filter(([name]) => isKumamotoMuni(name))
    .map(([, rec]) => metric.get(rec))
    .filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0);
}

// snapshot.extras には「市町村に紐づかない」死者・負傷者（関連死調査中/疑い、
// 身元不明者）が入る。県合計（summary）には含まれるが地図の円（市町村別）
// には反映しようがないため、両者の合計が最大で extras の人数分ずれる。
// スタット表示の下にその内訳を注記して不一致の理由を明示する
function buildExtrasNote(metricKey, extras) {
  if (!extras) return null;
  const parts = [];

  if (metricKey === "deaths") {
    if (typeof extras.deaths_related_investigating === "number" && extras.deaths_related_investigating > 0) {
      parts.push(`関連死調査中${formatNumber(extras.deaths_related_investigating)}人`);
    }
    if (typeof extras.deaths_related_possible === "number" && extras.deaths_related_possible > 0) {
      parts.push(`関連死疑い${formatNumber(extras.deaths_related_possible)}人`);
    }
    const u = extras.unidentified_remains;
    if (u && typeof u.deaths === "number" && u.deaths > 0) {
      parts.push(`身元不明${formatNumber(u.deaths)}人`);
    }
  } else if (metricKey === "injured") {
    const u = extras.unidentified_remains;
    if (u) {
      const bits = [];
      if (typeof u.injured_light === "number" && u.injured_light > 0) bits.push(`軽傷${formatNumber(u.injured_light)}人`);
      if (typeof u.injured_moderate === "number" && u.injured_moderate > 0) bits.push(`中等症${formatNumber(u.injured_moderate)}人`);
      if (typeof u.injured_severe === "number" && u.injured_severe > 0) bits.push(`重症${formatNumber(u.injured_severe)}人`);
      if (bits.length) parts.push(`身元不明者${bits.join("・")}`);
    }
  }

  if (!parts.length) return null;
  return `※うち市町村未確定: ${parts.join("・")}`;
}

function updateStatHeader(snapshot, metric) {
  let total = null;
  const summaryVal = metric.summaryKey && snapshot.summary ? snapshot.summary[metric.summaryKey] : undefined;
  if (typeof summaryVal === "number") {
    total = summaryVal;
  } else {
    total = sumAcrossMuniOrNull(snapshot, metric); // 熊本県の市町村のみを合算
  }
  document.getElementById("stat-label").textContent = `熊本県合計 - ${metric.label}`;
  document.getElementById("stat-value").textContent = total === null ? "データなし" : formatNumber(total);
  document.getElementById("stat-unit").textContent = total === null ? "" : metric.unit;

  const noteEl = document.getElementById("stat-extras-note");
  if (noteEl) {
    const note = buildExtrasNote(metric.key, snapshot.extras);
    noteEl.textContent = note || "";
    noteEl.style.display = note ? "" : "none";
  }
}

/* ===========================================================
   ランキング
   =========================================================== */

// 熊本県以外の市町村（隣接県の参考掲載分）だとひと目でわかるよう県名バッジを付ける
function prefBadgeHtml(name) {
  const loc = muniData[name];
  if (!loc || loc.pref === "熊本県") return "";
  return `<span class="pref-badge">${loc.pref}</span>`;
}

function updateRanking(snapshot, metric) {
  const rows = Object.keys(muniData)
    .map((name) => ({ name, value: snapshot.municipalities[name] ? metric.get(snapshot.municipalities[name]) : null }))
    .filter((r) => typeof r.value === "number")
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const maxV = rows.length ? rows[0].value : 0;

  const listEl = document.getElementById("ranking-list");
  listEl.innerHTML = "";
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.tabIndex = 0;
    li.dataset.name = r.name;
    if (state.selected === r.name) li.classList.add("is-selected");
    const barPct = maxV ? (r.value / maxV) * 100 : 0;
    li.innerHTML = `
      <span class="rank-no">${i + 1}</span>
      <span class="rank-name">${r.name}</span>${prefBadgeHtml(r.name)}
      <span class="rank-bar-wrap"><span class="rank-bar" style="width:${barPct}%;background:${metric.color}"></span></span>
      <span class="rank-value tabular">${formatNumber(r.value)}</span>`;
    const onActivate = () => {
      flyToMuni(r.name);
      selectMunicipality(r.name);
    };
    li.addEventListener("click", onActivate);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    });
    listEl.appendChild(li);
  });
}

function updateRankingSelectionHighlight() {
  document.querySelectorAll(".ranking-list li").forEach((li) => {
    li.classList.toggle("is-selected", li.dataset.name === state.selected);
  });
}

/* ===========================================================
   凡例
   =========================================================== */

function updateLegend(metric, globalMax) {
  document.getElementById("legend-title").textContent = `円の大きさ（${metric.label}）`;
  const raw = [globalMax, globalMax * 0.35, globalMax * 0.1].map(toNiceNumber);
  const steps = [...new Set(raw.filter((v) => v > 0))].sort((a, b) => b - a).slice(0, 3);

  const wrap = document.getElementById("legend-circles");
  wrap.innerHTML = "";
  if (!steps.length) {
    wrap.textContent = "データなし";
  } else {
    steps.forEach((v) => {
      const r = valueToRadius(v, globalMax);
      const item = document.createElement("div");
      item.className = "legend-circle-item";
      const circle = document.createElement("div");
      circle.className = "legend-circle";
      circle.style.width = r * 2 + "px";
      circle.style.height = r * 2 + "px";
      circle.style.borderColor = metric.color;
      circle.style.background = hexToRgba(metric.color, 0.18);
      const label = document.createElement("div");
      label.className = "tabular";
      label.textContent = formatNumber(v);
      item.appendChild(circle);
      item.appendChild(label);
      wrap.appendChild(item);
    });
  }

  const noteEl = document.getElementById("legend-note");
  if (noteEl) noteEl.textContent = "小さな中空の点 = 0（報告あり）／表示なし = 未報告";
}

/* ===========================================================
   詳細パネル
   =========================================================== */

function selectMunicipality(name) {
  state.selected = name;
  renderDetail();
  updateRankingSelectionHighlight();
  setPanelOpen("right", true);
}

function renderDetail() {
  const contentEl = document.getElementById("detail-content");
  const name = state.selected;
  if (!name) {
    contentEl.innerHTML =
      '<div class="detail-empty">地図の円、または左の一覧の市町村をクリックすると詳細が表示されます。</div>';
    return;
  }

  const snapshot = currentSnapshot();
  const rec = snapshot.municipalities[name];
  const loc = muniData[name];
  const prevSnapshot = data.snapshots[state.snapshotIndex - 1];
  const prevRec = prevSnapshot ? prevSnapshot.municipalities[name] : null;

  // パネルを閉じるボタンは常設の panel-head 側（detail-panel-close）にあるため、
  // ここでは市町村名と県バッジだけを出す
  let html = `<div class="detail-head"><h3>${name}</h3><span class="detail-chip">${loc ? loc.pref : ""}</span></div>`;

  if (!rec) {
    html += '<div class="detail-empty">この時点のデータはありません。</div>';
    contentEl.innerHTML = html;
    return;
  }

  html += '<ul class="detail-metrics">';
  METRICS.forEach((m) => {
    const val = m.get(rec);
    const prevVal = prevRec ? m.get(prevRec) : null;
    let deltaHtml = '<span class="dm-delta flat">—</span>';
    if (typeof val === "number" && typeof prevVal === "number") {
      const diff = val - prevVal;
      if (diff > 0) deltaHtml = `<span class="dm-delta up">▲${formatNumber(diff)}</span>`;
      else if (diff < 0) deltaHtml = `<span class="dm-delta down">▼${formatNumber(Math.abs(diff))}</span>`;
      else deltaHtml = '<span class="dm-delta flat">±0</span>';
    }
    const isCurrent = m.key === state.metric;
    const unknownNote = hasUnknownComponent(m, rec) ? "（ほか不明分あり：一部の内訳が未報告のため既知分のみの合計）" : null;
    html += `<li class="${isCurrent ? "is-current" : ""}">
      <div class="dm-row">
        <span class="dm-dot" style="background:${m.color}"></span>
        <span class="dm-label">${m.label}</span>
        <span class="dm-value tabular">${typeof val === "number" ? formatNumber(val) : "—"}</span>
        ${deltaHtml}
      </div>
      ${unknownNote ? `<div class="dm-note">${unknownNote}</div>` : ""}
    </li>`;
  });
  html += "</ul>";

  const waterBits = [];
  if (isWaterPeakValid(rec)) waterBits.push(`断水ピーク時: ${formatNumber(rec.water_outage_max)}戸`);
  if (rec.water_period) waterBits.push(`給水期間: ${rec.water_period}`);
  if (rec.water_note) waterBits.push(rec.water_note);
  if (waterBits.length) {
    html += `<div class="water-note">${waterBits.join("　／　")}</div>`;
  }

  html += `<div class="sparkline-wrap"><h2>推移（${getCurrentMetric().label}）</h2><div id="sparkline-container"></div></div>`;

  contentEl.innerHTML = html;
  renderSparkline(name);
}

function renderSparkline(name) {
  const container = document.getElementById("sparkline-container");
  if (!container) return;
  const metric = getCurrentMetric();
  const pts = data.snapshots.map((s) => (s.municipalities[name] ? metric.get(s.municipalities[name]) : null));
  const validVals = pts.filter((v) => typeof v === "number");
  if (!validVals.length) {
    container.innerHTML = '<div class="detail-empty">データなし</div>';
    return;
  }
  const max = Math.max(...validVals);
  const min = Math.min(0, ...validVals);
  // viewBoxのアスペクト比をCSS側(aspect-ratio)と一致させ、preserveAspectRatioの
  // 既定(xMidYMid meet)で歪みなく収まるようにする（潰れて見える問題の原因は
  // 旧来 preserveAspectRatio="none" でCSSの表示比率と食い違っていたこと）
  const w = 260, h = 100, pad = 12;
  const n = pts.length;
  const x = (i) => (n <= 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = (v) => (max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - 2 * pad));

  let pathParts = [];
  let dots = [];
  pts.forEach((v, i) => {
    if (typeof v !== "number") return;
    const px = x(i), py = y(v);
    pathParts.push(`${pathParts.length ? "L" : "M"}${px},${py}`);
    const isCurrent = i === state.snapshotIndex;
    dots.push(
      `<circle cx="${px}" cy="${py}" r="${isCurrent ? 5 : 3}" fill="${
        isCurrent ? metric.color : "#fff"
      }" stroke="${metric.color}" stroke-width="1.5"><title>${formatDateTimeJa(data.snapshots[i].datetime)}: ${formatNumber(
        v
      )}${metric.unit}</title></circle>`
    );
  });

  const currentVal = pts[state.snapshotIndex];
  const currentLabel =
    typeof currentVal === "number"
      ? `現在時点: ${formatNumber(currentVal)}${metric.unit}`
      : "現在時点: データなし";

  container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${metric.label}の推移（${n}時点）">
    <path d="${pathParts.join(" ")}" fill="none" stroke="${metric.color}" stroke-width="2.5"/>
    ${dots.join("")}
  </svg>
  <div class="spark-val tabular">${currentLabel}</div>`;
}

/* ===========================================================
   テーブル表示
   =========================================================== */

function renderTable(snapshot) {
  const container = document.getElementById("table-container");
  // formatDateTimeJa は末尾に「時点」まで含むため、ここで重ねて付けない
  let html = `<table class="data-table"><caption>${formatDateTimeJa(
    snapshot.datetime
  )}のデータ。「—」はデータなし（未公表）、「＊」は一部内訳が不明で既知分のみの合計を表す。</caption><thead><tr><th scope="col">市町村</th>`;
  METRICS.forEach((m) => {
    html += `<th scope="col">${m.label}<br>(${m.unit})</th>`;
  });
  html += "</tr></thead><tbody>";
  Object.keys(muniData).forEach((name) => {
    const rec = snapshot.municipalities[name];
    html += `<tr><th scope="row">${name}${prefBadgeHtml(name)}</th>`;
    METRICS.forEach((m) => {
      const val = rec ? m.get(rec) : null;
      if (typeof val !== "number") {
        html += '<td class="cell-null tabular">—</td>';
      } else {
        const mark = rec && hasUnknownComponent(m, rec) ? "＊" : "";
        html += `<td class="tabular">${formatNumber(val)}${mark}</td>`;
      }
    });
    html += "</tr>";
  });
  html += "</tbody></table>";
  container.innerHTML = html;
}

/* ===========================================================
   タイムスライダー・再生
   =========================================================== */

function setSnapshotIndex(i) {
  const n = data.snapshots.length;
  state.snapshotIndex = Math.min(Math.max(i, 0), n - 1);
  renderAll();
}

function nextSnapshot() {
  if (state.snapshotIndex < data.snapshots.length - 1) setSnapshotIndex(state.snapshotIndex + 1);
  else stopPlay();
}
function prevSnapshot() {
  setSnapshotIndex(state.snapshotIndex - 1);
}

function togglePlay() {
  if (state.playTimer) {
    stopPlay();
    return;
  }
  if (state.snapshotIndex >= data.snapshots.length - 1) setSnapshotIndex(0);
  document.getElementById("btn-play").textContent = "一時停止 ❚❚";
  state.playTimer = setInterval(() => {
    if (state.snapshotIndex >= data.snapshots.length - 1) {
      stopPlay();
      return;
    }
    nextSnapshot();
  }, 1200);
}

function stopPlay() {
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
  }
  document.getElementById("btn-play").textContent = "再生 ▶";
}

/* ===========================================================
   左右パネルの開閉（モバイルのボトムシート／デスクトップのグリッド列開閉を
   1つの状態で統一して扱う）

   - モバイル: panel-left/panel-right の is-open クラスが既存のスライド
     アップ表示を制御する
   - デスクトップ: app-main の left-closed/right-closed クラスがグリッド列
     幅を0にして地図を広げる
   両方を常に対で付け外しすることで、Escapeキー等どこから閉じても
   isPanelOpen() で一貫した判定ができるようにしている
   =========================================================== */

function setPanelOpen(side, open) {
  const panelId = side === "left" ? "panel-left" : "panel-right";
  const btnId = side === "left" ? "toggle-ranking" : "toggle-detail";
  const collapseClass = side === "left" ? "left-closed" : "right-closed";
  const panel = document.getElementById(panelId);
  const mainEl = document.querySelector(".app-main");

  panel.classList.toggle("is-open", open);
  mainEl.classList.toggle(collapseClass, !open);
  panel.inert = !open; // 非表示中はキーボード操作やスクリーンリーダーの対象から外す
  document.getElementById(btnId).setAttribute("aria-expanded", String(open));

  // モバイルのボトムシートは同じ位置に重なるので同時に1枚しか出せない
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 860px)").matches;
  if (open && isMobile) {
    setPanelOpen(side === "left" ? "right" : "left", false);
  }
}

function isPanelOpen(side) {
  const mainEl = document.querySelector(".app-main");
  return !mainEl.classList.contains(side === "left" ? "left-closed" : "right-closed");
}

// モバイルは折りたたんだボトムシートとして開始、デスクトップは両パネルとも
// 開いた状態で開始する（以後はユーザー操作に委ね、リサイズのたびには
// 変更しない。legendの折りたたみ判定と同じ方針）
function initPanelState() {
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 860px)").matches;
  setPanelOpen("left", !isMobile);
  setPanelOpen("right", !isMobile);
}

/* ===========================================================
   全体再描画
   =========================================================== */

function updateHeaderDateTime(snapshot) {
  document.getElementById("current-datetime").textContent = formatDateTimeJa(snapshot.datetime);
  document.getElementById("source-links").innerHTML =
    "出典: " +
    snapshot.sources
      .map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`)
      .join("、");
}

// 下部固定バーの実高さを body の padding-bottom / モバイルシートの
// bottom オフセットへ反映する。出典リンクの文言は時点ごとに長さが変わり
// 折り返し行数（＝バーの高さ）も変わるため、スナップショット切替のたびに
// 測り直さないと固定バーと地図・パネルが重なったり隙間が空いたりする
function syncBarHeight() {
  const bar = document.getElementById("timeline-bar");
  if (!bar) return;
  const h = bar.offsetHeight;
  if (h > 0) document.documentElement.style.setProperty("--bar-h", h + "px");
}

function renderAll() {
  const snapshot = currentSnapshot();
  const metric = getCurrentMetric();

  updateHeaderDateTime(snapshot);

  const globalMax = getGlobalMax(metric.key);
  const fc = buildGeoJSON(snapshot, metric, globalMax);
  const src = map && map.getSource("municipalities");
  if (src) src.setData(fc);

  updateStatHeader(snapshot, metric);
  updateRanking(snapshot, metric);
  updateLegend(metric, globalMax);
  updateTop5(fc.features, metric);
  if (state.selected) renderDetail();
  if (document.getElementById("table-overlay").classList.contains("is-open")) renderTable(snapshot);

  document.getElementById("slider").value = state.snapshotIndex;
  syncBarHeight();
}

/* ===========================================================
   UI組み立て・イベント配線
   =========================================================== */

function buildMetricSwitchUI() {
  const el = document.getElementById("metric-switch");
  el.innerHTML = "";
  METRICS.forEach((m) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "metric-btn";
    // トグルボタンとして aria-pressed のみを使う（role="tab" は aria-selected を
    // 要求するため aria-pressed と組み合わせると不整合になる）
    btn.dataset.key = m.key;
    btn.setAttribute("aria-pressed", m.key === state.metric ? "true" : "false");
    btn.innerHTML = `<span class="dot" style="background:${m.color}"></span>${m.label}`;
    btn.addEventListener("click", () => {
      state.metric = m.key;
      syncMetricButtons();
      renderAll();
    });
    el.appendChild(btn);
  });
}

function syncMetricButtons() {
  document.querySelectorAll(".metric-btn").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.key === state.metric ? "true" : "false");
  });
}

function buildEventMeta() {
  const ev = data.event;
  const p = parseJST(ev.origin);
  document.getElementById("event-meta").textContent =
    `M${ev.magnitude}・最大震度${ev.max_shindo}・${p.y}年${p.mo}月${p.d}日${pad2(p.h)}:${pad2(p.mi)}発生・` +
    `${ev.epicenter}（深さ${ev.depth_km}km）`;
}

function wireControls() {
  document.getElementById("slider").addEventListener("input", (e) => {
    stopPlay();
    setSnapshotIndex(+e.target.value);
  });
  document.getElementById("btn-prev").addEventListener("click", () => {
    stopPlay();
    prevSnapshot();
  });
  document.getElementById("btn-next").addEventListener("click", () => {
    stopPlay();
    nextSnapshot();
  });
  document.getElementById("btn-play").addEventListener("click", togglePlay);

  document.addEventListener("keydown", (e) => {
    if (e.target === document.getElementById("slider")) return; // ネイティブのrange操作と二重処理させない
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    // ランキング項目や詳細パネル内にフォーカスがある間は、その場で使う矢印キー
    // （将来のリスト内ナビゲーション等）を優先し、スライダーを奪わない
    if (e.target && e.target.closest && e.target.closest("#panel-left, #panel-right")) return;
    if (e.key === "ArrowLeft") {
      stopPlay();
      prevSnapshot();
    } else if (e.key === "ArrowRight") {
      stopPlay();
      nextSnapshot();
    }
  });

  document.getElementById("table-toggle").addEventListener("click", () => {
    document.getElementById("table-overlay").classList.add("is-open");
    renderTable(currentSnapshot());
  });
  document.getElementById("table-close").addEventListener("click", () => {
    document.getElementById("table-overlay").classList.remove("is-open");
  });

  // 地図の縁のチップ = 開くだけ／パネル内の✕ = 閉じるだけ、と役割を分けている
  document.getElementById("toggle-ranking").addEventListener("click", () => setPanelOpen("left", true));
  document.getElementById("toggle-detail").addEventListener("click", () => setPanelOpen("right", true));
  document.getElementById("ranking-close").addEventListener("click", () => setPanelOpen("left", false));
  document.getElementById("detail-panel-close").addEventListener("click", () => {
    state.selected = null;
    renderDetail();
    updateRankingSelectionHighlight();
    setPanelOpen("right", false);
  });

  // 幅が変わるとモバイル/デスクトップでフォントサイズや折り返しが変わり
  // 固定バーの高さも変わるため、都度 --bar-h を測り直す
  window.addEventListener("resize", syncBarHeight);

  wireInfoPanel();
  wireEscapeKey();
}

// 出典・注記はタイムラインバーを占有せず、ボタンで開閉するポップオーバーに
// 集約する（バーには「今どの時点か」の操作に必要な要素だけを残すため）
function wireInfoPanel() {
  const btn = document.getElementById("info-toggle");
  const panel = document.getElementById("info-panel");

  function openInfo() {
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }
  function closeInfo() {
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", () => (panel.hidden ? openInfo() : closeInfo()));

  document.addEventListener("click", (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    closeInfo();
  });

  state._closeInfo = closeInfo;
}

// Escapeで「今開いている一番手前のもの」だけを閉じる（情報ポップオーバー→
// テーブル表示→左右パネル（モバイルのボトムシート／デスクトップの折りたたみ
// 共通）→詳細パネルの選択、の優先順）
function wireEscapeKey() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    const infoPanel = document.getElementById("info-panel");
    if (infoPanel && !infoPanel.hidden) {
      if (state._closeInfo) state._closeInfo();
      return;
    }

    const tableOverlay = document.getElementById("table-overlay");
    if (tableOverlay.classList.contains("is-open")) {
      tableOverlay.classList.remove("is-open");
      return;
    }

    if (isPanelOpen("right")) {
      setPanelOpen("right", false);
      return;
    }
    if (isPanelOpen("left")) {
      setPanelOpen("left", false);
      return;
    }

    if (state.selected) {
      state.selected = null;
      renderDetail();
      updateRankingSelectionHighlight();
    }
  });
}

/* ===========================================================
   起動
   =========================================================== */

async function boot() {
  const [muniRes, timelineRes] = await Promise.all([fetch("data/municipalities.json"), fetch("data/timeline.json")]);
  muniData = await muniRes.json();
  data = await timelineRes.json();

  // 直近時点を初期表示にし、そこから過去へ遡れるようにする
  state.snapshotIndex = data.snapshots.length - 1;

  const sliderEl = document.getElementById("slider");
  sliderEl.max = String(data.snapshots.length - 1);
  sliderEl.value = String(state.snapshotIndex);

  buildEventMeta();
  buildMetricSwitchUI();
  wireControls();
  syncBarHeight();
  initLegendDisclosure();
  initPanelState();
  initMap();
}

// デスクトップでは最初から展開、モバイル(<=860px)では地図を隠さないよう
// 初期状態は折りたたむ。以後はユーザーのクリック操作に任せる（リサイズの
// たびに強制的に開閉を変えるとユーザー操作を無視することになるため、
// 判定はロード時の一度きり）
function initLegendDisclosure() {
  const legendEl = document.getElementById("legend");
  if (!legendEl || !window.matchMedia) return;
  legendEl.open = !window.matchMedia("(max-width: 860px)").matches;
}

boot();
