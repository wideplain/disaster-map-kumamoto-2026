#!/usr/bin/env node
"use strict";

/* ===========================================================
   SEO用ページ生成器。web/ を _site/ にコピーしたうえで
   言語別ページ(index.html×11)・data.html×11・sitemap.xmlを生成する。
   依存なしの素のNode(CommonJS)。node scripts/build_pages.js で実行。
   災害進行中に毎日デプロイされるため、末尾の自己検査が失敗したら
   必ず exit 1 する(壊れたページを誤って公開しないため)。
   =========================================================== */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const WEB_DIR = path.join(ROOT, "web");
const SITE_DIR = path.join(ROOT, "_site");

const BASE_URL = "https://kumamoto-disaster-map-2026.wideplain.com/";
const OGP_IMAGE_URL = BASE_URL + "ogp.png";
// サイト初公開日(v1.0.0公開日)。JSON-LDのdatePublished用で以後変えない
const SITE_PUBLISHED_DATE = "2026-08-05";

const I18N = require(path.join(WEB_DIR, "i18n.js"));
const timeline = JSON.parse(fs.readFileSync(path.join(WEB_DIR, "data", "timeline.json"), "utf8"));
const muniData = JSON.parse(fs.readFileSync(path.join(WEB_DIR, "data", "municipalities.json"), "utf8"));

const snapshots = timeline.snapshots;
const latestSnapshot = snapshots[snapshots.length - 1];
const firstSnapshot = snapshots[0];

/* ===========================================================
   言語別ページ設定。dir='' がルート(ja)。easy-jaはhreflangクラスタに
   入れない(妥当なBCP-47タグがないため自己canonicalのみ)。
   I18N.LANGS(i18n.js側の言語定義)と1:1対応させ、取りこぼしを自己検査で検知する
   =========================================================== */
const LANGS = [
  { code: "ja", dir: "", htmlLang: "ja", hreflang: "ja", ogLocale: "ja_JP", cluster: true },
  { code: "easy-ja", dir: "easy-ja", htmlLang: "ja", hreflang: null, ogLocale: "ja_JP", cluster: false },
  { code: "en", dir: "en", htmlLang: "en", hreflang: "en", ogLocale: "en_US", cluster: true },
  { code: "zh", dir: "zh", htmlLang: "zh-Hans", hreflang: "zh-Hans", ogLocale: "zh_CN", cluster: true },
  { code: "vi", dir: "vi", htmlLang: "vi", hreflang: "vi", ogLocale: "vi_VN", cluster: true },
  { code: "ko", dir: "ko", htmlLang: "ko", hreflang: "ko", ogLocale: "ko_KR", cluster: true },
  { code: "fil", dir: "fil", htmlLang: "fil", hreflang: "fil", ogLocale: "fil_PH", cluster: true },
  { code: "ne", dir: "ne", htmlLang: "ne", hreflang: "ne", ogLocale: "ne_NP", cluster: true },
  { code: "pt-BR", dir: "pt-br", htmlLang: "pt-BR", hreflang: "pt-BR", ogLocale: "pt_BR", cluster: true },
  { code: "id", dir: "id", htmlLang: "id", hreflang: "id", ogLocale: "id_ID", cluster: true },
  { code: "my", dir: "my", htmlLang: "my", hreflang: "my", ogLocale: "my_MM", cluster: true },
];

if (LANGS.length !== I18N.LANGS.length || LANGS.some((l) => !I18N.LANGS.some((il) => il.code === l.code))) {
  console.error("LANGS が i18n.js の I18N_LANGS と一致していません");
  process.exit(1);
}

const CLUSTER_LANGS = LANGS.filter((l) => l.cluster);
const ALL_OG_LOCALES = [...new Set(LANGS.map((l) => l.ogLocale))];

/* ===========================================================
   指標定義。web/app.js の METRICS(色を除く算出ロジック)を
   静的ページ生成用にそのまま踏襲する(表・サマリの数値を本体と一致させるため)
   =========================================================== */
function numOrNull(v) {
  return typeof v === "number" ? v : null;
}
function sumOrNull(...vals) {
  const known = vals.filter((v) => v !== null && v !== undefined);
  if (known.length === 0) return null;
  return vals.reduce((acc, v) => acc + (v === null || v === undefined ? 0 : v), 0);
}
const METRICS = [
  { key: "evacuees", labelKey: "metricEvacueesLabel", unitKey: "metricEvacueesUnit", summaryKey: "evacuees",
    get: (m) => (m ? numOrNull(m.evacuees) : null) },
  { key: "shelters", labelKey: "metricSheltersLabel", unitKey: "metricSheltersUnit", summaryKey: "shelters",
    get: (m) => (m ? numOrNull(m.shelters) : null) },
  { key: "deaths", labelKey: "metricDeathsLabel", unitKey: "metricDeathsUnit", summaryKey: "deaths",
    get: (m) => (m ? numOrNull(m.deaths) : null) },
  { key: "injured", labelKey: "metricInjuredLabel", unitKey: "metricInjuredUnit", summaryKey: "injured",
    components: ["injured_light", "injured_moderate", "injured_severe"],
    get: (m) => (m ? sumOrNull(m.injured_light, m.injured_moderate, m.injured_severe) : null) },
  { key: "houses", labelKey: "metricHousesLabel", unitKey: "metricHousesUnit", summaryKey: "houses",
    components: ["houses_full", "houses_large_half", "houses_half", "houses_partial", "houses_unclassified"],
    get: (m) => (m ? sumOrNull(m.houses_full, m.houses_large_half, m.houses_half, m.houses_partial, m.houses_unclassified) : null) },
  { key: "water_outage", labelKey: "metricWaterOutageLabel", unitKey: "metricWaterOutageUnit", summaryKey: "water_outage",
    get: (m) => (m ? numOrNull(m.water_outage) : null) },
  { key: "water_stations", labelKey: "metricWaterStationsLabel", unitKey: "metricWaterStationsUnit",
    get: (m) => (m ? numOrNull(m.water_stations) : null) },
  { key: "power_outage", labelKey: "metricPowerOutageLabel", unitKey: "metricPowerOutageUnit",
    get: (m) => (m ? numOrNull(m.power_outage) : null) },
];
const TIMESERIES_METRIC_KEYS = ["evacuees", "shelters", "deaths", "injured", "houses", "water_outage"];

function hasUnknownComponent(metric, rec) {
  if (!metric.components || !rec) return false;
  const values = metric.components.map((f) => rec[f]);
  const hasNull = values.some((v) => v === null || v === undefined);
  const hasNumber = values.some((v) => typeof v === "number");
  return hasNull && hasNumber;
}
function isWaterSupplemented(rec) {
  return !!(rec && rec.water_outage_source);
}
function isKumamotoMuni(name) {
  const loc = muniData[name];
  return !!loc && loc.pref === "熊本県";
}
// 県公表の合計(summary)にない指標(給水所数・停電戸数)は市町村別データの
// 合計で代替する。県公表値そのものではない点に注意(app.js の sumAcrossMuniOrNull と同ロジック)
function sumAcrossMuniOrNull(snapshot, metric) {
  const vals = Object.entries(snapshot.municipalities)
    .filter(([name]) => isKumamotoMuni(name))
    .map(([, rec]) => metric.get(rec))
    .filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0);
}
function prefMetricValue(snapshot, metric) {
  if (metric.summaryKey) return numOrNull(snapshot.summary[metric.summaryKey]);
  return sumAcrossMuniOrNull(snapshot, metric);
}

/* ===========================================================
   ユーティリティ
   =========================================================== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeJsonLd(json) {
  // </script> によるHTML破壊を防ぐ(値に含まれることは想定していないが念のため)
  return JSON.stringify(json).replace(/</g, "\\u003c");
}
function fmtNum(v, langCode) {
  if (typeof v !== "number") return null;
  const intlLang = langCode === "easy-ja" ? "ja" : langCode;
  return new Intl.NumberFormat(intlLang).format(v);
}
function fmtNumOrDash(v, langCode) {
  const s = fmtNum(v, langCode);
  return s === null ? I18N.t("valDash") : s;
}
function pageUrl(lang) {
  return BASE_URL + (lang.dir ? lang.dir + "/" : "");
}
function dataUrl(lang) {
  return pageUrl(lang) + "data.html";
}
function muniSlug(name) {
  const entry = I18N._MUNI_ROMAJI[name];
  if (entry) return entry[0].toLowerCase();
  return encodeURIComponent(name);
}
function interpolate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m));
}

// metaDescriptionTemplate/ogDescriptionTemplateの{date}は、テンプレート自身が
// 「時点で」「As of」等の言い回しを前後に付けて{date}と組む設計(例: 英語
// "As of {date}:" / 日本語 "{date}時点で")。{date}側は年・言語別の項目順を
// 持つ素の日時（「時点」等の言い回しを含まない）が期待値。I18N.formatDateTimeForLang()
// はその言い回しを含んだ文字列を返すため使わず、Intl.DateTimeFormat で
// 言語別に整形する（pt-BR/vi/id/fil 等で MM/DD を月日と誤読させない・年を含めるため）
function intlDateTime(iso, langCode) {
  const intlLang = langCode === "easy-ja" ? "ja" : langCode;
  return new Intl.DateTimeFormat(intlLang, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

function descriptionVars(lang) {
  return {
    date: intlDateTime(latestSnapshot.datetime, lang.code),
    evacuees: fmtNumOrDash(latestSnapshot.summary.evacuees, lang.code),
    shelters: fmtNumOrDash(latestSnapshot.summary.shelters, lang.code),
    water: fmtNumOrDash(latestSnapshot.summary.water_outage, lang.code),
  };
}
function metaDescriptionFor(lang) {
  I18N.setLang(lang.code, { persist: false });
  return interpolate(I18N._STRINGS[lang.code].metaDescriptionTemplate, descriptionVars(lang));
}
function ogDescriptionFor(lang) {
  I18N.setLang(lang.code, { persist: false });
  return interpolate(I18N._STRINGS[lang.code].ogDescriptionTemplate, descriptionVars(lang));
}

/* ===========================================================
   JSON-LD
   =========================================================== */
function buildIndexJsonLd(lang) {
  I18N.setLang(lang.code, { persist: false });
  const inLanguage = lang.hreflang || lang.htmlLang;
  const description = metaDescriptionFor(lang);
  const person = { "@type": "Person", name: "wideplain", url: "https://github.com/wideplain" };
  const website = {
    "@type": "WebSite",
    name: I18N.t("appTitle"),
    url: pageUrl(lang),
    inLanguage,
    description,
    publisher: person,
    isAccessibleForFree: true,
  };
  // ページ更新日時の標準シグナル。Googleは sitemap の lastmod に加えて
  // WebPage の dateModified を更新判定に使う。datePublished はサイト公開日で固定
  const webpage = {
    "@type": "WebPage",
    url: pageUrl(lang),
    name: I18N.t("appTitle"),
    inLanguage,
    description,
    isPartOf: website,
    datePublished: SITE_PUBLISHED_DATE,
    dateModified: timeline.updated,
  };
  const isBasedOn = latestSnapshot.sources.map((s) => ({ "@type": "CreativeWork", name: s.name, url: s.url }));
  const variableMeasured = METRICS.map((m) => ({
    "@type": "PropertyValue",
    name: I18N.t(m.labelKey),
    unitText: I18N.t(m.unitKey).trim(),
  }));
  const dataset = {
    "@type": "Dataset",
    name: `${I18N.t("appTitle")} - ${I18N.t("dataPageLinkText")}`,
    description,
    url: dataUrl(lang),
    creator: person,
    license: "https://creativecommons.org/licenses/by/4.0/",
    isBasedOn,
    temporalCoverage: `${firstSnapshot.datetime}/${latestSnapshot.datetime}`,
    spatialCoverage: {
      "@type": "Place",
      name: "熊本県",
      geo: { "@type": "GeoShape", box: "32.1 129.9 33.2 131.3" },
    },
    variableMeasured,
    distribution: {
      "@type": "DataDownload",
      contentUrl: BASE_URL + "data/timeline.json",
      encodingFormat: "application/json",
    },
    dateModified: timeline.updated,
  };
  return { "@context": "https://schema.org", "@graph": [website, webpage, dataset] };
}

function buildDataPageJsonLd(lang) {
  I18N.setLang(lang.code, { persist: false });
  const inLanguage = lang.hreflang || lang.htmlLang;
  const description = metaDescriptionFor(lang);
  const webpage = {
    "@type": "WebPage",
    name: `${I18N.t("appTitle")} - ${I18N.t("dataPageLinkText")}`,
    url: dataUrl(lang),
    inLanguage,
    description,
    isPartOf: { "@type": "WebSite", name: I18N.t("appTitle"), url: pageUrl(lang) },
    datePublished: SITE_PUBLISHED_DATE,
    dateModified: timeline.updated,
  };
  // Dataset は index 側と同内容にする。description は Google の Dataset
  // リッチリザルトの必須項目(欠けると Rich Results Test で invalid 判定)
  const isBasedOn = latestSnapshot.sources.map((s) => ({ "@type": "CreativeWork", name: s.name, url: s.url }));
  const variableMeasured = METRICS.map((m) => ({
    "@type": "PropertyValue",
    name: I18N.t(m.labelKey),
    unitText: I18N.t(m.unitKey).trim(),
  }));
  const dataset = {
    "@type": "Dataset",
    name: `${I18N.t("appTitle")} - ${I18N.t("dataPageLinkText")}`,
    description,
    url: dataUrl(lang),
    inLanguage,
    creator: { "@type": "Person", name: "wideplain", url: "https://github.com/wideplain" },
    license: "https://creativecommons.org/licenses/by/4.0/",
    isBasedOn,
    temporalCoverage: `${firstSnapshot.datetime}/${latestSnapshot.datetime}`,
    spatialCoverage: {
      "@type": "Place",
      name: "熊本県",
      geo: { "@type": "GeoShape", box: "32.1 129.9 33.2 131.3" },
    },
    variableMeasured,
    distribution: {
      "@type": "DataDownload",
      contentUrl: BASE_URL + "data/timeline.json",
      encodingFormat: "application/json",
    },
    dateModified: timeline.updated,
  };
  return { "@context": "https://schema.org", "@graph": [webpage, dataset] };
}

/* ===========================================================
   BUILD:HEAD ブロック(index.html用)
   =========================================================== */
function buildHeadBlock(lang) {
  I18N.setLang(lang.code, { persist: false });
  const title = I18N.t("appTitle");
  const description = metaDescriptionFor(lang);
  const ogDescription = ogDescriptionFor(lang);
  const canonical = pageUrl(lang);

  let hreflangHtml = "";
  if (lang.cluster) {
    const lines = CLUSTER_LANGS.map(
      (l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${pageUrl(l)}">`
    );
    lines.push(`<link rel="alternate" hreflang="x-default" href="${pageUrl(LANGS[0])}">`);
    hreflangHtml = lines.join("\n") + "\n";
  }

  const alternateLocales = ALL_OG_LOCALES.filter((loc) => loc !== lang.ogLocale)
    .map((loc) => `<meta property="og:locale:alternate" content="${loc}">`)
    .join("\n");

  const jsonLd = buildIndexJsonLd(lang);

  return `<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
${hreflangHtml}<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(title)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(ogDescription)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${OGP_IMAGE_URL}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${lang.ogLocale}">
${alternateLocales}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${escapeJsonLd(jsonLd)}</script>`;
}

/* ===========================================================
   index.html 生成
   =========================================================== */
const INDEX_TEMPLATE = fs.readFileSync(path.join(WEB_DIR, "index.html"), "utf8");

function assertCount(html, needle, label, expected) {
  let count;
  if (typeof needle === "string") {
    count = html.split(needle).length - 1;
  } else {
    const g = new RegExp(needle.source, needle.flags.includes("g") ? needle.flags : needle.flags + "g");
    count = [...html.matchAll(g)].length;
  }
  if (count !== expected) throw new Error(`テンプレート構造が想定と異なる(${label}: ${count}回検出、期待値${expected})`);
}
function assertOnce(html, needle, label) {
  assertCount(html, needle, label, 1);
}

// BUILD:HEAD / BUILD:STATIC の開始マーカーは説明文を含む複数行コメントなので、
// 開始コメント全体にマッチする正規表現で検出する(終了マーカーは単純な固定文字列)
const HEAD_BLOCK_RE = /(<!--\s*BUILD:HEAD[\s\S]*?-->\n)([\s\S]*?)(<!-- \/BUILD:HEAD -->)/;
const STATIC_OPEN_RE = /<!--\s*BUILD:STATIC[\s\S]*?-->/;

const H1_APP_TITLE = '<h1 data-i18n="appTitle">令和8年熊本地震 被害状況マップ</h1>';
const DATA_PAGE_LINK_ANCHOR =
  '<a href="data.html" id="data-page-link" data-i18n="dataPageLinkText">テキスト版データ一覧（全市町村・全指標）</a>';
// ヘッダーのハンバーガーメニュー内、テキスト版データへのリンク(#data-page-link と同じ要領で言語別にhref/テキストを差し替える)
const MENU_DATA_LINK_ANCHOR =
  '<a href="data.html" id="menu-data-link" class="menu-data-link" data-i18n="dataPageLinkText">テキスト版データ一覧（全市町村・全指標）</a>';
const STATIC_NAV_DATA_ANCHOR = '<a href="data.html">テキスト版データ一覧（全市町村・全指標）</a>';
// noscript内の<p>は日本語の地の文にリンクが埋め込まれた1文なので、段落全体を
// noscriptNote({link: ...})の翻訳文へ丸ごと差し替える(単純なアンカー差し替えでは
// 前後の日本語文が残ってしまうため)
const NOSCRIPT_P_RE = /<p>[\s\S]*?<a href="data\.html">テキスト版データ一覧（全市町村・全指標）<\/a>[\s\S]*?<\/p>/;

// テンプレート前提の検証。web/index.html の担当外セクションが変わっていたら
// 黙って壊れたページを作らず、ここで気づけるようにする
assertOnce(INDEX_TEMPLATE, '<base href="./">', "base tag");
assertOnce(INDEX_TEMPLATE, HEAD_BLOCK_RE, "BUILD:HEAD block");
assertOnce(INDEX_TEMPLATE, STATIC_OPEN_RE, "BUILD:STATIC open");
assertOnce(INDEX_TEMPLATE, "<!-- /BUILD:STATIC -->", "BUILD:STATIC close");
assertOnce(INDEX_TEMPLATE, '<html lang="ja">', "html lang");
assertOnce(INDEX_TEMPLATE, H1_APP_TITLE, "h1 appTitle");
assertOnce(INDEX_TEMPLATE, DATA_PAGE_LINK_ANCHOR, "data-page-link anchor");
assertOnce(INDEX_TEMPLATE, MENU_DATA_LINK_ANCHOR, "menu-data-link anchor");
assertOnce(INDEX_TEMPLATE, NOSCRIPT_P_RE, "noscript paragraph");
// 言語間リンク(#site-menu .menu-langs)。base解決で全ページ共通のためhref差し替えは不要だが、
// data-lang の11言語ぶんがテンプレートに揃っていることだけ検査する
assertCount(INDEX_TEMPLATE, /data-lang="[^"]+"/g, "menu-langs data-lang attrs", 11);
// noscript内にのみ残るテキスト版データへのプレーンな<a>(idなし)
assertCount(INDEX_TEMPLATE, STATIC_NAV_DATA_ANCHOR, "static data.html anchor(noscript)", 1);

function generateIndexHtml(lang) {
  I18N.setLang(lang.code, { persist: false });
  let html = INDEX_TEMPLATE;

  if (lang.dir) {
    html = html.replace('<base href="./">', '<base href="../">\n<meta name="page-lang" content="' + lang.code + '">');
  }

  html = html.replace('<html lang="ja">', `<html lang="${lang.htmlLang}">`);

  html = html.replace(HEAD_BLOCK_RE, (full, open, _content, close) => `${open}${buildHeadBlock(lang)}\n${close}`);

  const dataHref = lang.dir ? `${lang.dir}/data.html` : "data.html";
  const dataLinkText = escapeHtml(I18N.t("dataPageLinkText"));
  const dataLinkHtml = `<a href="${dataHref}">${dataLinkText}</a>`;

  // noscript の文全体をnoscriptNoteの翻訳(HTMLのリンクを{link}に埋め込む想定)へ差し替える。
  // これでnav側に残る同一リテラルは1回だけになる
  html = html.replace(NOSCRIPT_P_RE, `<p>${I18N.t("noscriptNote", { link: dataLinkHtml })}</p>`);
  html = html.split(STATIC_NAV_DATA_ANCHOR).join(dataLinkHtml);

  html = html.replace(
    DATA_PAGE_LINK_ANCHOR,
    `<a href="${dataHref}" id="data-page-link" data-i18n="dataPageLinkText">${dataLinkText}</a>`
  );

  html = html.replace(
    MENU_DATA_LINK_ANCHOR,
    `<a href="${dataHref}" id="menu-data-link" class="menu-data-link" data-i18n="dataPageLinkText">${dataLinkText}</a>`
  );

  html = html.replace(H1_APP_TITLE, `<h1 data-i18n="appTitle">${escapeHtml(I18N.t("appTitle"))}</h1>`);

  return html;
}

/* ===========================================================
   data.html 生成(素の静的HTML。app.js/maplibreは読み込まない)
   =========================================================== */
const DATA_PAGE_CSS = `
:root { --ink:#0b0b0b; --ink-sub:#52514e; --line:#e1e0d9; --surface:#fcfcfb; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 960px; padding: 24px 16px 64px; background: var(--surface);
  color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
  line-height: 1.6; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
h2 { font-size: 1.15rem; margin: 2em 0 0.5em; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
.updated { color: var(--ink-sub); margin: 0 0 1em; }
.disclaimer { background: #fff6e0; border: 1px solid #e8c766; border-radius: 6px; padding: 12px 16px; font-weight: bold; }
.back-link { display: inline-block; margin: 0 0 1em; }
table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 0.875rem; }
caption { text-align: left; color: var(--ink-sub); font-size: 0.8125rem; margin-bottom: 6px; caption-side: top; }
th, td { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
  padding: 6px 10px; text-align: right; white-space: nowrap;
  font-variant-numeric: tabular-nums; background: #fff; }
tbody tr:nth-child(even) th, tbody tr:nth-child(even) td { background: #f7f6f1; }
th[scope="row"] { text-align: left; }
thead th { background: #f2f1ec; text-align: center; white-space: normal; font-size: 0.8125rem; }
/* 縦横スクロールしてもヘッダー行と市町村名列が見え続けるようにする。
   sticky を効かせるため table-scroll 自体を縦横のスクロールコンテナにする */
.table-scroll { overflow: auto; max-height: 78vh; border: 1px solid var(--line); border-radius: 6px; }
.table-scroll table { width: max-content; min-width: 100%; }
.table-scroll thead th { position: sticky; top: 0; z-index: 2; }
.table-scroll th[scope="row"] { position: sticky; left: 0; z-index: 1; }
.table-scroll thead th:first-child { position: sticky; left: 0; z-index: 3; }
/* 0とデータなしは薄くして、実被害の数値だけが浮き上がるようにする */
td.zero, td.nodata { color: #b8b6ae; }
/* #muni-xxx アンカーで飛んできた行を強調 */
tr:target th, tr:target td { background: #fff3c4; }
footer { margin-top: 2.5em; color: var(--ink-sub); font-size: 0.8125rem; }
`;

function buildDataHtmlHead(lang) {
  I18N.setLang(lang.code, { persist: false });
  const title = `${I18N.t("appTitle")} - ${I18N.t("dataPageLinkText")}`;
  const description = metaDescriptionFor(lang);
  const canonical = dataUrl(lang);

  let hreflangHtml = "";
  if (lang.cluster) {
    const lines = CLUSTER_LANGS.map((l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${dataUrl(l)}">`);
    lines.push(`<link rel="alternate" hreflang="x-default" href="${dataUrl(LANGS[0])}">`);
    hreflangHtml = lines.join("\n") + "\n";
  }

  const jsonLd = buildDataPageJsonLd(lang);

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
${hreflangHtml}<script async src="https://www.googletagmanager.com/gtag/js?id=G-TCSJHDE22Z"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-TCSJHDE22Z');
</script>
<script type="application/ld+json">${escapeJsonLd(jsonLd)}</script>
<style>${DATA_PAGE_CSS}</style>`;
}

function buildPrefSummaryTable(lang) {
  I18N.setLang(lang.code, { persist: false });
  let html = `<div class="table-scroll"><table><caption>${escapeHtml(
    I18N.t("tableCaption", { date: I18N.formatDateTimeForLang(latestSnapshot.datetime, lang.code) })
  )}</caption><tbody>`;
  METRICS.forEach((m) => {
    const val = prefMetricValue(latestSnapshot, m);
    const cell = val === null ? I18N.t("valNoData") : `${fmtNum(val, lang.code)}${I18N.t(m.unitKey)}`;
    const cls = val === null ? ' class="nodata"' : "";
    html += `<tr><th scope="row">${escapeHtml(I18N.t(m.labelKey))}</th><td${cls}>${escapeHtml(cell)}</td></tr>`;
  });
  html += "</tbody></table></div>";
  return html;
}

function buildMuniTable(lang) {
  I18N.setLang(lang.code, { persist: false });
  let html = `<div class="table-scroll"><table><caption>${escapeHtml(
    I18N.t("tableCaption", { date: I18N.formatDateTimeForLang(latestSnapshot.datetime, lang.code) })
  )}</caption><thead><tr><th scope="col">${escapeHtml(I18N.t("tableColMuni"))}</th>`;
  METRICS.forEach((m) => {
    html += `<th scope="col">${escapeHtml(I18N.t(m.labelKey))}<br>(${escapeHtml(I18N.t(m.unitKey))})</th>`;
  });
  html += "</tr></thead><tbody>";
  // 熊本県内を先、県外(ほぼ全指標が未公表=—)を後に並べる。県外が先頭に
  // 並ぶと実データに辿り着く前に「—」の行が続いて読みにくい
  const names = Object.keys(muniData);
  const orderedNames = [
    ...names.filter((n) => muniData[n].pref === "熊本県"),
    ...names.filter((n) => muniData[n].pref !== "熊本県"),
  ];
  orderedNames.forEach((name) => {
    const rec = latestSnapshot.municipalities[name];
    const loc = muniData[name];
    const displayName = escapeHtml(I18N.muniName(name, lang.code));
    const prefBadge = loc.pref === "熊本県" ? "" : ` <small>(${escapeHtml(I18N.prefName(loc.pref, lang.code))})</small>`;
    html += `<tr id="muni-${muniSlug(name)}"><th scope="row">${displayName}${prefBadge}</th>`;
    METRICS.forEach((m) => {
      const val = rec ? m.get(rec) : null;
      if (typeof val !== "number") {
        html += `<td class="nodata">${escapeHtml(I18N.t("valDash"))}</td>`;
      } else {
        const unknownMark = rec && hasUnknownComponent(m, rec) ? "＊" : "";
        const sourceMark = m.key === "water_outage" && isWaterSupplemented(rec) ? "†" : "";
        const zeroClass = val === 0 && !unknownMark && !sourceMark ? ' class="zero"' : "";
        html += `<td${zeroClass}>${fmtNum(val, lang.code)}${unknownMark}${sourceMark}</td>`;
      }
    });
    html += "</tr>";
  });
  html += "</tbody></table></div>";
  return html;
}

function buildTimeseriesTable(lang) {
  I18N.setLang(lang.code, { persist: false });
  const heading = I18N.t("sparklineHeadingTemplate", { metric: I18N.t("statPrefTotal") });
  const tsMetrics = METRICS.filter((m) => TIMESERIES_METRIC_KEYS.includes(m.key));
  let html = `<h2>${escapeHtml(heading)}</h2><div class="table-scroll"><table><thead><tr><th scope="col"></th>`;
  tsMetrics.forEach((m) => {
    html += `<th scope="col">${escapeHtml(I18N.t(m.labelKey))}<br>(${escapeHtml(I18N.t(m.unitKey))})</th>`;
  });
  html += "</tr></thead><tbody>";
  snapshots.forEach((snap) => {
    html += `<tr><th scope="row">${escapeHtml(I18N.formatDateTimeForLang(snap.datetime, lang.code))}</th>`;
    tsMetrics.forEach((m) => {
      const val = numOrNull(snap.summary[m.summaryKey]);
      if (val === null) html += `<td class="nodata">${escapeHtml(I18N.t("valDash"))}</td>`;
      else html += `<td${val === 0 ? ' class="zero"' : ""}>${fmtNum(val, lang.code)}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table></div>";
  return html;
}

// app.js の出典表示(sourcePrefix + リンクを「、」区切りで並べる)と同じ組み方にする
function buildSourceLinks(lang) {
  I18N.setLang(lang.code, { persist: false });
  const links = latestSnapshot.sources
    .map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a>`)
    .join("、");
  return `<p>${escapeHtml(I18N.t("sourcePrefix"))}${links}</p>`;
}

function generateDataHtml(lang) {
  I18N.setLang(lang.code, { persist: false });
  const backHref = "./";
  const title = I18N.t("appTitle");
  const updated = I18N.formatDateTimeForLang(latestSnapshot.datetime, lang.code);

  return `<!doctype html>
<html lang="${lang.htmlLang}" dir="ltr">
<head>
${buildDataHtmlHead(lang)}
</head>
<body>
<a class="back-link" href="${backHref}">${escapeHtml(I18N.t("tableClose"))}</a>
<h1>${escapeHtml(title)}</h1>
<p class="updated">${escapeHtml(updated)}</p>
<p class="disclaimer">${escapeHtml(I18N.t("disclaimerStrong"))}</p>

<h2>${escapeHtml(I18N.t("statPrefTotal"))}</h2>
${buildPrefSummaryTable(lang)}

<h2>${escapeHtml(I18N.t("tableHeading"))}</h2>
${buildMuniTable(lang)}

${buildTimeseriesTable(lang)}

<h2>${escapeHtml(I18N.t("tlInfoToggle"))}</h2>
${buildSourceLinks(lang)}
<p>${escapeHtml(I18N.t("infoOpenSourcePrefix"))} <a href="https://github.com/wideplain/disaster-map-kumamoto-2026" target="_blank" rel="noopener">${escapeHtml(
    I18N.t("infoGithubLinkText")
  )}</a></p>

<footer><a href="${backHref}">${escapeHtml(I18N.t("tableClose"))}</a></footer>
</body>
</html>
`;
}

/* ===========================================================
   sitemap.xml
   =========================================================== */
function buildSitemap() {
  const lastmod = timeline.updated;
  const urls = [];
  LANGS.forEach((lang) => {
    urls.push({ loc: pageUrl(lang), cluster: lang.cluster, urlFn: pageUrl });
    urls.push({ loc: dataUrl(lang), cluster: lang.cluster, urlFn: dataUrl });
  });

  const blocks = urls.map(({ loc, cluster, urlFn }) => {
    let alt = "";
    if (cluster) {
      const lines = CLUSTER_LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${urlFn(l)}"/>`);
      lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${urlFn(LANGS[0])}"/>`);
      alt = "\n" + lines.join("\n");
    }
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>${alt}\n  </url>`;
  });

  // xml-stylesheet はブラウザで開いたとき人間可読のテーブルにするためのもの。
  // クローラ(Google)はこの処理命令を無視するためSEOには影響しない
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="sitemap.xsl"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${blocks.join(
    "\n"
  )}\n</urlset>\n`;
}

/* ===========================================================
   実行: web/ -> _site/ コピー、各ページ生成
   =========================================================== */
fs.rmSync(SITE_DIR, { recursive: true, force: true });
fs.cpSync(WEB_DIR, SITE_DIR, { recursive: true });

const generatedFiles = []; // { path, kind: 'index'|'data', lang }

LANGS.forEach((lang) => {
  const outDir = lang.dir ? path.join(SITE_DIR, lang.dir) : SITE_DIR;
  fs.mkdirSync(outDir, { recursive: true });

  const indexPath = path.join(outDir, "index.html");
  fs.writeFileSync(indexPath, generateIndexHtml(lang), "utf8");
  generatedFiles.push({ path: indexPath, kind: "index", lang });

  const dataPath = path.join(outDir, "data.html");
  fs.writeFileSync(dataPath, generateDataHtml(lang), "utf8");
  generatedFiles.push({ path: dataPath, kind: "data", lang });
});

const sitemapPath = path.join(SITE_DIR, "sitemap.xml");
fs.writeFileSync(sitemapPath, buildSitemap(), "utf8");

/* ===========================================================
   自己検査。1つでも失敗したら console.error して exit 1。
   壊れたページをそのまま公開しないための最終防衛線
   =========================================================== */
const errors = [];

function expectedCanonical(file) {
  return file.kind === "index" ? pageUrl(file.lang) : dataUrl(file.lang);
}
// (hreflang値, href) の期待集合。file.kind で pageUrl/dataUrl どちらのURL群かを切り替える
function expectedHreflangPairs(file) {
  if (!file.lang.cluster) return [];
  const urlFn = file.kind === "index" ? pageUrl : dataUrl;
  const pairs = CLUSTER_LANGS.map((l) => [l.hreflang, urlFn(l)]);
  pairs.push(["x-default", urlFn(LANGS[0])]);
  return pairs;
}
function normalizePairs(pairs) {
  return pairs
    .map(([h, u]) => `${h}|${u}`)
    .sort()
    .join("\n");
}

function checkHtmlFile(file) {
  const html = fs.readFileSync(file.path, "utf8");
  const label = `${file.kind} ${file.lang.code}`;

  const canonicalMatches = [...html.matchAll(/<link rel="canonical" href="([^"]*)">/g)];
  if (canonicalMatches.length !== 1) {
    errors.push(`${label}: canonical が ${canonicalMatches.length} 個 (期待値1)`);
  } else {
    const actual = canonicalMatches[0][1];
    const expected = expectedCanonical(file);
    if (actual !== expected) {
      errors.push(`${label}: canonical が期待値と不一致 (実際: ${actual} / 期待: ${expected})`);
    }
    const ogUrlMatch = html.match(/<meta property="og:url" content="([^"]*)">/);
    if (ogUrlMatch && ogUrlMatch[1] !== actual) {
      errors.push(`${label}: og:url が canonical と不一致 (og:url: ${ogUrlMatch[1]} / canonical: ${actual})`);
    }
  }

  const hreflangPairs = [...html.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)].map((m) => [
    m[1],
    m[2],
  ]);
  const expectedPairs = expectedHreflangPairs(file);
  if (normalizePairs(hreflangPairs) !== normalizePairs(expectedPairs)) {
    errors.push(
      `${label}: hreflangの(値, href)集合が期待値と不一致 (実際${hreflangPairs.length}件 / 期待${expectedPairs.length}件)`
    );
  }

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
  if (!titleMatch || !titleMatch[1].trim()) errors.push(`${label}: title が空`);

  const descMatch = html.match(/<meta name="description" content="([\s\S]*?)">/);
  if (!descMatch || !descMatch[1].trim()) errors.push(`${label}: meta description が空`);
  else if (/\{[a-zA-Z]+\}/.test(descMatch[1])) errors.push(`${label}: meta description にプレースホルダが残っている: ${descMatch[1]}`);

  // noscriptNote/dataPageLinkText等の{link}{date}を含む未解決プレースホルダがページ全体に
  // 残っていないか(補間漏れの検知)
  if (/\{link\}|\{date\}/.test(html)) {
    errors.push(`${label}: ページ内に未解決のプレースホルダ({link}/{date})が残っている`);
  }

  if (file.kind === "index") {
    const linkMatch = html.match(/href="([^"]*)" id="data-page-link"/);
    if (!linkMatch) {
      errors.push(`${label}: data-page-link 要素が見つからない`);
    } else {
      const target = path.join(SITE_DIR, linkMatch[1]);
      if (!fs.existsSync(target)) {
        errors.push(`${label}: data-page-link の href 先が _site 内に存在しない (${linkMatch[1]})`);
      }
    }

    // ハンバーガーメニュー内のテキスト版データリンク(#data-page-linkと同じ要領で言語別)
    const menuLinkMatch = html.match(/href="([^"]*)" id="menu-data-link"/);
    if (!menuLinkMatch) {
      errors.push(`${label}: menu-data-link 要素が見つからない`);
    } else {
      const target = path.join(SITE_DIR, menuLinkMatch[1]);
      if (!fs.existsSync(target)) {
        errors.push(`${label}: menu-data-link の href 先が _site 内に存在しない (${menuLinkMatch[1]})`);
      }
    }

    // 11言語ぶんの言語間リンクがメニューに揃っているか(hrefはbase解決の相対パスのため差し替え不要、常に一定)
    const menuLangCount = (html.match(/data-lang="[^"]+"/g) || []).length;
    if (menuLangCount !== 11) {
      errors.push(`${label}: メニューの言語リンク(data-lang)が${menuLangCount}件 (期待値11)`);
    }
  }

  const ldMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (ldMatches.length === 0) errors.push(`${label}: JSON-LD が見つからない`);
  ldMatches.forEach((m, i) => {
    try {
      const ld = JSON.parse(m[1]);
      // Dataset は name と description が Google の必須項目
      const nodes = ld["@graph"] || [ld];
      nodes.forEach((node) => {
        if (node["@type"] === "Dataset" && (!node.name || !node.description)) {
          errors.push(`${label}: Dataset の name/description が欠落`);
        }
        if (node["@type"] === "WebPage" && (!node.dateModified || !node.datePublished)) {
          errors.push(`${label}: WebPage の dateModified/datePublished が欠落`);
        }
      });
    } catch (e) {
      errors.push(`${label}: JSON-LD[${i}] が parse できない: ${e.message}`);
    }
  });
}

generatedFiles.forEach(checkHtmlFile);

const sitemapXml = fs.readFileSync(sitemapPath, "utf8");
const urlCount = (sitemapXml.match(/<url>/g) || []).length;
if (urlCount !== 22) errors.push(`sitemap.xml の <url> 数が ${urlCount} (期待値22)`);
if (!sitemapXml.includes('<?xml-stylesheet type="text/xsl" href="sitemap.xsl"?>'))
  errors.push("sitemap.xml に xml-stylesheet 処理命令がない");
if (!fs.existsSync(path.join(SITE_DIR, "sitemap.xsl"))) errors.push("_site/sitemap.xsl が存在しない");

if (!fs.existsSync(path.join(SITE_DIR, "data", "timeline.json"))) {
  errors.push("_site/data/timeline.json が存在しない");
}

if (errors.length > 0) {
  console.error("自己検査に失敗しました:");
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

/* ===========================================================
   生成サマリ
   =========================================================== */
console.log(`生成完了: index.html × ${LANGS.length} / data.html × ${LANGS.length} / sitemap.xml (${urlCount} URL)`);
console.log(`言語: ${LANGS.map((l) => l.code).join(", ")}`);
console.log(`lastmod (timeline.updated): ${timeline.updated}`);
console.log(`出力先: ${SITE_DIR}`);
