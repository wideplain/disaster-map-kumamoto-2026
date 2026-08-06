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
// 「不明分あり」の注記を出す判断材料として components を使う。
// label/unit は固定文字列ではなく i18n.js のキー名を持たせ、表示のたびに
// 現在の言語で引く（METRICSはモジュール読み込み時に1回だけ作られるオブジェクト
// なので、ここに翻訳済み文字列を静的に持たせると言語切替に追随できない）
const METRICS = [
  { key: "evacuees", labelKey: "metricEvacueesLabel", unitKey: "metricEvacueesUnit", color: "#1baf7a",
    summaryKey: "evacuees", get: (m) => (m ? numOrNull(m.evacuees) : null) },
  { key: "shelters", labelKey: "metricSheltersLabel", unitKey: "metricSheltersUnit", color: "#008300",
    summaryKey: "shelters", get: (m) => (m ? numOrNull(m.shelters) : null) },
  { key: "deaths", labelKey: "metricDeathsLabel", unitKey: "metricDeathsUnit", color: "#e34948",
    summaryKey: "deaths", get: (m) => (m ? numOrNull(m.deaths) : null) },
  { key: "injured", labelKey: "metricInjuredLabel", unitKey: "metricInjuredUnit", color: "#e87ba4",
    summaryKey: "injured", components: ["injured_light", "injured_moderate", "injured_severe"],
    get: (m) => (m ? sumOrNull(m.injured_light, m.injured_moderate, m.injured_severe) : null) },
  { key: "houses", labelKey: "metricHousesLabel", unitKey: "metricHousesUnit", color: "#eb6834",
    summaryKey: "houses", components: ["houses_full", "houses_large_half", "houses_half", "houses_partial", "houses_unclassified"],
    get: (m) => (m ? sumOrNull(m.houses_full, m.houses_large_half, m.houses_half, m.houses_partial, m.houses_unclassified) : null) },
  { key: "water_outage", labelKey: "metricWaterOutageLabel", unitKey: "metricWaterOutageUnit", color: "#2a78d6",
    summaryKey: "water_outage", get: (m) => (m ? numOrNull(m.water_outage) : null) },
  { key: "water_stations", labelKey: "metricWaterStationsLabel", unitKey: "metricWaterStationsUnit", color: "#4a3aa7",
    get: (m) => (m ? numOrNull(m.water_stations) : null) },
  { key: "power_outage", labelKey: "metricPowerOutageLabel", unitKey: "metricPowerOutageUnit", color: "#eda100",
    get: (m) => (m ? numOrNull(m.power_outage) : null) },
];

function metricByKey(key) {
  return METRICS.find((m) => m.key === key);
}

function metricLabel(metric) {
  return I18N.t(metric.labelKey);
}
function metricUnit(metric) {
  return I18N.t(metric.unitKey);
}

// 市町村名・県名は言語によりローマ字表記へ切り替える（漢字圏はそのまま）
function muniDisplayName(name) {
  return I18N.muniName(name, I18N.getLang());
}
function prefDisplayName(pref) {
  return I18N.prefName(pref, I18N.getLang());
}

// ニュースのカテゴリはデータ内では日本語キー（絞り込み状態のSetもこの値）。
// 表示のときだけ i18n のカテゴリ名に引き直す
const NEWS_CATEGORY_KEYS = {
  "ライフライン": "catLifeline",
  "交通": "catTransport",
  "医療・福祉": "catMedical",
  "生活・行政": "catDaily",
  "産業": "catIndustry",
};
function newsCategoryLabel(cat) {
  const key = NEWS_CATEGORY_KEYS[cat];
  return key ? I18N.t(key) : cat;
}

// ニュース本文は公的資料の日本語原文のまま（翻訳しない方針）。
// 日本語系以外のUI言語ではその旨の注記を一覧に添える
function isJapaneseTextLang() {
  const lang = I18N.getLang();
  return lang === "ja" || lang === "easy-ja";
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
  if (val === null || val === undefined) return I18N.t("valNoData");
  const base = `${formatNumber(val)}${metricUnit(metric)}`;
  return hasUnknownComponent(metric, rec) ? `${base}${I18N.t("valUnknownSuffix")}` : base;
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

// 熊本県資料がまだその市町村を報告していない期間、内閣府報の現在値で
// 断水戸数を補完していることがある（water_outage_source フィールド）。
// 熊本県合計（summary.water_outage）は県資料だけの集計なので、この補完値は
// 含まれない＝地図の円の合計とズレうる。混同を避けるため出典を明示する
function isWaterSupplemented(rec) {
  return !!(rec && rec.water_outage_source);
}

function waterSourceBadgeHtml(rec) {
  if (!isWaterSupplemented(rec)) return "";
  const title = I18N.t("waterSourceBadgeTitleTemplate", { source: rec.water_outage_source });
  const text = I18N.t("waterSourceBadgeTextTemplate", { source: rec.water_outage_source });
  return `<span class="source-badge" title="${title}">${text}</span>`;
}

/* ===========================================================
   状態
   =========================================================== */

let map = null;
let muniData = null;
let data = null;
let newsData = null; // 読み込み失敗時もnullのまま許容し、数値マップ側には一切影響させない

const state = {
  mapMode: "metric", // "metric" | "news" — 指標選択(metric)とは独立した状態
  metric: "evacuees",
  snapshotIndex: 0,
  selected: null,
  playTimer: null,
  globalMaxCache: {},
  top5: [],
  allCircles: [],
  newsActiveCategories: null, // Set。newsData読み込み後に全カテゴリで初期化
  newsMarkers: [],
  hoveredMuni: null, // ホバー中はこの市町村の直接ラベルを一時的に隠す（バルーンとの二重表示回避）
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

function pad2(n) {
  return String(n).padStart(2, "0");
}

// 曜日名・書式は言語ごとに異なるため i18n.js (I18N.formatDateTime) に委譲する。
// ここでの parseJST/pad2 は buildEventMeta の M/最大震度/発生日時テンプレート
// 組み立てにだけ使う（そちらは i18n.js 側の日時フォーマッタとは別の文字列）
function formatDateTimeLocalized(iso) {
  return I18N.formatDateTime(iso);
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
   ニュースマップモード: データ処理（DOM非依存の純粋関数群）

   数値マップの指標選択とは完全に独立した状態(state.mapMode)で切り替える。
   data/news.json のスキーマ:
   { categories:[...], reports:[{id,datetime,source_url}],
     snapshot_report:{snapshotId->reportId}, events:[{id,category,muni,text,
     first_seen,last_seen,updated}] }
   =========================================================== */

// 指標の色パレットを流用し、凡例の色数を増やさない
const NEWS_CATEGORY_COLORS = {
  ライフライン: "#2a78d6",
  交通: "#eb6834",
  "医療・福祉": "#e87ba4",
  "生活・行政": "#1baf7a",
  産業: "#eda100",
};

function newsCategoryColor(category) {
  return NEWS_CATEGORY_COLORS[category] || "#52514e";
}

// 原文PDFの抽出方式によっては和文が「文 字 間 に 半 角 ス ペ ー ス」を
// 挟んだ状態で入ってくることがある（1文字ごとに半角スペース）。データ自体は
// 直さず、表示直前だけ「和文文字どうしに挟まれた単独の半角スペース」を
// 除去する。挟む側が半角英数字（日付の数字など）の場合は本来のスペースと
// 区別できないため、あえて手を付けずに残す（安全側に倒す）
const JP_CHAR_CLASS = "[　-ヿ㐀-鿿＀-￯]";
const JP_SINGLE_SPACE_RE = new RegExp(`(${JP_CHAR_CLASS}) (?=${JP_CHAR_CLASS})`, "gu");

function cleanNewsText(text) {
  if (typeof text !== "string") return text;
  return text.replace(JP_SINGLE_SPACE_RE, "$1").trim();
}

// snapshotのidから対応する報(report)のidを引く。報とスナップショットは
// 別々の時系列（報のほうが細かい）なので、対応がなければnull
function currentReportId(news, snapshotId) {
  return (news && news.snapshot_report && news.snapshot_report[snapshotId]) || null;
}

// idは "YYYYMMDD-HHMM" 形式で桁数・書式が揃っているため、文字列比較のまま
// 時系列の前後判定に使える（先頭が年月日、次が時刻で常に同じ桁数）
function eventsForReport(news, reportId) {
  if (!news || !reportId) return [];
  return news.events.filter((e) => e.first_seen <= reportId && reportId <= e.last_seen);
}

function globalNewsEvents(events) {
  return events.filter((e) => e.muni === null || e.muni === undefined);
}

// 同数の場合は categoriesOrder（=news.categories の並び）の先頭側を優先し、
// 実行のたびに結果が変わらないようにする
function dominantCategory(events, categoriesOrder) {
  const counts = {};
  events.forEach((e) => {
    counts[e.category] = (counts[e.category] || 0) + 1;
  });
  let best = null;
  let bestCount = 0;
  (categoriesOrder || []).forEach((cat) => {
    const c = counts[cat] || 0;
    if (c > bestCount) {
      bestCount = c;
      best = cat;
    }
  });
  return best;
}

// 地図のマーカーは「市町村ごとに集約」なので、muni付きイベントをグルーピングし、
// 代表色（件数最多のカテゴリ）と件数を求める
function aggregateNewsByMuni(events, categoriesOrder) {
  const byMuni = new Map();
  events.forEach((e) => {
    if (e.muni === null || e.muni === undefined) return;
    if (!byMuni.has(e.muni)) byMuni.set(e.muni, []);
    byMuni.get(e.muni).push(e);
  });
  const result = [];
  byMuni.forEach((evs, muni) => {
    result.push({ muni, count: evs.length, events: evs, dominantCategory: dominantCategory(evs, categoriesOrder) });
  });
  return result;
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

const NUMERIC_LAYER_IDS = ["circle-fill", "circle-ring", "circle-hit"];

// 数値マップの円レイヤーとニュースマップのマーカー(HTMLオーバーレイ)は
// 排他表示。円レイヤーはMapLibre側のvisibilityで、ニュースマーカー・上位
// ラベル・凡例はDOMのdisplayで切り替える（マップロード前に呼ばれても
// 安全なようレイヤーの有無を確認する）
function updateLayerVisibilityForMode() {
  if (map && map.getLayer) {
    const vis = state.mapMode === "metric" ? "visible" : "none";
    NUMERIC_LAYER_IDS.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
    });
  }
  const overlayLabelsEl = document.getElementById("overlay-labels");
  const newsOverlayEl = document.getElementById("news-overlay");
  if (overlayLabelsEl) overlayLabelsEl.style.display = state.mapMode === "metric" ? "" : "none";
  if (newsOverlayEl) newsOverlayEl.style.display = state.mapMode === "news" ? "" : "none";
  const legendEl = document.getElementById("legend");
  if (legendEl) legendEl.style.display = state.mapMode === "metric" ? "" : "none";
  if (state.mapMode !== "metric") updateLabelHint([]);
}

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

  map.on("move", () => {
    if (state.mapMode === "metric") layoutOverlayLabels();
    else repositionNewsMarkers();
  });

  updateLayerVisibilityForMode();
  renderAll();
}

function addEpicenterMarker() {
  const ll = data.event.epicenter_latlng;
  if (!ll) return;
  const el = document.createElement("div");
  el.className = "epicenter-marker";
  el.innerHTML = `<div class="epicenter-mark">×</div><div class="epicenter-label">${I18N.t("epicenterLabel")}</div>`;
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

// anchor:"bottom" で固定する（＝ポップオーバーは常にカーソル位置の真上に
// 出る）。MapLibreの既定は画面端に応じてanchorを動的に選ぶが、それだと
// 上位5市町村の直接ラベル（同じく動的に位置決めしている）とたまたま同じ側に
// 決まって重なることがあった。固定+「ホバー中はその市町村の直接ラベルを
// 消す」(下のstate.hoveredMuni)の2つを合わせて、重なりを構造的に無くす
const tooltipPopup = new maplibregl.Popup({
  closeButton: false,
  closeOnClick: false,
  anchor: "bottom",
  offset: 16,
});

function showTooltip(feature, lngLat) {
  const name = feature.properties.name;
  const rec = currentSnapshot().municipalities[name];
  if (!rec) return;

  // ホバー中の市町村がすでに上位5ラベルとして出ている場合、バルーンと
  // 二重表示になり重なって見づらいので、ホバー中だけ直接ラベルを引っ込める
  if (state.hoveredMuni !== name) {
    state.hoveredMuni = name;
    if (state.mapMode === "metric") layoutOverlayLabels();
  }

  const metric = getCurrentMetric();
  const others = ["evacuees", "deaths", "water_outage"].filter((k) => k !== metric.key).slice(0, 2);
  const sourceBadge = metric.key === "water_outage" ? waterSourceBadgeHtml(rec) : "";
  const mainLine = `${metricLabel(metric)}: <strong>${formatMetricValue(metric, rec)}</strong>${sourceBadge}`;
  const subLines = others
    .map((k) => {
      const m = metricByKey(k);
      const v = m.get(rec);
      return `<span>${metricLabel(m)} ${typeof v === "number" ? formatMetricValue(m, rec) : "—"}</span>`;
    })
    .join("");
  const html = `<div class="tooltip-name">${muniDisplayName(name)}</div><div class="tooltip-main">${mainLine}</div><div class="tooltip-sub">${subLines}</div>`;
  tooltipPopup.setLngLat(lngLat).setHTML(html).addTo(map);
}

function hideTooltip() {
  tooltipPopup.remove();
  if (state.hoveredMuni !== null) {
    state.hoveredMuni = null;
    if (state.mapMode === "metric") layoutOverlayLabels();
  }
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

// フォント文字列ごとにcanvasコンテキストをキャッシュする。地図の直接ラベルと
// 凡例のラベルはフォントサイズ/太さが異なるため、それぞれの実際のレンダリング
// と一致するフォントで測らないと「測定値だけ小さい」ズレが起きる
// （実際に凡例のはみ出しの一因になっていた: 13px boldで測って12pxで描画していた）
const _measureCtxCache = new Map(); // font文字列 -> CanvasRenderingContext2D|null

function getMeasureCtx(font) {
  if (_measureCtxCache.has(font)) return _measureCtxCache.get(font);
  let ctx = null;
  try {
    const c = document.createElement("canvas");
    ctx = (c.getContext && c.getContext("2d")) || null;
    if (ctx) ctx.font = font;
  } catch (e) {
    ctx = null;
  }
  _measureCtxCache.set(font, ctx);
  return ctx;
}

// canvasが無い環境（DOMを持たないNode vm テストハーネス）向けのフォールバック。
// 13px基準で較正した文字種ごとの概算幅を、要求されたフォントサイズに比例
// スケールする。実測よりわずかに広めに見積もり、はみ出し・衝突判定を安全側に倒す
function fallbackTextWidth(text, font) {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  const size = m ? parseFloat(m[1]) : 13;
  const ratio = size / 13;
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += 5.3 * ratio;
    else if (/[　-鿿＀-￯]/.test(ch)) w += 14.2 * ratio; // 全角・漢字・かな
    else w += 8.9 * ratio; // 半角英数字
  }
  return w;
}

function measureTextWidth(text, font) {
  const ctx = getMeasureCtx(font);
  if (ctx) return ctx.measureText(text).width;
  return fallbackTextWidth(text, font);
}

// canvas.measureText は「実測」に近い幅が取れるが、DOMを持たないテスト環境
// (Node vm ハーネス)でも同じ衝突回避ロジックを検証できるよう、canvasが
// 無ければ文字種ごとの概算幅にフォールバックする。フォールバックは実際の
// 描画幅よりわずかに広めに見積もり、衝突判定を安全側に倒す。
function measureLabelWidth(text) {
  return measureTextWidth(text, LABEL_FONT);
}

function rectsOverlap(a, b) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

// 地図を大きくパン/ズームすると、投影後の座標(px)がマップの可視領域から
// 大きく（時に数千px）外れることがある。position:absoluteなオーバーレイを
// そのまま置くと、祖先要素のスクロール可能領域を押し広げてしまい、実機で
// 「フッターが沈む」「ページ幅ががたつく」（縦横スクロールバーの出現/消滅の
// 振動）という不具合として報告された。.map-wrap 側の overflow:hidden で
// 最終的にはクリップされるが、そもそも可視領域外にDOM要素を置かないほうが
// 安全かつ軽量なので、ここで先に弾く（＝カリング）。marginは可視領域の
// すぐ外側にある要素まで急に消えないようにするための緩衝
const OVERLAY_CULL_MARGIN = 60;

function isPointVisible(p, viewport) {
  if (!viewport) return true; // ビューポート情報が無い呼び出し元（既存テスト等）は従来通り常に表示
  const margin = viewport.margin != null ? viewport.margin : OVERLAY_CULL_MARGIN;
  return p.x >= -margin && p.x <= viewport.width + margin && p.y >= -margin && p.y <= viewport.height + margin;
}

// マップコンテナの現在の表示サイズ（CSSピクセル、map.project()と同じ座標系）。
// 呼び出しのたびに読む（パネル開閉やリサイズで変わりうるため、キャッシュしない）
function getMapViewportSize() {
  if (!map || !map.getContainer) return null;
  const c = map.getContainer();
  return { width: c.clientWidth, height: c.clientHeight, margin: OVERLAY_CULL_MARGIN };
}

// projectFn(lng,lat) -> {x,y} を差し替え可能にしておくことで、
// ブラウザでは map.project、Nodeテストでは自前のメルカトル投影を使い回せる。
// viewport を渡すと、アンカーが可視領域外に大きく外れたラベルを候補探索
// なしで即 visible:false にする（カリング。省略時は従来どおり常に候補探索する）
function computeLabelLayout(topItems, allCircles, projectFn, viewport) {
  const circleBoxes = allCircles.map((c) => {
    const p = projectFn(c.lng, c.lat);
    return { name: c.name, x1: p.x - c.radius, y1: p.y - c.radius, x2: p.x + c.radius, y2: p.y + c.radius };
  });

  const placedBoxes = [];
  const results = [];

  topItems.forEach((item) => {
    const p = projectFn(item.lng, item.lat);

    if (!isPointVisible(p, viewport)) {
      // 画面外は「密集で隠した」とは区別する（ズーム促しヒントの対象外）
      results.push({ name: item.name, text: item.text, visible: false, offscreen: true });
      return;
    }

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
      // 全候補が衝突。ヒントからズームインできるよう座標を持たせておく
      results.push({ name: item.name, text: item.text, visible: false, lng: item.lng, lat: item.lat });
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
    text: `${muniDisplayName(item.name)} ${formatNumber(item.value)}${metricUnit(metric)}`,
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
  // ホバー中の市町村はバルーンと二重表示になるので直接ラベルからは除く
  const items = state.hoveredMuni ? state.top5.filter((t) => t.name !== state.hoveredMuni) : state.top5;
  const viewport = getMapViewportSize();
  const placements = computeLabelLayout(items, state.allCircles, (lng, lat) => map.project([lng, lat]), viewport);
  renderLabelDom(placements);
  updateLabelHint(placements.filter((p) => !p.visible && !p.offscreen));
}

/* ===========================================================
   密集ヒント: 上位5ラベルのうち衝突で隠れたものがあるとき、地図下部に
   件数とズーム促しのピルを出す。タップで隠れた市町村を囲むようにズームする
   （ズーム後は既存のmoveハンドラがレイアウトを再計算し、置けたラベルから復活する）
   =========================================================== */

function updateLabelHint(hiddenItems) {
  const el = document.getElementById("label-hint");
  if (!el) return;
  if (state.mapMode !== "metric" || !hiddenItems.length) {
    el.hidden = true;
    state._labelHintTargets = null;
    return;
  }
  el.hidden = false;
  el.textContent = I18N.t("labelsHiddenZoomHint", { n: hiddenItems.length });
  state._labelHintTargets = hiddenItems.map((h) => [h.lng, h.lat]);
}

function wireLabelHint() {
  const el = document.getElementById("label-hint");
  if (!el) return;
  el.addEventListener("click", () => {
    const targets = state._labelHintTargets;
    if (!map || !targets || !targets.length) return;
    const lngs = targets.map((c) => c[0]);
    const lats = targets.map((c) => c[1]);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      // padding大きめ: 対象の円だけでなくラベルの置き場も画面内に必要なため。
      // maxZoomは対象が1点だけのとき寄りすぎないための上限
      { padding: 120, maxZoom: 11, duration: REDUCED_MOTION ? 0 : 600 }
    );
  });
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
   ニュースマップの市町村マーカー（HTMLオーバーレイ、円レイヤーとは排他表示）
   上位5ラベルと同じくMapLibreのsymbolレイヤーを使わずDOMで描く
   =========================================================== */

function updateNewsMap(filteredEvents) {
  if (!newsData) {
    state.newsMarkers = [];
    layoutNewsMarkers();
    return;
  }
  const agg = aggregateNewsByMuni(filteredEvents, newsData.categories);
  state.newsMarkers = agg
    .map((a) => {
      const loc = muniData[a.muni];
      return loc ? { ...a, lng: loc.lng, lat: loc.lat } : null;
    })
    .filter(Boolean);
  layoutNewsMarkers();
}

// 全マーカーを常にDOMへ入れたうえで表示/非表示だけを毎回切り替える
// （layoutNewsMarkers/repositionNewsMarkers 共通）。可視領域外は
// display:noneでレイアウトから完全に外すことで、labelと同じ理由
// （祖先のスクロール領域を押し広げてscrollbarの出現/消滅を誘発する）を防ぐ。
// 「集約時に丸ごと除外」ではなくDOMには残す設計にしているのは、パンで
// 再び画面内に戻ってきたときに（filteredEvents自体は変わっていないので）
// 再集約なしで復帰できるようにするため
function applyMarkerVisibility(el) {
  if (!map) return;
  const viewport = getMapViewportSize();
  for (const child of el.children) {
    const p = map.project([+child.dataset.lng, +child.dataset.lat]);
    const visible = isPointVisible(p, viewport);
    child.style.display = visible ? "" : "none";
    if (visible) {
      child.style.left = p.x + "px";
      child.style.top = p.y + "px";
    }
  }
}

function layoutNewsMarkers() {
  const el = document.getElementById("news-overlay");
  if (!el) return;
  el.innerHTML = "";
  if (!map) return;
  state.newsMarkers.forEach((m) => {
    const p = map.project([m.lng, m.lat]);
    const div = document.createElement("div");
    div.className = "news-marker";
    div.style.left = p.x + "px";
    div.style.top = p.y + "px";
    div.dataset.lng = m.lng;
    div.dataset.lat = m.lat;
    div.tabIndex = 0;
    div.setAttribute("role", "button");
    div.setAttribute("aria-label", I18N.t("newsMarkerAriaLabelTemplate", { muni: muniDisplayName(m.muni), n: m.count }));
    const color = newsCategoryColor(m.dominantCategory);
    div.innerHTML = `<span class="dot" style="background:${color}"></span>${muniDisplayName(m.muni)}（${m.count}）`;
    const onActivate = () => {
      flyToMuni(m.muni);
      selectMunicipality(m.muni);
    };
    div.addEventListener("click", onActivate);
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    });
    el.appendChild(div);
  });
  applyMarkerVisibility(el);
}

// パン・ズームのたびに呼ぶ（緯度経度→画面座標の再計算+可視判定のみで、集約し直しはしない）
function repositionNewsMarkers() {
  if (!map) return;
  const el = document.getElementById("news-overlay");
  if (!el) return;
  applyMarkerVisibility(el);
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
      parts.push(I18N.t("extrasDeathsInvestigating", { n: formatNumber(extras.deaths_related_investigating) }));
    }
    if (typeof extras.deaths_related_possible === "number" && extras.deaths_related_possible > 0) {
      parts.push(I18N.t("extrasDeathsPossible", { n: formatNumber(extras.deaths_related_possible) }));
    }
    const u = extras.unidentified_remains;
    if (u && typeof u.deaths === "number" && u.deaths > 0) {
      parts.push(I18N.t("extrasUnidentifiedDeaths", { n: formatNumber(u.deaths) }));
    }
  } else if (metricKey === "injured") {
    const u = extras.unidentified_remains;
    if (u) {
      const bits = [];
      if (typeof u.injured_light === "number" && u.injured_light > 0) bits.push(I18N.t("extrasInjuredLight", { n: formatNumber(u.injured_light) }));
      if (typeof u.injured_moderate === "number" && u.injured_moderate > 0) bits.push(I18N.t("extrasInjuredModerate", { n: formatNumber(u.injured_moderate) }));
      if (typeof u.injured_severe === "number" && u.injured_severe > 0) bits.push(I18N.t("extrasInjuredSevere", { n: formatNumber(u.injured_severe) }));
      if (bits.length) parts.push(`${I18N.t("extrasUnidentifiedInjuredPrefix")}${bits.join("・")}`);
    }
  }

  if (!parts.length) return null;
  return `${I18N.t("extrasPrefix")}${parts.join("・")}`;
}

// 断水戸数だけ別枠: 熊本県資料が未報告の市町村を内閣府報の値で地図には
// 表示しているが、熊本県合計（summary.water_outage）はあくまで県資料だけの
// 集計なので、その補完値は合計に含まれない。1つでも該当があれば注記する
function buildWaterSourceNote(snapshot) {
  const hasSupplemented = Object.values(snapshot.municipalities).some((rec) => isWaterSupplemented(rec));
  if (!hasSupplemented) return null;
  return I18N.t("extrasWaterSourceNote");
}

function buildStatNote(metric, snapshot) {
  if (metric.key === "deaths" || metric.key === "injured") return buildExtrasNote(metric.key, snapshot.extras);
  if (metric.key === "water_outage") return buildWaterSourceNote(snapshot);
  return null;
}

function updateStatHeader(snapshot, metric) {
  let total = null;
  const summaryVal = metric.summaryKey && snapshot.summary ? snapshot.summary[metric.summaryKey] : undefined;
  if (typeof summaryVal === "number") {
    total = summaryVal;
  } else {
    total = sumAcrossMuniOrNull(snapshot, metric); // 熊本県の市町村のみを合算
  }
  document.getElementById("stat-label").textContent = I18N.t("statLabelTemplate", { metric: metricLabel(metric) });
  document.getElementById("stat-value").textContent = total === null ? I18N.t("valNoData") : formatNumber(total);
  document.getElementById("stat-unit").textContent = total === null ? "" : metricUnit(metric);

  const noteEl = document.getElementById("stat-extras-note");
  if (noteEl) {
    const note = buildStatNote(metric, snapshot);
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
  return `<span class="pref-badge">${prefDisplayName(loc.pref)}</span>`;
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
    const waterBadge = metric.key === "water_outage" ? waterSourceBadgeHtml(snapshot.municipalities[r.name]) : "";
    li.innerHTML = `
      <span class="rank-no">${i + 1}</span>
      <span class="rank-name">${muniDisplayName(r.name)}</span>${prefBadgeHtml(r.name)}${waterBadge}
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
   ニュースマップ: 左パネル（カテゴリ絞り込み・一覧）
   =========================================================== */

// カテゴリ一覧はnewsData読み込み後にしか確定しないため、チップの生成自体は
// データ到着時に一度だけ行い、以後は aria-pressed の同期だけを毎回行う
function buildNewsFilterChips() {
  const el = document.getElementById("news-filter");
  if (!el || !newsData) return;
  el.innerHTML = "";
  newsData.categories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "news-chip-btn";
    btn.dataset.cat = cat;
    btn.setAttribute("aria-pressed", state.newsActiveCategories.has(cat) ? "true" : "false");
    btn.innerHTML = `<span class="dot" style="background:${newsCategoryColor(cat)}"></span>${newsCategoryLabel(cat)}`;
    btn.addEventListener("click", () => {
      if (state.newsActiveCategories.has(cat)) state.newsActiveCategories.delete(cat);
      else state.newsActiveCategories.add(cat);
      trackEvent("filter_news", { category: cat, active: state.newsActiveCategories.has(cat) });
      syncNewsFilterChips();
      renderAll();
    });
    el.appendChild(btn);
  });
}

function syncNewsFilterChips() {
  document.querySelectorAll(".news-chip-btn").forEach((b) => {
    b.setAttribute("aria-pressed", state.newsActiveCategories.has(b.dataset.cat) ? "true" : "false");
  });
}

// NEW: この報で初めて登場したイベント／更新: 初出ではないが改訂されているイベント
// （同時にNEWでもある場合はNEWを優先し、更新バッジは出さない）
function renderNewsItem(ev, reportId) {
  const li = document.createElement("li");
  li.className = "news-item";
  const isNew = ev.first_seen === reportId;
  const isUpdated = !isNew && !!ev.updated;
  if (ev.muni) {
    li.tabIndex = 0;
    li.dataset.name = ev.muni;
  }
  const muniLabel = ev.muni ? `<span class="news-muni-name">${muniDisplayName(ev.muni)}</span>${prefBadgeHtml(ev.muni)}` : "";
  const badges =
    (isNew ? `<span class="news-badge news-badge-new">${I18N.t("newsBadgeNew")}</span>` : "") +
    (isUpdated ? `<span class="news-badge news-badge-updated">${I18N.t("newsBadgeUpdated")}</span>` : "");
  li.innerHTML = `
    <div class="news-item-head">
      ${muniLabel}
      <span class="news-cat-chip"><span class="dot" style="background:${newsCategoryColor(ev.category)}"></span>${newsCategoryLabel(ev.category)}</span>
      ${badges}
    </div>
    <div class="news-item-text">${cleanNewsText(ev.text)}</div>`;
  if (ev.muni) {
    const onActivate = () => {
      flyToMuni(ev.muni);
      selectMunicipality(ev.muni);
    };
    li.addEventListener("click", onActivate);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    });
  }
  return li;
}

// 「県内全域」（市町村に紐づかないイベント）は実データで最大66件/報にのぼり、
// 一覧の先頭を占領して市町村別の一覧までのスクロールを長くしてしまう。
// <details>で折りたたみ、件数だけ常に見えるようにする（既定は常に閉じる。
// 時点を送るたびに件数が変わるので、件数依存で開閉を変えると
// スクラブ中に開閉状態が不規則に切り替わって煩わしくなるため）
function buildGlobalNewsGroup(globals, reportId) {
  const li = document.createElement("li");
  const details = document.createElement("details");
  details.className = "news-group";
  const summary = document.createElement("summary");
  summary.textContent = I18N.t("newsGroupGlobalTemplate", { n: globals.length });
  details.appendChild(summary);
  const innerList = document.createElement("ul");
  innerList.className = "news-group-list";
  globals.forEach((e) => innerList.appendChild(renderNewsItem(e, reportId)));
  details.appendChild(innerList);
  li.appendChild(details);
  return li;
}

function updateNewsPanel(filteredEvents, reportId) {
  const listEl = document.getElementById("news-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  if (!newsData) {
    listEl.innerHTML = `<li class="news-empty">${I18N.t("newsEmptyNoData")}</li>`;
    return;
  }
  if (!reportId) {
    listEl.innerHTML = `<li class="news-empty">${I18N.t("newsEmptyNoReport")}</li>`;
    return;
  }
  if (!filteredEvents.length) {
    listEl.innerHTML = `<li class="news-empty">${I18N.t("newsEmptyNoMatch")}</li>`;
    return;
  }

  // ニュース本文は日本語原文のまま載せる方針のため、日本語系以外のUIでは注記を添える
  if (!isJapaneseTextLang()) {
    const notice = document.createElement("li");
    notice.className = "news-empty news-translation-note";
    notice.textContent = I18N.t("newsTranslationNotice");
    listEl.appendChild(notice);
  }

  const globals = globalNewsEvents(filteredEvents);
  const muniEvents = filteredEvents.filter((e) => e.muni);

  if (globals.length) {
    listEl.appendChild(buildGlobalNewsGroup(globals, reportId));
  }
  if (muniEvents.length) {
    const label = document.createElement("li");
    label.className = "news-group-label";
    label.textContent = I18N.t("newsGroupMuniLabel");
    listEl.appendChild(label);
    [...muniEvents]
      .sort((a, b) => a.muni.localeCompare(b.muni, "ja"))
      .forEach((e) => listEl.appendChild(renderNewsItem(e, reportId)));
  }
}

/* ===========================================================
   凡例
   =========================================================== */

function legendSteps(globalMax) {
  const raw = [globalMax, globalMax * 0.35, globalMax * 0.1].map(toNiceNumber);
  return [...new Set(raw.filter((v) => v > 0))].sort((a, b) => b - a).slice(0, 3); // 大→小
}

// 入れ子同心円（下端揃え）+ 円の上端から右へ伸びるリーダー線 + 値ラベル、の
// 座標をすべて計算する。DOM/SVG生成から切り離してあるのでテストしやすい。
// 円は半径最大46px（直径92px）まであるため、固定高さの箱に収めようとすると
// 崩れる。necessary widthは実際のラベル幅（measureLegendLabelWidthの実測）から
// 逆算するので、桁数の多い数値でも自動的にコンテナが広がる
const LEGEND_STROKE_W = 2;
const LEGEND_LEADER_LEN = 14;
const LEGEND_LABEL_GAP = 4;
const LEGEND_PAD = LEGEND_STROKE_W;
const LEGEND_LABEL_FONT_SIZE = 12;
// SVGテキストの実際のレンダリング(font-size/weight)と完全に一致させて測る。
// これがずれると「測定値だけ小さい」まま幅を確保してしまい、右端・上端の
// はみ出しにつながる（実際に凡例のはみ出しの原因の一つだった）
const LEGEND_LABEL_FONT = `700 ${LEGEND_LABEL_FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif`;
// OS/フォントのメトリクス差（Windows/Mac/Linuxでの実際のグリフ幅の揺れ）を
// 吸収するための追加バッファ。実測値の上に必ず足す（実測「未満」にはしない）
const LEGEND_LABEL_SAFETY_W = 4;
// dominant-baseline="middle" で描くテキストの中心が topY に来るため、
// 一番大きい円（先頭のitem）は topY がSVGの上端(y=0)ぎりぎりになりやすい。
// テキストの半分の高さぶんを先頭に確保しておかないと上にはみ出す
// （全角混じりのCJKフォントは半角欧文よりascent/descentが大きめなので
// フォントサイズの0.75倍というやや余裕を見た係数で確保する）
const LEGEND_TOP_PAD = Math.ceil(LEGEND_LABEL_FONT_SIZE * 0.75);

function measureLegendLabelWidth(text) {
  return measureTextWidth(text, LEGEND_LABEL_FONT);
}

function computeLegendGeometry(steps, globalMax, metric) {
  const radii = steps.map((v) => valueToRadius(v, globalMax)); // stepsは大→小なのでradiiも大→小のはず
  const maxR = radii.length ? Math.max(...radii) : 0;
  const cx = LEGEND_PAD + maxR;
  const baselineY = LEGEND_TOP_PAD + LEGEND_PAD + maxR * 2; // 全円が接するy座標（下端揃え）

  const items = steps.map((v, i) => {
    const r = radii[i];
    const cy = baselineY - r;
    const topY = cy - r;
    const label = `${formatNumber(v)}${metricUnit(metric)}`;
    return { value: v, r, cx, cy, topY, lineEndX: cx + r + LEGEND_LEADER_LEN, label };
  });

  const maxLabelW = items.length
    ? Math.max(...items.map((it) => measureLegendLabelWidth(it.label))) + LEGEND_LABEL_SAFETY_W
    : 0;
  const width = LEGEND_PAD + maxR * 2 + LEGEND_LEADER_LEN + LEGEND_LABEL_GAP + maxLabelW + LEGEND_PAD;
  const height = baselineY + LEGEND_PAD;

  return { items, maxR, width: Math.max(width, 1), height: Math.max(height, 1) };
}

function buildLegendSvg(geometry, metric) {
  const { items, width, height } = geometry;
  // 円は指標の色で塗る（凡例が今どの指標のものかひと目でわかるように）。
  // リーダー線とラベルの文字は常にインク色にする（色つき文字にしない方針のため）
  const circles = items
    .map(
      (it) =>
        `<circle cx="${it.cx}" cy="${it.cy}" r="${it.r}" fill="${hexToRgba(metric.color, 0.18)}" stroke="${metric.color}" stroke-width="${LEGEND_STROKE_W}"/>` +
        `<line x1="${it.cx + it.r}" y1="${it.topY}" x2="${it.lineEndX}" y2="${it.topY}" stroke="currentColor" stroke-width="1"/>`
    )
    .join("");
  // font-size/font-weightはLEGEND_LABEL_FONTでの測定と必ず一致させる
  const labels = items
    .map(
      (it) =>
        `<text class="tabular" x="${it.lineEndX + LEGEND_LABEL_GAP}" y="${it.topY}" dominant-baseline="middle" font-size="${LEGEND_LABEL_FONT_SIZE}" font-weight="700">${it.label}</text>`
    )
    .join("");
  const ariaLabel = `${I18N.t("legendTitleDefault")}: ${items.map((it) => it.label).join("、")}`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${ariaLabel}">${circles}${labels}</svg>`;
}

function updateLegend(metric, globalMax) {
  document.getElementById("legend-title").textContent = I18N.t("legendTitleTemplate", { metric: metricLabel(metric) });
  const steps = legendSteps(globalMax);

  const wrap = document.getElementById("legend-circles");
  if (!steps.length) {
    wrap.innerHTML = "";
    wrap.textContent = I18N.t("valNoData");
  } else {
    const geometry = computeLegendGeometry(steps, globalMax, metric);
    wrap.innerHTML = buildLegendSvg(geometry, metric);
  }

  const noteEl = document.getElementById("legend-note");
  if (noteEl) noteEl.textContent = I18N.t("legendNote");
}

/* ===========================================================
   詳細パネル
   =========================================================== */

// GA4カスタムイベント。gtagは広告ブロッカー等で存在しないことがあるため
// 必ずガードし、計測失敗がアプリ動作に影響しないようにする
function trackEvent(name, params) {
  try {
    if (typeof gtag === "function") gtag("event", name, { ...params, lang: I18N.getLang() });
  } catch (e) {
    /* 計測は本体機能ではないため失敗しても無視 */
  }
}

// trigger: "click"(地図・一覧からの選択) | "hash"(共有URLからの復元)。
// どの市町村が見られているかの計測に使う。同じ市町村の再選択は送らない
function selectMunicipality(name, trigger) {
  if (state.selected !== name) {
    trackEvent("select_muni", { muni: name, mode: state.mapMode, trigger: trigger || "click" });
  }
  state.selected = name;
  renderDetail();
  updateRankingSelectionHighlight();
  setPanelOpen("right", true);
  syncHashFromState();
}

// ニュースマップでは、一覧・地図側はカテゴリ絞り込みの対象になるが、
// 詳細パネルは「その市町村の全ニュース（時点内）」を見せる場所なので
// あえてフィルタを適用しない
function renderNewsDetail(name) {
  const contentEl = document.getElementById("detail-content");
  const loc = muniData[name];
  contentEl.innerHTML = `<div class="detail-head"><h3>${muniDisplayName(name)}</h3><span class="detail-chip">${
    loc ? prefDisplayName(loc.pref) : ""
  }</span></div><ul class="news-list" id="detail-news-list"></ul>`;
  const listEl = document.getElementById("detail-news-list");

  if (!newsData) {
    listEl.innerHTML = `<li class="news-empty">${I18N.t("newsEmptyNoData")}</li>`;
    return;
  }
  const reportId = currentReportId(newsData, currentSnapshot().id);
  const events = eventsForReport(newsData, reportId).filter((e) => e.muni === name);
  if (!events.length) {
    listEl.innerHTML = `<li class="news-empty">${I18N.t("newsEmptyNoneAtPoint")}</li>`;
    return;
  }
  events.forEach((e) => listEl.appendChild(renderNewsItem(e, reportId)));
}

function renderDetail() {
  const contentEl = document.getElementById("detail-content");
  const name = state.selected;
  if (!name) {
    contentEl.innerHTML = `<div class="detail-empty">${I18N.t("detailPlaceholder")}</div>`;
    return;
  }

  if (state.mapMode === "news") {
    renderNewsDetail(name);
    return;
  }

  const snapshot = currentSnapshot();
  const rec = snapshot.municipalities[name];
  const loc = muniData[name];
  const prevSnapshot = data.snapshots[state.snapshotIndex - 1];
  const prevRec = prevSnapshot ? prevSnapshot.municipalities[name] : null;

  // パネルを閉じるボタンは常設の panel-head 側（detail-panel-close）にあるため、
  // ここでは市町村名と県バッジだけを出す
  let html = `<div class="detail-head"><h3>${muniDisplayName(name)}</h3><span class="detail-chip">${loc ? prefDisplayName(loc.pref) : ""}</span></div>`;

  if (!rec) {
    html += `<div class="detail-empty">${I18N.t("detailNoDataAtPoint")}</div>`;
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
    const unknownNote = hasUnknownComponent(m, rec) ? I18N.t("unknownComponentNote") : null;
    const sourceNote = m.key === "water_outage" && isWaterSupplemented(rec)
      ? I18N.t("waterSourceNoteDetail")
      : null;
    html += `<li class="${isCurrent ? "is-current" : ""}">
      <div class="dm-row">
        <span class="dm-dot" style="background:${m.color}"></span>
        <span class="dm-label">${metricLabel(m)}</span>
        <span class="dm-value tabular">${typeof val === "number" ? formatNumber(val) : "—"}</span>
        ${deltaHtml}
      </div>
      ${unknownNote ? `<div class="dm-note">${unknownNote}</div>` : ""}
      ${sourceNote ? `<div class="dm-note">${sourceNote}</div>` : ""}
    </li>`;
  });
  html += "</ul>";

  const waterBits = [];
  if (isWaterPeakValid(rec)) {
    waterBits.push(I18N.t("waterPeakTemplate", { value: `${formatNumber(rec.water_outage_max)}${I18N.t("metricWaterOutageUnit")}` }));
  }
  if (rec.water_period) waterBits.push(I18N.t("waterPeriodTemplate", { value: rec.water_period }));
  if (rec.water_note) waterBits.push(rec.water_note);
  if (waterBits.length) {
    html += `<div class="water-note">${waterBits.join("　／　")}</div>`;
  }

  html += `<div class="sparkline-wrap"><h2>${I18N.t("sparklineHeadingTemplate", { metric: metricLabel(getCurrentMetric()) })}</h2><div id="sparkline-container"></div></div>`;

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
    container.innerHTML = `<div class="detail-empty">${I18N.t("valNoData")}</div>`;
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
      }" stroke="${metric.color}" stroke-width="1.5"><title>${formatDateTimeLocalized(data.snapshots[i].datetime)}: ${formatNumber(
        v
      )}${metricUnit(metric)}</title></circle>`
    );
  });

  const currentVal = pts[state.snapshotIndex];
  const currentLabel =
    typeof currentVal === "number"
      ? I18N.t("sparklineCurrentTemplate", { value: `${formatNumber(currentVal)}${metricUnit(metric)}` })
      : I18N.t("sparklineCurrentNoData");

  container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${I18N.t("sparklineHeadingTemplate", { metric: metricLabel(metric) })}">
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
  // tableCaption の {date} には formatDateTimeLocalized（「時点」相当まで含む）を渡す
  let html = `<table class="data-table"><caption>${I18N.t("tableCaption", {
    date: formatDateTimeLocalized(snapshot.datetime),
  })}</caption><thead><tr><th scope="col">${I18N.t("tableColMuni")}</th>`;
  METRICS.forEach((m) => {
    html += `<th scope="col">${metricLabel(m)}<br>(${metricUnit(m)})</th>`;
  });
  html += "</tr></thead><tbody>";
  Object.keys(muniData).forEach((name) => {
    const rec = snapshot.municipalities[name];
    html += `<tr><th scope="row">${muniDisplayName(name)}${prefBadgeHtml(name)}</th>`;
    METRICS.forEach((m) => {
      const val = rec ? m.get(rec) : null;
      if (typeof val !== "number") {
        html += '<td class="cell-null tabular">—</td>';
      } else {
        const unknownMark = rec && hasUnknownComponent(m, rec) ? "＊" : "";
        const sourceMark = m.key === "water_outage" && isWaterSupplemented(rec) ? "†" : "";
        html += `<td class="tabular">${formatNumber(val)}${unknownMark}${sourceMark}</td>`;
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
  syncHashFromState();
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
  trackEvent("play_timeline", {});
  document.getElementById("btn-play").textContent = I18N.t("tlPause");
  state.playTimer = setInterval(() => {
    if (state.snapshotIndex >= data.snapshots.length - 1) {
      stopPlay();
      return;
    }
    nextSnapshot();
  }, 1200);
}

function stopPlay() {
  const wasPlaying = !!state.playTimer;
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
  }
  document.getElementById("btn-play").textContent = I18N.t("tlPlay");
  if (wasPlaying) syncHashFromState(); // 自動再生が止まったタイミングで一度だけ反映
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
  document.getElementById("current-datetime").textContent = formatDateTimeLocalized(snapshot.datetime);
  const linksEl = document.getElementById("source-links");

  // ニュースマップ中は、その時点に対応する内閣府報へのリンクを出典として明示する
  // （数値マップ側の出典表示には一切手を入れない）
  if (state.mapMode === "news") {
    if (!newsData) {
      linksEl.innerHTML = I18N.t("sourcePrefix") + I18N.t("sourceNewsUnavailable");
      return;
    }
    const reportId = currentReportId(newsData, snapshot.id);
    const report = reportId ? newsData.reports.find((r) => r.id === reportId) : null;
    linksEl.innerHTML = report
      ? `${I18N.t("sourcePrefix")}<a href="${report.source_url}" target="_blank" rel="noopener">${I18N.t(
          "sourceNewsLinkTemplate",
          { date: formatDateTimeLocalized(report.datetime) }
        )}</a>`
      : I18N.t("sourcePrefix") + I18N.t("sourceNewsReportNotFound");
    return;
  }

  // snapshot.sources の資料名(s.name)自体は出典資料名なので翻訳しない
  linksEl.innerHTML =
    I18N.t("sourcePrefix") +
    snapshot.sources
      .map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`)
      .join("、");
}

// 下部固定バーの高さは style.css の --bar-h（固定値）だけで決まる。
// かつてはここで実行時にバーの高さを実測し、その値でCSS変数を書き換える
// 仕組みがあったが、実機で「地図の操作や時点切替のたびにバーが大きくうねる」
// 不具合の原因になっていたため撤去した。JSは--bar-hを一切読み書きしない。
// 高さを一定に保つ責務はCSS側（.timeline-bar の height固定+overflow:hidden、
// 内部の各行の flex-wrap:nowrap+ellipsis）に完全に移した。

// 数値マップの描画本体。旧 renderAll() の中身そのままで、挙動は変えていない
function renderMetricMode(snapshot) {
  const metric = getCurrentMetric();

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
}

function renderNewsMode(snapshot) {
  const reportId = newsData ? currentReportId(newsData, snapshot.id) : null;
  const events = eventsForReport(newsData, reportId);
  const filtered = state.newsActiveCategories
    ? events.filter((e) => state.newsActiveCategories.has(e.category))
    : events;

  updateNewsMap(filtered);
  updateNewsPanel(filtered, reportId);
  if (state.selected) renderDetail();
}

function renderAll() {
  const snapshot = currentSnapshot();
  updateHeaderDateTime(snapshot);

  if (state.mapMode === "metric") renderMetricMode(snapshot);
  else renderNewsMode(snapshot);

  document.getElementById("slider").value = state.snapshotIndex;
}

/* ===========================================================
   UI組み立て・イベント配線
   =========================================================== */

/* ===========================================================
   モード切替（数値マップ／ニュースマップ）
   指標選択(state.metric)とは独立した状態。既存の数値マップの関数・状態には
   一切手を入れず、パネルの表示切替とレイヤーのvisibilityだけで両立させる
   =========================================================== */

const MAP_MODES = [
  { key: "metric", labelKey: "modeMetric" },
  { key: "news", labelKey: "modeNews" },
];

function buildModeSwitchUI() {
  const el = document.getElementById("mode-switch");
  if (!el) return;
  el.innerHTML = "";
  MAP_MODES.forEach((m) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mode-btn";
    btn.dataset.mode = m.key;
    btn.setAttribute("aria-pressed", state.mapMode === m.key ? "true" : "false");
    btn.textContent = I18N.t(m.labelKey);
    btn.addEventListener("click", () => {
      if (state.mapMode !== m.key) trackEvent("change_mode", { mode: m.key });
      setMapMode(m.key);
    });
    el.appendChild(btn);
  });
}

function syncModeButtons() {
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.mode === state.mapMode ? "true" : "false");
  });
}

function setMapMode(mode) {
  if (state.mapMode === mode) return;
  state.mapMode = mode;
  syncModeButtons();

  const metricContentEl = document.getElementById("panel-metric-content");
  const newsContentEl = document.getElementById("panel-news-content");
  if (metricContentEl) metricContentEl.hidden = mode !== "metric";
  if (newsContentEl) newsContentEl.hidden = mode !== "news";

  updateLayerVisibilityForMode();
  renderAll();
  syncHashFromState();
}

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
    btn.innerHTML = `<span class="dot" style="background:${m.color}"></span>${metricLabel(m)}`;
    btn.addEventListener("click", () => {
      state.metric = m.key;
      trackEvent("select_metric", { metric: m.key });
      syncMetricButtons();
      renderAll();
      syncHashFromState();
    });
    el.appendChild(btn);
  });
}

function syncMetricButtons() {
  document.querySelectorAll(".metric-btn").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.key === state.metric ? "true" : "false");
  });
}

// event.epicenter（震央地名）は出典資料の記載そのもの（人名・地名の翻訳表を
// 持たない）なので、市町村名と違って翻訳せずどの言語でも原文のまま表示する
function buildEventMeta() {
  const ev = data.event;
  document.getElementById("event-meta").textContent = I18N.t("eventMetaTemplate", {
    m: ev.magnitude,
    shindo: ev.max_shindo,
    date: I18N.formatEventOrigin(ev.origin),
    epicenter: ev.epicenter,
    depth: ev.depth_km,
  });
}

/* ===========================================================
   i18n 統合（DOM側）
   i18n.js は文字列とフォーマットだけを提供する純ライブラリなので、
   静的DOMへの適用・言語セレクトの構築・言語切替時の再描画はここで行う
   =========================================================== */

// index.html 側の data-i18n / data-i18n-aria / data-i18n-title を現在言語で埋める。
// #detail-content 等は後続の renderAll() が動的内容で上書きするため、
// 言語切替時は必ず applyI18nAttributes() → renderAll() の順で呼ぶこと
function applyI18nAttributes() {
  document.title = I18N.t("appTitle");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = I18N.t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", I18N.t(el.dataset.i18nAria));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = I18N.t(el.dataset.i18nTitle);
  });
  const ep = document.querySelector(".epicenter-label");
  if (ep) ep.textContent = I18N.t("epicenterLabel");
  const play = document.getElementById("btn-play");
  if (play) play.textContent = I18N.t(state.playTimer ? "tlPause" : "tlPlay");
}

// ハンバーガーメニュー: テキスト版データ一覧+11言語リンクをまとめたnav。
// リンク自体はindex.html側に静的に書かれている（JS無効時もクローラ・
// 後方互換としてそのまま機能する）ので、ここでは開閉制御とクリックの
// インターセプト（SPA内遷移化）、現在言語のaria-current付与だけを行う
function buildLangSwitchUI() {
  const toggle = document.getElementById("menu-toggle");
  const menu = document.getElementById("site-menu");
  if (!toggle || !menu) return;

  function openMenu() {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    trackEvent("open_menu", {});
  }
  function closeMenu() {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) closeMenu();
  });

  // メニュー外クリックで閉じる（トグル自身のクリックは上のリスナーで
  // 開閉済みなので、ここでは対象から除く）
  document.addEventListener("click", (e) => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || e.target === toggle) return;
    closeMenu();
  });

  menu.querySelectorAll(".menu-langs a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const code = a.dataset.lang;
      const from = I18N.getLang();
      // trackEventはsetLang前に呼ぶ(付与されるlangが切替前=fromになる)
      if (code !== from) trackEvent("change_lang", { to: code, from });
      I18N.setLang(code);
      syncUrlForLang(code);
      closeMenu();
    });
  });

  const menuDataLink = document.getElementById("menu-data-link");
  if (menuDataLink) {
    menuDataLink.addEventListener("click", () => trackEvent("click_data_page", { placement: "menu" }));
  }

  updateMenuLangCurrent();
}

// 現在言語のリンクにaria-current="true"を付ける（他は外す）
function updateMenuLangCurrent() {
  const current = I18N.getLang();
  document.querySelectorAll(".menu-langs a").forEach((a) => {
    if (a.dataset.lang === current) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  });
  updateDataPageLinks();
}

// テキスト版データページ(data.html)へのリンクを現在言語の版に向ける。
// hrefはビルド時に元ページの言語で焼き込まれており、<base>の解決先も
// ページ読み込み時のURLで固定されるため、クライアントサイドで言語を
// 切り替えた後は絶対パスで明示的に張り替えないと元言語の版に飛び続ける
function updateDataPageLinks() {
  const href = buildLangPath(I18N.getLang()) + "data.html";
  ["data-page-link", "menu-data-link"].forEach((id) => {
    const a = document.getElementById(id);
    if (a) a.setAttribute("href", href);
  });
}

/* ===========================================================
   URL同期: 言語切替時のパス書き換え

   ビルド後の構成: ja（既定）はサイトルート、他言語はルート直下の小文字
   ディレクトリ（例: en/、pt-br/、easy-ja/）。各言語ページだけが
   <meta name="page-lang"> を持つ（ルートのjaには無い）ので、これの有無で
   現在ページがルートか言語ページかを判定する。
   history.replaceStateにはpathnameから組み立てた絶対パスを渡す（相対文字列は
   <base>ではなくlocationを基準に解決されるため混乱を避ける）。
   =========================================================== */

// I18N.LANGSのcodeをそのまま小文字化すればディレクトリ名になる
// （pt-BR→pt-br、easy-ja→easy-ja、他はそのまま）。jaはディレクトリを持たない
function langDirForCode(code) {
  return code === "ja" ? null : code.toLowerCase();
}

// サイトルートの絶対パス（末尾スラッシュ付き）。スクリプト読み込み時に一度だけ
// 計算して固定する。言語切替のreplaceStateでlocation.pathnameは書き換わり続ける
// ため、都度計算すると「/en/zh/vi/ の入れ子」や「サブパス喪失」が起きる。
// page-langメタはビルド時に焼き込まれたDOM上の事実なので、初回のpathnameと
// 組み合わせたときだけルート判定の根拠になる
const SITE_ROOT_PATH = (() => {
  let p = location.pathname;
  if (p.endsWith("index.html")) p = p.slice(0, -"index.html".length);
  if (!p.endsWith("/")) p += "/";
  if (document.querySelector('meta[name="page-lang"]')) {
    // 言語ページ: パス末尾の1階層（<dir>/）を除いたものがルート
    const trimmed = p.slice(0, -1);
    p = p.slice(0, trimmed.lastIndexOf("/") + 1);
  }
  return p;
})();

function siteRootPath() {
  return SITE_ROOT_PATH;
}

function buildLangPath(code) {
  const dir = langDirForCode(code);
  const root = siteRootPath();
  return dir ? `${root}${dir}/` : root;
}

// ?lang=は選択言語をパスそのものが表現するため書き換え後は残さない。
// hash（表示状態の共有用、下記参照）は言語切替と独立に常に保持する
function syncUrlForLang(code) {
  try {
    history.replaceState(null, "", buildLangPath(code) + location.hash);
  } catch (e) {
    /* replaceStateが使えない環境でも致命的ではないため無視 */
  }
}

// 言語が変わったら、静的DOM→動的UI部品→全体再描画の順で作り直す。
// ボタン類は innerHTML から再構築（リスナーも張り直し）で状態は state 側に
// あるため失われない
function onLanguageChanged() {
  updateMenuLangCurrent();
  applyI18nAttributes();
  buildModeSwitchUI();
  buildMetricSwitchUI();
  buildNewsFilterChips();
  buildEventMeta();
  renderAll();
}

function wireControls() {
  document.getElementById("slider").addEventListener("input", (e) => {
    stopPlay();
    setSnapshotIndex(+e.target.value);
  });
  // 計測はドラッグ確定時(change)のみ。inputで送るとドラッグ中に連投される
  document.getElementById("slider").addEventListener("change", () => {
    trackEvent("change_snapshot", { t: currentSnapshot().id, method: "slider" });
  });
  document.getElementById("btn-prev").addEventListener("click", () => {
    stopPlay();
    prevSnapshot();
    trackEvent("change_snapshot", { t: currentSnapshot().id, method: "prev" });
  });
  document.getElementById("btn-next").addEventListener("click", () => {
    stopPlay();
    nextSnapshot();
    trackEvent("change_snapshot", { t: currentSnapshot().id, method: "next" });
  });
  document.getElementById("btn-play").addEventListener("click", togglePlay);

  const infoDataLink = document.getElementById("data-page-link");
  if (infoDataLink) {
    infoDataLink.addEventListener("click", () => trackEvent("click_data_page", { placement: "info" }));
  }

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
    syncHashFromState();
  });

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
    trackEvent("open_info", {});
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
      syncHashFromState();
    }
  });
}

/* ===========================================================
   URL同期: 表示状態のハッシュ共有

   形式: #mode=news&t=<スナップショットID>&metric=<指標キー>&muni=<市町村名>
   （キーは省略可・順不同）。既定値（mode=metric・最新時点・既定指標・
   未選択）と同じ項目はキーごと省略し、全部既定ならハッシュ自体を空にする。
   pushStateは使わず常にreplaceStateで、閲覧履歴を汚さない。
   =========================================================== */

function syncHashFromState() {
  if (state.playTimer) return; // 自動再生中の毎tickでは書かない（止まったときにstopPlay側で一度だけ）
  try {
    const params = new URLSearchParams();
    if (state.mapMode !== "metric") params.set("mode", state.mapMode);
    if (state.snapshotIndex !== data.snapshots.length - 1) params.set("t", currentSnapshot().id);
    if (state.metric !== "evacuees") params.set("metric", state.metric);
    if (state.selected) params.set("muni", state.selected);
    const qs = params.toString();
    history.replaceState(null, "", location.pathname + location.search + (qs ? `#${qs}` : ""));
  } catch (e) {
    /* history.replaceStateが使えない環境でも致命的ではないため無視 */
  }
}

// data取得後、snapshotIndex=最新を設定した直後に呼ぶ。不正な値・未知のキーは
// すべて黙って無視し（コンソールエラーを出さない）、古い共有リンクを壊さない
// よう該当キーが見つからない項目は既定のまま残す
function applyStateFromHash() {
  if (!location.hash) return;
  try {
    const params = new URLSearchParams(location.hash.slice(1));

    if (params.get("mode") === "news") setMapMode("news");

    const tParam = params.get("t");
    if (tParam) {
      const idx = data.snapshots.findIndex((s) => s.id === tParam);
      if (idx !== -1) state.snapshotIndex = idx;
    }

    const metricParam = params.get("metric");
    if (metricParam && metricByKey(metricParam)) state.metric = metricParam;

    const muniParam = params.get("muni");
    if (muniParam && muniData && muniData[muniParam]) selectMunicipality(muniParam, "hash");
  } catch (e) {
    /* 不正なhashは黙って無視する */
  }
}

/* ===========================================================
   起動
   =========================================================== */

async function boot() {
  // URL(?lang=)・localStorageから言語を復元。データ到着前でも静的DOMは翻訳できる
  I18N.init();
  buildLangSwitchUI();
  applyI18nAttributes();
  I18N.onChange(onLanguageChanged);

  const [muniRes, timelineRes] = await Promise.all([fetch("data/municipalities.json"), fetch("data/timeline.json")]);
  muniData = await muniRes.json();
  data = await timelineRes.json();

  // ニュースマップ用データは失敗しても数値マップ側を一切壊さないよう、
  // 個別にtry/catchする（未生成・404でも起動は続行する）
  try {
    const newsRes = await fetch("data/news.json");
    if (newsRes.ok) newsData = await newsRes.json();
  } catch (e) {
    newsData = null;
  }
  if (newsData) state.newsActiveCategories = new Set(newsData.categories);

  // パネルの初期開閉（モバイルは畳む／デスクトップは開く）を、hash由来の
  // 市町村選択より先に決めておく。順序を逆にすると、hashで開いた詳細パネルを
  // このデフォルト適用が直後に閉じ直してしまう（モバイル時）
  initPanelState();

  // 直近時点を初期表示にし、そこから過去へ遡れるようにする
  state.snapshotIndex = data.snapshots.length - 1;
  applyStateFromHash();
  // 共有URL(ハッシュ付き)経由の流入を計測する。individual値はselect_muni等が持つ
  if (location.hash) {
    try {
      const p = new URLSearchParams(location.hash.slice(1));
      trackEvent("open_shared_url", {
        mode: p.get("mode") || "metric",
        has_t: !!p.get("t"),
        has_muni: !!p.get("muni"),
      });
    } catch (e) {
      /* 計測は本体機能ではないため失敗しても無視 */
    }
  }

  const sliderEl = document.getElementById("slider");
  sliderEl.max = String(data.snapshots.length - 1);
  sliderEl.value = String(state.snapshotIndex);

  buildEventMeta();
  buildModeSwitchUI();
  buildMetricSwitchUI();
  buildNewsFilterChips();
  wireControls();
  wireLabelHint();
  initLegendDisclosure();
  initMap();

  // ?lang=xx で開かれていた場合、readInitialLangの処理は既に済んでいるので
  // ここでURLだけを正規のパス（ルート or 言語ディレクトリ）に整える
  try {
    if (new URLSearchParams(location.search).has("lang")) syncUrlForLang(I18N.getLang());
  } catch (e) {
    /* URLSearchParams非対応環境でも致命的ではないため無視 */
  }
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
