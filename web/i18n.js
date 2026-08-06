"use strict";

/* ===========================================================
   多言語対応（ja が唯一の正。他言語はキー欠落時 ja にフォールバック）

   このファイルは app.js より前に読み込まれる。DOM操作は一切せず、
   文字列テーブルと純粋関数（t/formatDateTime/muniName/prefName等）だけを
   window.I18N として公開する。実際のDOM更新は app.js 側が行う。
   =========================================================== */

const I18N_LANGS = [
  { code: "ja", name: "日本語" },
  { code: "easy-ja", name: "やさしい日本語" },
  { code: "en", name: "English" },
  { code: "zh", name: "中文（简体）" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "ko", name: "한국어" },
  { code: "fil", name: "Filipino" },
  { code: "ne", name: "नेपाली" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "my", name: "မြန်မာဘာသာ" },
];

const I18N_DEFAULT_LANG = "ja";
const I18N_STORAGE_KEY = "kumamoto_map_lang";

/* ===========================================================
   市町村名・県名のローマ字表（ヘボン式）
   日本語・やさしい日本語・中文は漢字のまま表示するので対象外。
   英語だけ 市=City/町=Town/村=Village の接尾辞を付け、他言語（ベトナム語・
   韓国語・フィリピノ語・ネパール語・ポルトガル語(ブラジル)・インドネシア語・
   ミャンマー語）はローマ字を接尾辞なしでそのまま使う
   =========================================================== */

const SUFFIX_EN = { city: "City", town: "Town", village: "Village" };

// { 漢字表記: [ローマ字, 種別] }
const MUNI_ROMAJI = {
  "佐賀市": ["Saga", "city"],
  "太良町": ["Tara", "town"],
  "白石町": ["Shiroishi", "town"],
  "神埼市": ["Kanzaki", "city"],
  "延岡市": ["Nobeoka", "city"],
  "西都市": ["Saito", "city"],
  "椎葉村": ["Shiiba", "village"],
  "熊本市": ["Kumamoto", "city"],
  "宇土市": ["Uto", "city"],
  "宇城市": ["Uki", "city"],
  "美里町": ["Misato", "town"],
  "荒尾市": ["Arao", "city"],
  "玉名市": ["Tamana", "city"],
  "玉東町": ["Gyokuto", "town"],
  "南関町": ["Nankan", "town"],
  "長洲町": ["Nagasu", "town"],
  "和水町": ["Nagomi", "town"],
  "山鹿市": ["Yamaga", "city"],
  "菊池市": ["Kikuchi", "city"],
  "合志市": ["Koshi", "city"],
  "大津町": ["Ozu", "town"],
  "菊陽町": ["Kikuyo", "town"],
  "阿蘇市": ["Aso", "city"],
  "南小国町": ["Minamioguni", "town"],
  "小国町": ["Oguni", "town"],
  "産山村": ["Ubuyama", "village"],
  "高森町": ["Takamori", "town"],
  "西原村": ["Nishihara", "village"],
  "南阿蘇村": ["Minamiaso", "village"],
  "御船町": ["Mifune", "town"],
  "嘉島町": ["Kashima", "town"],
  "益城町": ["Mashiki", "town"],
  "甲佐町": ["Kosa", "town"],
  "山都町": ["Yamato", "town"],
  "八代市": ["Yatsushiro", "city"],
  "氷川町": ["Hikawa", "town"],
  "水俣市": ["Minamata", "city"],
  "芦北町": ["Ashikita", "town"],
  "津奈木町": ["Tsunagi", "town"],
  "人吉市": ["Hitoyoshi", "city"],
  "錦町": ["Nishiki", "town"],
  "多良木町": ["Taragi", "town"],
  "湯前町": ["Yunomae", "town"],
  "水上村": ["Mizukami", "village"],
  "相良村": ["Sagara", "village"],
  "五木村": ["Itsuki", "village"],
  "山江村": ["Yamae", "village"],
  "球磨村": ["Kuma", "village"],
  "あさぎり町": ["Asagiri", "town"],
  "上天草市": ["Kamiamakusa", "city"],
  "天草市": ["Amakusa", "city"],
  "苓北町": ["Reihoku", "town"],
  "柳川市": ["Yanagawa", "city"],
  "大川市": ["Okawa", "city"],
  "南島原市": ["Minamishimabara", "city"],
  "諫早市": ["Isahaya", "city"],
  "雲仙市": ["Unzen", "city"],
  "薩摩川内市": ["Satsumasendai", "city"],
  "さつま町": ["Satsuma", "town"],
  "長島町": ["Nagashima", "town"],
  "阿久根市": ["Akune", "city"],
  "出水市": ["Izumi", "city"],
  "いちき串木野市": ["Ichikikushikino", "city"],
  "伊佐市": ["Isa", "city"],
  "湧水町": ["Yusui", "town"],
};

const PREF_ROMAJI = {
  "熊本県": "Kumamoto",
  "佐賀県": "Saga",
  "長崎県": "Nagasaki",
  "福岡県": "Fukuoka",
  "宮崎県": "Miyazaki",
  "鹿児島県": "Kagoshima",
};

// 漢字のまま表示する言語（中国語は簡体字でも地名漢字は共通認識できるため）
const KANJI_NAME_LANGS = new Set(["ja", "easy-ja", "zh"]);

function muniName(name, lang) {
  if (KANJI_NAME_LANGS.has(lang)) return name;
  const entry = MUNI_ROMAJI[name];
  if (!entry) return name; // 未知の名前はそのまま返す（表記漏れの手がかりにもなる）
  const [romaji, kind] = entry;
  return lang === "en" ? `${romaji} ${SUFFIX_EN[kind]}` : romaji;
}

function prefName(pref, lang) {
  if (KANJI_NAME_LANGS.has(lang)) return pref;
  const romaji = PREF_ROMAJI[pref];
  if (!romaji) return pref;
  return lang === "en" ? `${romaji} Prefecture` : romaji;
}

/* ===========================================================
   曜日名（数字の日付はどの言語も半角アラビア数字のまま統一。
   やさしい日本語の方針「数字はそのまま」を全言語に広げ、表記の
   一貫性と実装の堅牢性を優先した）
   =========================================================== */

const WEEKDAY_NAMES = {
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  "easy-ja": ["日", "月", "火", "水", "木", "金", "土"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  vi: ["CN", "T2", "T3", "T4", "T5", "T6", "T7"],
  ko: ["일", "월", "화", "수", "목", "금", "토"],
  fil: ["Lin", "Lun", "Mar", "Miy", "Huw", "Biy", "Sab"],
  ne: ["आइत", "सोम", "मंगल", "बुध", "बिहि", "शुक्र", "शनि"],
  "pt-BR": ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"],
  id: ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"],
  my: ["တနင်္ဂနွေ", "တနင်္လာ", "အင်္ဂါ", "ဗုဒ္ဓဟူး", "ကြာသပတေး", "သောကြာ", "စနေ"],
};

/* ===========================================================
   文字列テーブル。ja が唯一の正。キーの集合はすべての言語で揃える
   （欠落時は t() が自動で ja にフォールバックするが、その状況が
   実際に起きないよう全言語ぶん埋めてある）
   =========================================================== */

const STRINGS = {
  ja: {
    appTitle: "令和8年熊本地震 被害状況マップ",
    metaDescriptionTemplate: "令和8年熊本地震（2026年7月28日発生）の市町村別被害状況を地図と時間スライダーで可視化。{date}時点で避難者{evacuees}人・避難所{shelters}カ所・断水{water}戸。熊本県・内閣府の公表資料に基づく非公式サイト。",
    ogDescriptionTemplate: "{date}時点: 避難者{evacuees}人・避難所{shelters}カ所・断水{water}戸。市町村別の被害状況を時系列で可視化。",
    dataPageLinkText: "テキスト版データ一覧（全市町村・全指標）",
    noscriptNote: "このページの地図表示にはJavaScriptが必要です。数値データは{link}で確認できます。",
    langSwitchAriaLabel: "言語 / Language",
    menuButtonAriaLabel: "メニュー",
    menuAriaLabel: "メニュー",

    modeMetric: "数値マップ",
    modeNews: "ニュースマップ",
    modeAriaLabel: "地図の表示モード",

    panelLeftAriaLabel: "指標選択と市町村別の状況",
    panelToggleRanking: "指標・市町村別",
    panelCloseAriaLabel: "このパネルを閉じる",
    panelMetricSubhead: "表示する指標",
    metricSwitchAriaLabel: "表示する指標",
    statPrefTotal: "熊本県 合計",
    statLabelTemplate: "熊本県合計 - {metric}",
    rankingHeading: "市町村別の状況（多い順・10件）",
    tableToggleBtn: "表で見る（全市町村・全指標）",

    panelNewsSubhead: "カテゴリで絞り込み",
    newsFilterAriaLabel: "ニュースのカテゴリ絞り込み",
    newsHeading: "ニュース一覧",

    mapAriaLabel: "市町村別被害状況の地図",
    epicenterLabel: "震央",

    legendTitleDefault: "円の大きさ",
    legendTitleTemplate: "円の大きさ（{metric}）",
    legendNote: "小さな中空の点 = 0（報告あり）／表示なし = 未報告",
    labelsHiddenZoomHint: "重なりのため{n}件のラベル非表示（タップでズーム）",

    tableOverlayAriaLabel: "全市町村・全指標データテーブル",
    tableClose: "← 地図に戻る",
    tableHeading: "全市町村・全指標（現在時点）",
    tableColMuni: "市町村",
    tableCaption: "{date}のデータ。「—」はデータなし（未公表）、「＊」は一部内訳が不明で既知分のみの合計、「†」は熊本県資料未報告のため内閣府報の値で補完を表す。",

    panelToggleDetail: "詳細",
    panelRightAriaLabel: "市町村詳細",
    detailPlaceholder: "地図の円、または左の一覧の市町村をクリックすると詳細が表示されます。",
    detailNoDataAtPoint: "この時点のデータはありません。",
    sparklineHeadingTemplate: "推移（{metric}）",
    sparklineCurrentTemplate: "現在時点: {value}",
    sparklineCurrentNoData: "現在時点: データなし",
    unknownComponentNote: "（ほか不明分あり：一部の内訳が未報告のため既知分のみの合計）",
    waterSourceNoteDetail: "内閣府報の値で表示（熊本県資料は未報告のため熊本県合計には含まれない）",
    waterPeakTemplate: "断水ピーク時: {value}",
    waterPeriodTemplate: "給水期間: {value}",

    tlPrevAriaLabel: "前の時点へ",
    tlPrevTitle: "前へ（←）",
    tlNextAriaLabel: "次の時点へ",
    tlNextTitle: "次へ（→）",
    tlPlayAriaLabel: "自動再生",
    tlPlay: "再生 ▶",
    tlPause: "一時停止 ❚❚",
    tlSliderAriaLabel: "時点を選択",
    tlInfoToggle: "出典・注記",

    disclaimerStrong: "本サイトは公的資料の内容を見やすく可視化した非公式サイトです。正確な情報は必ず一次ソース（熊本県・内閣府の公式発表）をご確認ください。",
    bannerNotice: "本サイトは非公式の可視化サイトです。正確な情報は熊本県・内閣府の公式発表でご確認ください。",
    bannerCloseAriaLabel: "この通知を閉じる",
    infoDisclaimer: "数値は各時点の速報値であり、今後の調査により変わる可能性があります。",
    infoCreditPrefix: "出典: 熊本県 災害対策本部会議資料／内閣府 防災情報 被害状況等報告／",
    infoCreditGsiLinkText: "地理院タイル（国土地理院）",
    infoOpenSourcePrefix: "本サイトはオープンソースです:",
    infoGithubLinkText: "GitHub（wideplain/disaster-map-kumamoto-2026）",
    infoAnalytics: "本サイトは利用状況の把握のため Google アナリティクスを使用しています。",

    sourcePrefix: "出典: ",
    sourceNewsLinkTemplate: "内閣府 防災情報（{date}の報）",
    sourceNewsReportNotFound: "この時点に対応する報が見つかりません",
    sourceNewsUnavailable: "ニュースデータを読み込めませんでした",

    valNoData: "データなし",
    valUnknownSuffix: "（ほか不明分あり）",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "熊本県資料が未報告のため{source}報の値を表示（熊本県合計には含まれない）",
    waterSourceBadgeTextTemplate: "{source}報による",

    extrasPrefix: "※うち市町村未確定: ",
    extrasDeathsInvestigating: "関連死調査中{n}人",
    extrasDeathsPossible: "関連死疑い{n}人",
    extrasUnidentifiedDeaths: "身元不明{n}人",
    extrasUnidentifiedInjuredPrefix: "身元不明者",
    extrasInjuredLight: "軽傷{n}人",
    extrasInjuredModerate: "中等症{n}人",
    extrasInjuredSevere: "重症{n}人",
    extrasWaterSourceNote: "※未報告の市町村は内閣府報の値で地図に表示（熊本県合計には含まれない）",

    newsBadgeNew: "NEW",
    newsBadgeUpdated: "更新",
    newsGroupGlobalTemplate: "県内全域（{n}件）",
    newsGroupMuniLabel: "市町村別",
    newsEmptyNoData: "ニュースデータを読み込めませんでした。",
    newsEmptyNoReport: "この時点に対応する報がありません。",
    newsEmptyNoMatch: "この時点・カテゴリに該当するニュースはありません。",
    newsEmptyNoneAtPoint: "この時点のニュースはありません。",
    newsMarkerAriaLabelTemplate: "{muni}: ニュース{n}件",
    newsTranslationNotice: "ニュースは公的資料からの日本語原文の引用です。",

    catLifeline: "ライフライン",
    catTransport: "交通",
    catMedical: "医療・福祉",
    catDaily: "生活・行政",
    catIndustry: "産業",

    metricEvacueesLabel: "避難者数", metricEvacueesUnit: "人",
    metricSheltersLabel: "避難所数", metricSheltersUnit: "カ所",
    metricDeathsLabel: "死者数", metricDeathsUnit: "人",
    metricInjuredLabel: "負傷者数", metricInjuredUnit: "人",
    metricHousesLabel: "住家被害", metricHousesUnit: "棟",
    metricWaterOutageLabel: "断水戸数", metricWaterOutageUnit: "戸",
    metricWaterStationsLabel: "給水所数", metricWaterStationsUnit: "カ所",
    metricPowerOutageLabel: "停電戸数", metricPowerOutageUnit: "戸",

    eventMetaTemplate: "M{m}・最大震度{shindo}・{date}発生・{epicenter}（深さ{depth}km）",
  },

  "easy-ja": {
    // 翻訳ではなく「書き換え」。短い文・やさしい言葉づかいにする（数字はそのまま）
    appTitle: "熊本の地しん　ひがいマップ",
    metaDescriptionTemplate: "熊本の地しん（2026年7月28日）の ひがいを 地図で 見られます。{date}の とき、にげている人 {evacuees}人・にげる場所 {shelters}つ・水が出ない家 {water}けん。県や 国の しりょうを もとに した サイトです（公式では ありません）。",
    ogDescriptionTemplate: "{date}: にげている人 {evacuees}人・にげる場所 {shelters}つ・水が出ない家 {water}けん。地図で 見られます。",
    dataPageLinkText: "もじで 見る データいちらん",
    noscriptNote: "地図を 見るには JavaScript が いります。数字の データは {link}で 見られます。",
    langSwitchAriaLabel: "ことば / Language",
    menuButtonAriaLabel: "メニュー",
    menuAriaLabel: "メニュー",

    modeMetric: "かずで見る",
    modeNews: "ニュースで見る",
    modeAriaLabel: "地図の見かたをえらぶ",

    panelLeftAriaLabel: "見るものと町のじょうほう",
    panelToggleRanking: "見るもの・町",
    panelCloseAriaLabel: "とじる",
    panelMetricSubhead: "見るものをえらぶ",
    metricSwitchAriaLabel: "見るものをえらぶ",
    statPrefTotal: "熊本県ぜんぶ",
    statLabelTemplate: "熊本県ぜんぶ - {metric}",
    rankingHeading: "町ごとのじょうほう（多い じゅん・10）",
    tableToggleBtn: "ひょうで見る（ぜんぶの町・ぜんぶのしゅるい）",

    panelNewsSubhead: "しゅるいでえらぶ",
    newsFilterAriaLabel: "ニュースのしゅるいをえらぶ",
    newsHeading: "ニュース",

    mapAriaLabel: "町ごとのひがいの地図",
    epicenterLabel: "地しんが おきた ところ",

    legendTitleDefault: "まるの大きさ",
    legendTitleTemplate: "まるの大きさ（{metric}）",
    legendNote: "小さい しろい まる = 0（れんらくは あった）／なにも ない = れんらくが まだ ない",
    labelsHiddenZoomHint: "かさなって いるので {n}この なまえを かくして います（おすと 大きく なります）",

    tableOverlayAriaLabel: "ぜんぶの町・ぜんぶのしゅるいのひょう",
    tableClose: "← 地図に もどる",
    tableHeading: "ぜんぶの町・ぜんぶのしゅるい（いまの じかん）",
    tableColMuni: "町の名前",
    tableCaption: "{date}の じょうほう。「—」は まだ わからない。「＊」は いちぶ わからない ところが ある。「†」は 国の しりょうを つかった。",

    panelToggleDetail: "くわしく",
    panelRightAriaLabel: "町の くわしい じょうほう",
    detailPlaceholder: "地図の まる、または ひだりの リストの 町の名前を おすと、くわしい じょうほうが 出ます。",
    detailNoDataAtPoint: "この じかんの じょうほうは ありません。",
    sparklineHeadingTemplate: "うごき（{metric}）",
    sparklineCurrentTemplate: "いま: {value}",
    sparklineCurrentNoData: "いま: わかりません",
    unknownComponentNote: "（ほかにも わからない ぶんが あります）",
    waterSourceNoteDetail: "国の しりょうの すう字です（熊本県の ぜんぶの かずには はいって いません）",
    waterPeakTemplate: "水が いちばん 出なかった とき: {value}",
    waterPeriodTemplate: "水を くばった 日: {value}",

    tlPrevAriaLabel: "まえの じかんへ",
    tlPrevTitle: "まえへ（←）",
    tlNextAriaLabel: "つぎの じかんへ",
    tlNextTitle: "つぎへ（→）",
    tlPlayAriaLabel: "じどうで うごかす",
    tlPlay: "スタート ▶",
    tlPause: "とめる ❚❚",
    tlSliderAriaLabel: "じかんを えらぶ",
    tlInfoToggle: "しりょう・ちゅうい",

    disclaimerStrong: "このサイトは、国や県の しりょうを 見やすくした サイトです。公式では ありません。正しい じょうほうは、かならず 熊本県や 国（内閣府）の 公式の はっぴょうで たしかめて ください。",
    bannerNotice: "このサイトは 公式では ありません。正しい じょうほうは 熊本県や 国の 公式はっぴょうで たしかめて ください。",
    bannerCloseAriaLabel: "この おしらせを とじる",
    infoDisclaimer: "この すう字は はやい じょうほうです。あとで かわる かもしれません。",
    infoCreditPrefix: "しりょう: 熊本県の かいぎの しりょう／国の ぼうさい じょうほう／",
    infoCreditGsiLinkText: "国土地理院の 地図",
    infoOpenSourcePrefix: "この サイトの プログラムは だれでも 見られます:",
    infoGithubLinkText: "GitHub（wideplain/disaster-map-kumamoto-2026）",
    infoAnalytics: "この サイトは Google アナリティクスを つかって います。",

    sourcePrefix: "しりょう: ",
    sourceNewsLinkTemplate: "国の ぼうさい じょうほう（{date}の しりょう）",
    sourceNewsReportNotFound: "この じかんの しりょうが ありません",
    sourceNewsUnavailable: "ニュースを よみこめませんでした",

    valNoData: "わかりません",
    valUnknownSuffix: "（ほかにも わからない ぶんが あります）",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "熊本県の しりょうに まだ ないので、{source}の すう字を つかって います（熊本県ぜんぶの かずには はいりません）",
    waterSourceBadgeTextTemplate: "{source}の すう字",

    extrasPrefix: "※町が まだ わからない人: ",
    extrasDeathsInvestigating: "しらべて いる人 {n}人",
    extrasDeathsPossible: "たぶん そうかもしれない人 {n}人",
    extrasUnidentifiedDeaths: "名前が わからない人 {n}人",
    extrasUnidentifiedInjuredPrefix: "名前が わからない人",
    extrasInjuredLight: "かるい けが {n}人",
    extrasInjuredModerate: "ちゅうくらいの けが {n}人",
    extrasInjuredSevere: "おもい けが {n}人",
    extrasWaterSourceNote: "※まだ しりょうが ない 町は 国の すう字を 地図に つかって います（熊本県ぜんぶの かずには はいりません）",

    newsBadgeNew: "あたらしい",
    newsBadgeUpdated: "かわった",
    newsGroupGlobalTemplate: "熊本県 ぜんたい（{n}）",
    newsGroupMuniLabel: "町ごと",
    newsEmptyNoData: "ニュースを よみこめませんでした。",
    newsEmptyNoReport: "この じかんの しりょうは ありません。",
    newsEmptyNoMatch: "この じかん・しゅるいの ニュースは ありません。",
    newsEmptyNoneAtPoint: "この じかんの ニュースは ありません。",
    newsMarkerAriaLabelTemplate: "{muni}：ニュース {n}",
    newsTranslationNotice: "ニュースは 国の しりょうを そのまま つかって います。",

    catLifeline: "でんき・水・ガス",
    catTransport: "のりもの",
    catMedical: "びょういん・たすけあい",
    catDaily: "くらし・やくしょ",
    catIndustry: "しごと",

    metricEvacueesLabel: "にげている人の数", metricEvacueesUnit: "人",
    metricSheltersLabel: "にげる場所の数", metricSheltersUnit: "つ",
    metricDeathsLabel: "なくなった人の数", metricDeathsUnit: "人",
    metricInjuredLabel: "けがをした人の数", metricInjuredUnit: "人",
    metricHousesLabel: "こわれた家の数", metricHousesUnit: "けん",
    metricWaterOutageLabel: "水が出ない家の数", metricWaterOutageUnit: "けん",
    metricWaterStationsLabel: "水をもらえる場所の数", metricWaterStationsUnit: "つ",
    metricPowerOutageLabel: "電気が止まっている家の数", metricPowerOutageUnit: "けん",

    eventMetaTemplate: "マグニチュード{m}・いちばん つよい ゆれ しん度{shindo}・{date}に おきた・{epicenter}（ふかさ {depth}km）",
  },

  en: {
    appTitle: "2026 Kumamoto Earthquake Damage Map",
    metaDescriptionTemplate: "2026 Kumamoto Earthquake damage by municipality, on an interactive timeline map. As of {date}: {evacuees} evacuees, {shelters} shelters, {water} households without water. Unofficial site based on official reports.",
    ogDescriptionTemplate: "As of {date}: {evacuees} evacuees, {shelters} shelters, {water} households without water. Municipal damage data on a timeline map.",
    dataPageLinkText: "Text version: all data tables",
    noscriptNote: "The interactive map requires JavaScript. The data is also available at {link}.",
    langSwitchAriaLabel: "Language",
    menuButtonAriaLabel: "Menu",
    menuAriaLabel: "Menu",

    modeMetric: "Data map",
    modeNews: "News map",
    modeAriaLabel: "Map display mode",

    panelLeftAriaLabel: "Indicator selection and municipality data",
    panelToggleRanking: "Indicator / municipalities",
    panelCloseAriaLabel: "Close this panel",
    panelMetricSubhead: "Choose an indicator",
    metricSwitchAriaLabel: "Choose an indicator",
    statPrefTotal: "Kumamoto Pref. total",
    statLabelTemplate: "Kumamoto Pref. total - {metric}",
    rankingHeading: "Municipalities (top 10, highest first)",
    tableToggleBtn: "View table (all municipalities, all indicators)",

    panelNewsSubhead: "Filter by category",
    newsFilterAriaLabel: "Filter news by category",
    newsHeading: "News list",

    mapAriaLabel: "Map of damage by municipality",
    epicenterLabel: "Epicenter",

    legendTitleDefault: "Circle size",
    legendTitleTemplate: "Circle size ({metric})",
    legendNote: "Small hollow dot = 0 (reported) / no circle = not yet reported",
    labelsHiddenZoomHint: "{n} labels hidden due to overlap (tap to zoom)",

    tableOverlayAriaLabel: "Data table for all municipalities and indicators",
    tableClose: "← Back to map",
    tableHeading: "All municipalities / all indicators (current time)",
    tableColMuni: "Municipality",
    tableCaption: "{date}. \"—\" means no data (not yet published); \"＊\" means the total uses only the known part of a breakdown; \"†\" means the value is supplemented from the Cabinet Office report because the Kumamoto Prefecture report has not yet covered it.",

    panelToggleDetail: "Details",
    panelRightAriaLabel: "Municipality details",
    detailPlaceholder: "Click a circle on the map, or a municipality in the list on the left, to see details.",
    detailNoDataAtPoint: "No data for this point in time.",
    sparklineHeadingTemplate: "Trend ({metric})",
    sparklineCurrentTemplate: "Current: {value}",
    sparklineCurrentNoData: "Current: no data",
    unknownComponentNote: "(includes an unknown portion: part of the breakdown is not yet reported, so this is a total of the known parts only)",
    waterSourceNoteDetail: "Shown using the Cabinet Office report value (not yet reported by Kumamoto Prefecture, so not included in the prefecture total)",
    waterPeakTemplate: "Peak water outage: {value}",
    waterPeriodTemplate: "Water supply period: {value}",

    tlPrevAriaLabel: "Previous point in time",
    tlPrevTitle: "Previous (←)",
    tlNextAriaLabel: "Next point in time",
    tlNextTitle: "Next (→)",
    tlPlayAriaLabel: "Auto-play",
    tlPlay: "Play ▶",
    tlPause: "Pause ❚❚",
    tlSliderAriaLabel: "Choose a point in time",
    tlInfoToggle: "Sources & notes",

    disclaimerStrong: "This site is an unofficial visualization of publicly released materials. Please always check the primary sources (official announcements from Kumamoto Prefecture and the Cabinet Office) for accurate information.",
    bannerNotice: "This is an unofficial visualization site. Please verify information with official announcements from Kumamoto Prefecture and the Cabinet Office.",
    bannerCloseAriaLabel: "Dismiss this notice",
    infoDisclaimer: "All figures are preliminary as of each point in time and may change as investigations continue.",
    infoCreditPrefix: "Sources: Kumamoto Prefecture Disaster Response Headquarters meeting materials / Cabinet Office disaster damage reports / ",
    infoCreditGsiLinkText: "GSI Tiles (Geospatial Information Authority of Japan)",
    infoOpenSourcePrefix: "This site is open source:",
    infoGithubLinkText: "GitHub (wideplain/disaster-map-kumamoto-2026)",
    infoAnalytics: "This site uses Google Analytics to understand how it is used.",

    sourcePrefix: "Source: ",
    sourceNewsLinkTemplate: "Cabinet Office disaster info (report as of {date})",
    sourceNewsReportNotFound: "No report found for this point in time",
    sourceNewsUnavailable: "Could not load news data",

    valNoData: "No data",
    valUnknownSuffix: " (includes an unknown portion)",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "Not yet reported by Kumamoto Prefecture, so the {source} report value is shown (not included in the prefecture total)",
    waterSourceBadgeTextTemplate: "from {source} report",

    extrasPrefix: "※ Not yet attributed to a municipality: ",
    extrasDeathsInvestigating: "{n} under investigation as disaster-related",
    extrasDeathsPossible: "{n} possibly disaster-related",
    extrasUnidentifiedDeaths: "{n} unidentified",
    extrasUnidentifiedInjuredPrefix: "Unidentified: ",
    extrasInjuredLight: "{n} minor injuries",
    extrasInjuredModerate: "{n} moderate injuries",
    extrasInjuredSevere: "{n} severe injuries",
    extrasWaterSourceNote: "※ Municipalities not yet reported by the prefecture are shown on the map using Cabinet Office report values (not included in the prefecture total)",

    newsBadgeNew: "NEW",
    newsBadgeUpdated: "UPDATED",
    newsGroupGlobalTemplate: "Prefecture-wide ({n})",
    newsGroupMuniLabel: "By municipality",
    newsEmptyNoData: "Could not load news data.",
    newsEmptyNoReport: "There is no report for this point in time.",
    newsEmptyNoMatch: "No news matches this point in time and category.",
    newsEmptyNoneAtPoint: "No news for this point in time.",
    newsMarkerAriaLabelTemplate: "{muni}: {n} news items",
    newsTranslationNotice: "News items are quoted in their original Japanese from official sources.",

    catLifeline: "Utilities",
    catTransport: "Transport",
    catMedical: "Medical & welfare",
    catDaily: "Daily life & government",
    catIndustry: "Industry",

    metricEvacueesLabel: "Evacuees", metricEvacueesUnit: " people",
    metricSheltersLabel: "Shelters", metricSheltersUnit: " shelters",
    metricDeathsLabel: "Deaths", metricDeathsUnit: " deaths",
    metricInjuredLabel: "Injured", metricInjuredUnit: " injured",
    metricHousesLabel: "Housing damage", metricHousesUnit: " buildings",
    metricWaterOutageLabel: "Water outage", metricWaterOutageUnit: " households",
    metricWaterStationsLabel: "Water stations", metricWaterStationsUnit: " stations",
    metricPowerOutageLabel: "Power outage", metricPowerOutageUnit: " households",

    eventMetaTemplate: "M{m} ・ Max intensity {shindo} ・ Occurred {date} ・ {epicenter} (depth {depth} km)",
  },

  zh: {
    appTitle: "令和8年熊本地震 灾情地图",
    metaDescriptionTemplate: "以地图和时间轴可视化令和8年熊本地震（2026年7月28日发生）各市町村的受灾情况。截至{date}：避难人数{evacuees}人、避难所{shelters}处、断水{water}户。基于熊本县・内阁府公开资料的非官方网站。",
    ogDescriptionTemplate: "截至{date}：避难人数{evacuees}人、避难所{shelters}处、断水{water}户。按时间轴查看各市町村受灾情况。",
    dataPageLinkText: "文字版数据一览（全部市町村・全部指标）",
    noscriptNote: "查看地图需要启用JavaScript。数据也可在{link}查看。",
    langSwitchAriaLabel: "语言",
    menuButtonAriaLabel: "菜单",
    menuAriaLabel: "菜单",

    modeMetric: "数据地图",
    modeNews: "新闻地图",
    modeAriaLabel: "地图显示模式",

    panelLeftAriaLabel: "指标选择与各市町村情况",
    panelToggleRanking: "指标・各市町村",
    panelCloseAriaLabel: "关闭此面板",
    panelMetricSubhead: "选择显示的指标",
    metricSwitchAriaLabel: "选择显示的指标",
    statPrefTotal: "熊本县合计",
    statLabelTemplate: "熊本县合计 - {metric}",
    rankingHeading: "各市町村情况（按数量排序・前10）",
    tableToggleBtn: "查看表格（全部市町村・全部指标）",

    panelNewsSubhead: "按类别筛选",
    newsFilterAriaLabel: "按类别筛选新闻",
    newsHeading: "新闻列表",

    mapAriaLabel: "各市町村受灾情况地图",
    epicenterLabel: "震中",

    legendTitleDefault: "圆圈大小",
    legendTitleTemplate: "圆圈大小（{metric}）",
    legendNote: "小的空心点 = 0（已有报告）／无显示 = 尚未报告",
    labelsHiddenZoomHint: "因重叠隐藏了{n}个标签（点按放大）",

    tableOverlayAriaLabel: "全部市町村与全部指标数据表",
    tableClose: "← 返回地图",
    tableHeading: "全部市町村・全部指标（当前时点）",
    tableColMuni: "市町村",
    tableCaption: "{date}的数据。“—”表示暂无数据（尚未公布）；“＊”表示部分明细不明、仅为已知部分之和；“†”表示熊本县资料尚未公布，暂以内阁府报告的数值补充。",

    panelToggleDetail: "详情",
    panelRightAriaLabel: "市町村详情",
    detailPlaceholder: "点击地图上的圆圈，或点击左侧列表中的市町村，即可查看详情。",
    detailNoDataAtPoint: "该时点暂无数据。",
    sparklineHeadingTemplate: "变化趋势（{metric}）",
    sparklineCurrentTemplate: "当前时点：{value}",
    sparklineCurrentNoData: "当前时点：暂无数据",
    unknownComponentNote: "（含未知部分：部分明细尚未公布，此为已知部分之和）",
    waterSourceNoteDetail: "以内阁府报告数值显示（熊本县资料尚未公布，故不计入县合计）",
    waterPeakTemplate: "断水峰值：{value}",
    waterPeriodTemplate: "供水期间：{value}",

    tlPrevAriaLabel: "上一时点",
    tlPrevTitle: "上一个（←）",
    tlNextAriaLabel: "下一时点",
    tlNextTitle: "下一个（→）",
    tlPlayAriaLabel: "自动播放",
    tlPlay: "播放 ▶",
    tlPause: "暂停 ❚❚",
    tlSliderAriaLabel: "选择时点",
    tlInfoToggle: "来源・说明",

    disclaimerStrong: "本网站是将公开资料内容可视化整理而成的非官方网站。准确信息请务必以一手信息来源（熊本县・内阁府的官方发布）为准进行确认。",
    bannerNotice: "本网站为非官方可视化网站。准确信息请以熊本县・内阁府的官方发布为准。",
    bannerCloseAriaLabel: "关闭此提示",
    infoDisclaimer: "所有数字均为各时点的速报值，今后可能因调查而变动。",
    infoCreditPrefix: "来源：熊本县灾害对策本部会议资料／内阁府防灾信息 受灾情况报告／",
    infoCreditGsiLinkText: "地理院地图瓦片（国土地理院）",
    infoOpenSourcePrefix: "本网站为开源项目：",
    infoGithubLinkText: "GitHub（wideplain/disaster-map-kumamoto-2026）",
    infoAnalytics: "本网站使用 Google Analytics（谷歌分析）以了解使用情况。",

    sourcePrefix: "来源：",
    sourceNewsLinkTemplate: "内阁府防灾信息（{date}发布）",
    sourceNewsReportNotFound: "未找到对应该时点的报告",
    sourceNewsUnavailable: "新闻数据加载失败",

    valNoData: "暂无数据",
    valUnknownSuffix: "（含未知部分）",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "熊本县资料尚未公布，显示为{source}报告数值（不计入熊本县合计）",
    waterSourceBadgeTextTemplate: "据{source}报告",

    extrasPrefix: "※以下为尚未归属到具体市町村的人数：",
    extrasDeathsInvestigating: "相关死亡・调查中 {n}人",
    extrasDeathsPossible: "相关死亡・疑似 {n}人",
    extrasUnidentifiedDeaths: "身份不明 {n}人",
    extrasUnidentifiedInjuredPrefix: "身份不明者中",
    extrasInjuredLight: "轻伤 {n}人",
    extrasInjuredModerate: "中度伤 {n}人",
    extrasInjuredSevere: "重伤 {n}人",
    extrasWaterSourceNote: "※尚未公布的市町村，地图上以内阁府报告数值显示（不计入熊本县合计）",

    newsBadgeNew: "最新",
    newsBadgeUpdated: "已更新",
    newsGroupGlobalTemplate: "全县范围（{n}条）",
    newsGroupMuniLabel: "按市町村",
    newsEmptyNoData: "新闻数据加载失败。",
    newsEmptyNoReport: "没有对应该时点的报告。",
    newsEmptyNoMatch: "该时点・类别下没有符合的新闻。",
    newsEmptyNoneAtPoint: "该时点没有新闻。",
    newsMarkerAriaLabelTemplate: "{muni}：{n}条新闻",
    newsTranslationNotice: "新闻内容为公开资料的日语原文引用。",

    catLifeline: "生命线（水电燃气）",
    catTransport: "交通",
    catMedical: "医疗・福利",
    catDaily: "生活・行政",
    catIndustry: "产业",

    metricEvacueesLabel: "避难人数", metricEvacueesUnit: "人",
    metricSheltersLabel: "避难所数", metricSheltersUnit: "处",
    metricDeathsLabel: "死亡人数", metricDeathsUnit: "人",
    metricInjuredLabel: "受伤人数", metricInjuredUnit: "人",
    metricHousesLabel: "住宅受损", metricHousesUnit: "栋",
    metricWaterOutageLabel: "断水户数", metricWaterOutageUnit: "户",
    metricWaterStationsLabel: "供水点数", metricWaterStationsUnit: "处",
    metricPowerOutageLabel: "停电户数", metricPowerOutageUnit: "户",

    eventMetaTemplate: "M{m}・最大震度{shindo}・{date}发生・{epicenter}（深度{depth}km）",
  },

  vi: {
    appTitle: "Bản đồ thiệt hại động đất Kumamoto 2026",
    metaDescriptionTemplate: "Bản đồ thiệt hại động đất Kumamoto 2026 theo từng địa phương. Tính đến {date}: {evacuees} người sơ tán, {shelters} nơi sơ tán, {water} hộ mất nước. Trang không chính thức, dựa trên tài liệu công bố chính thức.",
    ogDescriptionTemplate: "Tính đến {date}: {evacuees} người sơ tán, {shelters} nơi sơ tán, {water} hộ mất nước. Xem thiệt hại theo dòng thời gian trên bản đồ.",
    dataPageLinkText: "Bản văn bản: tất cả bảng dữ liệu",
    noscriptNote: "Bản đồ cần JavaScript để hiển thị. Dữ liệu cũng có tại {link}.",
    langSwitchAriaLabel: "Ngôn ngữ",
    menuButtonAriaLabel: "Menu",
    menuAriaLabel: "Menu",

    modeMetric: "Bản đồ số liệu",
    modeNews: "Bản đồ tin tức",
    modeAriaLabel: "Chế độ hiển thị bản đồ",

    panelLeftAriaLabel: "Chọn chỉ số và tình hình theo thành phố/thị trấn",
    panelToggleRanking: "Chỉ số / khu vực",
    panelCloseAriaLabel: "Đóng bảng này",
    panelMetricSubhead: "Chọn chỉ số hiển thị",
    metricSwitchAriaLabel: "Chọn chỉ số hiển thị",
    statPrefTotal: "Tổng tỉnh Kumamoto",
    statLabelTemplate: "Tổng tỉnh Kumamoto - {metric}",
    rankingHeading: "Theo khu vực (nhiều nhất, top 10)",
    tableToggleBtn: "Xem bảng (tất cả khu vực, tất cả chỉ số)",

    panelNewsSubhead: "Lọc theo danh mục",
    newsFilterAriaLabel: "Lọc tin tức theo danh mục",
    newsHeading: "Danh sách tin tức",

    mapAriaLabel: "Bản đồ thiệt hại theo từng khu vực",
    epicenterLabel: "Tâm chấn",

    legendTitleDefault: "Kích thước vòng tròn",
    legendTitleTemplate: "Kích thước vòng tròn ({metric})",
    legendNote: "Chấm tròn nhỏ rỗng = 0 (đã có báo cáo) / không hiển thị = chưa có báo cáo",
    labelsHiddenZoomHint: "Đã ẩn {n} nhãn do chồng lấn (chạm để phóng to)",

    tableOverlayAriaLabel: "Bảng dữ liệu tất cả khu vực và chỉ số",
    tableClose: "← Quay lại bản đồ",
    tableHeading: "Tất cả khu vực / tất cả chỉ số (thời điểm hiện tại)",
    tableColMuni: "Khu vực",
    tableCaption: "{date}. “—” là chưa có dữ liệu (chưa công bố); “＊” là tổng chỉ tính phần đã biết trong hạng mục; “†” là số liệu bổ sung từ báo cáo Văn phòng Nội các do tỉnh Kumamoto chưa công bố.",

    panelToggleDetail: "Chi tiết",
    panelRightAriaLabel: "Chi tiết khu vực",
    detailPlaceholder: "Nhấp vào một vòng tròn trên bản đồ, hoặc một khu vực trong danh sách bên trái, để xem chi tiết.",
    detailNoDataAtPoint: "Không có dữ liệu cho thời điểm này.",
    sparklineHeadingTemplate: "Xu hướng ({metric})",
    sparklineCurrentTemplate: "Hiện tại: {value}",
    sparklineCurrentNoData: "Hiện tại: không có dữ liệu",
    unknownComponentNote: "(có phần chưa rõ: một phần chi tiết chưa được báo cáo, đây là tổng của phần đã biết)",
    waterSourceNoteDetail: "Hiển thị theo số liệu báo cáo Văn phòng Nội các (tỉnh Kumamoto chưa báo cáo nên không tính vào tổng của tỉnh)",
    waterPeakTemplate: "Đỉnh điểm mất nước: {value}",
    waterPeriodTemplate: "Thời gian cấp nước: {value}",

    tlPrevAriaLabel: "Thời điểm trước",
    tlPrevTitle: "Trước (←)",
    tlNextAriaLabel: "Thời điểm sau",
    tlNextTitle: "Sau (→)",
    tlPlayAriaLabel: "Tự động phát",
    tlPlay: "Phát ▶",
    tlPause: "Tạm dừng ❚❚",
    tlSliderAriaLabel: "Chọn thời điểm",
    tlInfoToggle: "Nguồn & ghi chú",

    disclaimerStrong: "Trang này là trang trực quan hóa không chính thức từ các tài liệu công khai. Vui lòng luôn kiểm tra thông tin chính xác tại nguồn chính thức (thông báo chính thức của tỉnh Kumamoto và Văn phòng Nội các).",
    bannerNotice: "Đây là trang trực quan hóa không chính thức. Vui lòng xác nhận thông tin qua thông báo chính thức của tỉnh Kumamoto và Văn phòng Nội các.",
    bannerCloseAriaLabel: "Đóng thông báo này",
    infoDisclaimer: "Tất cả số liệu là số liệu sơ bộ tại từng thời điểm và có thể thay đổi khi có điều tra tiếp theo.",
    infoCreditPrefix: "Nguồn: Tài liệu họp Sở chỉ huy ứng phó thảm họa tỉnh Kumamoto / Báo cáo thiệt hại Văn phòng Nội các / ",
    infoCreditGsiLinkText: "Bản đồ nền GSI (Viện Thông tin Địa không gian Nhật Bản)",
    infoOpenSourcePrefix: "Trang này là mã nguồn mở:",
    infoGithubLinkText: "GitHub (wideplain/disaster-map-kumamoto-2026)",
    infoAnalytics: "Trang này dùng Google Analytics để nắm tình hình sử dụng.",

    sourcePrefix: "Nguồn: ",
    sourceNewsLinkTemplate: "Thông tin phòng chống thiên tai Văn phòng Nội các (báo cáo tính đến {date})",
    sourceNewsReportNotFound: "Không tìm thấy báo cáo cho thời điểm này",
    sourceNewsUnavailable: "Không tải được dữ liệu tin tức",

    valNoData: "Không có dữ liệu",
    valUnknownSuffix: " (có phần chưa rõ)",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "Tỉnh Kumamoto chưa báo cáo nên hiển thị số liệu báo cáo {source} (không tính vào tổng của tỉnh)",
    waterSourceBadgeTextTemplate: "theo báo cáo {source}",

    extrasPrefix: "※ Chưa xác định theo khu vực: ",
    extrasDeathsInvestigating: "{n} đang điều tra liên quan thảm họa",
    extrasDeathsPossible: "{n} nghi ngờ liên quan thảm họa",
    extrasUnidentifiedDeaths: "{n} chưa xác định danh tính",
    extrasUnidentifiedInjuredPrefix: "Trong số người chưa xác định danh tính: ",
    extrasInjuredLight: "{n} bị thương nhẹ",
    extrasInjuredModerate: "{n} bị thương vừa",
    extrasInjuredSevere: "{n} bị thương nặng",
    extrasWaterSourceNote: "※ Các khu vực tỉnh chưa báo cáo được hiển thị trên bản đồ bằng số liệu báo cáo Văn phòng Nội các (không tính vào tổng của tỉnh)",

    newsBadgeNew: "MỚI",
    newsBadgeUpdated: "CẬP NHẬT",
    newsGroupGlobalTemplate: "Toàn tỉnh ({n})",
    newsGroupMuniLabel: "Theo khu vực",
    newsEmptyNoData: "Không tải được dữ liệu tin tức.",
    newsEmptyNoReport: "Không có báo cáo cho thời điểm này.",
    newsEmptyNoMatch: "Không có tin tức phù hợp với thời điểm/danh mục này.",
    newsEmptyNoneAtPoint: "Không có tin tức cho thời điểm này.",
    newsMarkerAriaLabelTemplate: "{muni}: {n} tin tức",
    newsTranslationNotice: "Tin tức được trích dẫn nguyên văn tiếng Nhật từ nguồn chính thức.",

    catLifeline: "Hạ tầng thiết yếu",
    catTransport: "Giao thông",
    catMedical: "Y tế・phúc lợi",
    catDaily: "Đời sống・hành chính",
    catIndustry: "Công nghiệp",

    metricEvacueesLabel: "Người sơ tán", metricEvacueesUnit: " người",
    metricSheltersLabel: "Nơi sơ tán", metricSheltersUnit: " nơi",
    metricDeathsLabel: "Số người tử vong", metricDeathsUnit: " người",
    metricInjuredLabel: "Số người bị thương", metricInjuredUnit: " người",
    metricHousesLabel: "Nhà bị hư hại", metricHousesUnit: " căn",
    metricWaterOutageLabel: "Hộ mất nước", metricWaterOutageUnit: " hộ",
    metricWaterStationsLabel: "Điểm cấp nước", metricWaterStationsUnit: " điểm",
    metricPowerOutageLabel: "Hộ mất điện", metricPowerOutageUnit: " hộ",

    eventMetaTemplate: "M{m}・Cường độ tối đa {shindo}・Xảy ra {date}・{epicenter}（sâu {depth}km）",
  },

  ko: {
    appTitle: "레이와 8년 구마모토 지진 피해 지도",
    metaDescriptionTemplate: "레이와 8년 구마모토 지진(2026년 7월 28일 발생)의 시정촌별 피해 상황을 지도와 타임 슬라이더로 시각화. {date} 기준 피난자 {evacuees}명·대피소 {shelters}개소·단수 {water}가구. 구마모토현·내각부 공표 자료에 근거한 비공식 사이트.",
    ogDescriptionTemplate: "{date} 기준: 피난자 {evacuees}명·대피소 {shelters}개소·단수 {water}가구. 시정촌별 피해 상황을 시계열로 시각화.",
    dataPageLinkText: "텍스트판 데이터 목록(전체 시정촌·전체 지표)",
    noscriptNote: "지도 표시에는 JavaScript가 필요합니다. 데이터는 {link}에서도 확인할 수 있습니다.",
    langSwitchAriaLabel: "언어",
    menuButtonAriaLabel: "메뉴",
    menuAriaLabel: "메뉴",

    modeMetric: "수치 지도",
    modeNews: "뉴스 지도",
    modeAriaLabel: "지도 표시 모드",

    panelLeftAriaLabel: "지표 선택 및 시정촌별 상황",
    panelToggleRanking: "지표・시정촌",
    panelCloseAriaLabel: "이 패널 닫기",
    panelMetricSubhead: "표시할 지표 선택",
    metricSwitchAriaLabel: "표시할 지표 선택",
    statPrefTotal: "구마모토현 합계",
    statLabelTemplate: "구마모토현 합계 - {metric}",
    rankingHeading: "시정촌별 현황（많은 순・상위 10）",
    tableToggleBtn: "표로 보기（전체 시정촌・전체 지표）",

    panelNewsSubhead: "카테고리로 필터",
    newsFilterAriaLabel: "뉴스 카테고리 필터",
    newsHeading: "뉴스 목록",

    mapAriaLabel: "시정촌별 피해 상황 지도",
    epicenterLabel: "진앙",

    legendTitleDefault: "원의 크기",
    legendTitleTemplate: "원의 크기（{metric}）",
    legendNote: "작은 속이 빈 점 = 0（보고 있음）／표시 없음 = 미보고",
    labelsHiddenZoomHint: "겹침으로 라벨 {n}개 숨김(눌러서 확대)",

    tableOverlayAriaLabel: "전체 시정촌・전체 지표 데이터 표",
    tableClose: "← 지도로 돌아가기",
    tableHeading: "전체 시정촌・전체 지표（현재 시점）",
    tableColMuni: "시정촌",
    tableCaption: "{date}의 데이터입니다. 「—」는 데이터 없음（미공표）, 「＊」는 일부 내역이 불명확하여 알려진 부분만의 합계, 「†」는 구마모토현 자료 미보고로 내각부 보고 값으로 보완했음을 의미합니다.",

    panelToggleDetail: "상세",
    panelRightAriaLabel: "시정촌 상세 정보",
    detailPlaceholder: "지도의 원이나 왼쪽 목록의 시정촌을 클릭하면 상세 정보가 표시됩니다.",
    detailNoDataAtPoint: "이 시점의 데이터가 없습니다.",
    sparklineHeadingTemplate: "추이（{metric}）",
    sparklineCurrentTemplate: "현재 시점: {value}",
    sparklineCurrentNoData: "현재 시점: 데이터 없음",
    unknownComponentNote: "（불명분 포함: 일부 내역이 미보고되어 알려진 부분만의 합계）",
    waterSourceNoteDetail: "내각부 보고 값으로 표시（구마모토현 자료 미보고로 현 합계에는 포함되지 않음）",
    waterPeakTemplate: "단수 최대치: {value}",
    waterPeriodTemplate: "급수 기간: {value}",

    tlPrevAriaLabel: "이전 시점으로",
    tlPrevTitle: "이전（←）",
    tlNextAriaLabel: "다음 시점으로",
    tlNextTitle: "다음（→）",
    tlPlayAriaLabel: "자동 재생",
    tlPlay: "재생 ▶",
    tlPause: "일시정지 ❚❚",
    tlSliderAriaLabel: "시점 선택",
    tlInfoToggle: "출처・참고",

    disclaimerStrong: "본 사이트는 공적 자료의 내용을 보기 쉽게 시각화한 비공식 사이트입니다. 정확한 정보는 반드시 1차 출처(구마모토현・내각부의 공식 발표)를 확인해 주십시오.",
    bannerNotice: "본 사이트는 비공식 시각화 사이트입니다. 정확한 정보는 구마모토현・내각부의 공식 발표로 확인해 주세요.",
    bannerCloseAriaLabel: "이 알림 닫기",
    infoDisclaimer: "수치는 각 시점의 속보치이며, 향후 조사에 따라 변경될 수 있습니다.",
    infoCreditPrefix: "출처: 구마모토현 재해대책본부 회의자료 / 내각부 방재정보 피해상황 보고 / ",
    infoCreditGsiLinkText: "국토지리원 지도 타일（국토지리원）",
    infoOpenSourcePrefix: "이 사이트는 오픈소스입니다:",
    infoGithubLinkText: "GitHub（wideplain/disaster-map-kumamoto-2026）",
    infoAnalytics: "이 사이트는 이용 현황 파악을 위해 Google 애널리틱스를 사용합니다.",

    sourcePrefix: "출처: ",
    sourceNewsLinkTemplate: "내각부 방재정보（{date} 기준 보고）",
    sourceNewsReportNotFound: "이 시점에 해당하는 보고를 찾을 수 없습니다",
    sourceNewsUnavailable: "뉴스 데이터를 불러오지 못했습니다",

    valNoData: "데이터 없음",
    valUnknownSuffix: "（불명분 포함）",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "구마모토현 자료 미보고로 {source} 보고 값을 표시합니다（현 합계에는 포함되지 않음）",
    waterSourceBadgeTextTemplate: "{source} 보고 기준",

    extrasPrefix: "※ 시정촌 미확정분: ",
    extrasDeathsInvestigating: "관련사 조사중 {n}명",
    extrasDeathsPossible: "관련사 의심 {n}명",
    extrasUnidentifiedDeaths: "신원 미상 {n}명",
    extrasUnidentifiedInjuredPrefix: "신원 미상자 중",
    extrasInjuredLight: "경상 {n}명",
    extrasInjuredModerate: "중등증 {n}명",
    extrasInjuredSevere: "중상 {n}명",
    extrasWaterSourceNote: "※ 미보고 시정촌은 내각부 보고 값으로 지도에 표시합니다（현 합계에는 포함되지 않음）",

    newsBadgeNew: "신규",
    newsBadgeUpdated: "갱신",
    newsGroupGlobalTemplate: "현 전역（{n}건）",
    newsGroupMuniLabel: "시정촌별",
    newsEmptyNoData: "뉴스 데이터를 불러오지 못했습니다.",
    newsEmptyNoReport: "이 시점에 해당하는 보고가 없습니다.",
    newsEmptyNoMatch: "이 시점・카테고리에 해당하는 뉴스가 없습니다.",
    newsEmptyNoneAtPoint: "이 시점의 뉴스가 없습니다.",
    newsMarkerAriaLabelTemplate: "{muni}: 뉴스 {n}건",
    newsTranslationNotice: "뉴스는 공식 자료의 일본어 원문을 그대로 인용한 것입니다.",

    catLifeline: "생활 인프라",
    catTransport: "교통",
    catMedical: "의료・복지",
    catDaily: "생활・행정",
    catIndustry: "산업",

    metricEvacueesLabel: "피난자 수", metricEvacueesUnit: "명",
    metricSheltersLabel: "대피소 수", metricSheltersUnit: "개소",
    metricDeathsLabel: "사망자 수", metricDeathsUnit: "명",
    metricInjuredLabel: "부상자 수", metricInjuredUnit: "명",
    metricHousesLabel: "주택 피해", metricHousesUnit: "동",
    metricWaterOutageLabel: "단수 가구 수", metricWaterOutageUnit: "가구",
    metricWaterStationsLabel: "급수소 수", metricWaterStationsUnit: "개소",
    metricPowerOutageLabel: "정전 가구 수", metricPowerOutageUnit: "가구",

    eventMetaTemplate: "M{m}・최대 진도{shindo}・{date} 발생・{epicenter}（깊이 {depth}km）",
  },

  fil: {
    appTitle: "Mapa ng Pinsala sa Lindol sa Kumamoto 2026",
    metaDescriptionTemplate: "Mapa ng pinsala ng Lindol sa Kumamoto 2026 bawat munisipalidad. Sa {date}: {evacuees} evacuee, {shelters} evacuation center, {water} bahay na walang tubig. Di-opisyal na site batay sa opisyal na ulat.",
    ogDescriptionTemplate: "Sa {date}: {evacuees} evacuee, {shelters} evacuation center, {water} bahay na walang tubig. Tingnan ang pinsala sa timeline map.",
    dataPageLinkText: "Text na bersyon: lahat ng talahanayan ng datos",
    noscriptNote: "Kailangan ng JavaScript para sa mapa. Makikita rin ang datos sa {link}.",
    langSwitchAriaLabel: "Wika",
    menuButtonAriaLabel: "Menu",
    menuAriaLabel: "Menu",

    modeMetric: "Mapa ng datos",
    modeNews: "Mapa ng balita",
    modeAriaLabel: "Mode ng pagpapakita ng mapa",

    panelLeftAriaLabel: "Pagpili ng indicator at kalagayan bawat munisipalidad",
    panelToggleRanking: "Indicator / munisipalidad",
    panelCloseAriaLabel: "Isara ang panel na ito",
    panelMetricSubhead: "Piliin ang ipapakitang indicator",
    metricSwitchAriaLabel: "Piliin ang ipapakitang indicator",
    statPrefTotal: "Kabuuan ng Kumamoto",
    statLabelTemplate: "Kabuuan ng Kumamoto - {metric}",
    rankingHeading: "Ayon sa munisipalidad (pinakamarami, top 10)",
    tableToggleBtn: "Tingnan ang talahanayan (lahat ng munisipalidad, lahat ng indicator)",

    panelNewsSubhead: "I-filter ayon sa kategorya",
    newsFilterAriaLabel: "I-filter ang balita ayon sa kategorya",
    newsHeading: "Listahan ng balita",

    mapAriaLabel: "Mapa ng pinsala ayon sa munisipalidad",
    epicenterLabel: "Epicenter",

    legendTitleDefault: "Laki ng bilog",
    legendTitleTemplate: "Laki ng bilog ({metric})",
    legendNote: "Maliit na hollow na tuldok = 0 (may ulat) / walang ipinapakita = wala pang ulat",
    labelsHiddenZoomHint: "{n} label ang itinago dahil sa pagpapatong (i-tap para mag-zoom)",

    tableOverlayAriaLabel: "Talahanayan ng datos para sa lahat ng munisipalidad at indicator",
    tableClose: "← Bumalik sa mapa",
    tableHeading: "Lahat ng munisipalidad / lahat ng indicator (kasalukuyang oras)",
    tableColMuni: "Munisipalidad",
    tableCaption: "{date}. Ang “—” ay walang datos (hindi pa nailalathala); ang “＊” ay kabuuan ng kilalang bahagi lang; ang “†” ay pinunan ng datos mula sa ulat ng Cabinet Office dahil wala pang ulat mula sa Kumamoto Prefecture.",

    panelToggleDetail: "Detalye",
    panelRightAriaLabel: "Detalye ng munisipalidad",
    detailPlaceholder: "I-click ang isang bilog sa mapa, o isang munisipalidad sa listahan sa kaliwa, para makita ang detalye.",
    detailNoDataAtPoint: "Walang datos para sa oras na ito.",
    sparklineHeadingTemplate: "Trend ({metric})",
    sparklineCurrentTemplate: "Kasalukuyan: {value}",
    sparklineCurrentNoData: "Kasalukuyan: walang datos",
    unknownComponentNote: "(may hindi kilalang bahagi: hindi pa naiuulat ang ibang detalye, kaya ito ay kabuuan ng kilalang bahagi lang)",
    waterSourceNoteDetail: "Ipinapakita gamit ang datos mula sa Cabinet Office (wala pang ulat mula sa Kumamoto Prefecture kaya hindi kasama sa kabuuan ng prepektura)",
    waterPeakTemplate: "Pinakamataas na walang tubig: {value}",
    waterPeriodTemplate: "Panahon ng suplay ng tubig: {value}",

    tlPrevAriaLabel: "Nakaraang oras",
    tlPrevTitle: "Nakaraan (←)",
    tlNextAriaLabel: "Susunod na oras",
    tlNextTitle: "Susunod (→)",
    tlPlayAriaLabel: "Awtomatikong i-play",
    tlPlay: "I-play ▶",
    tlPause: "I-pause ❚❚",
    tlSliderAriaLabel: "Pumili ng oras",
    tlInfoToggle: "Pinagmulan at tala",

    disclaimerStrong: "Hindi opisyal na visualization ng mga pampublikong materyales ang site na ito. Palaging suriin ang eksaktong impormasyon sa mga pangunahing pinagmulan (opisyal na anunsyo ng Kumamoto Prefecture at Cabinet Office).",
    bannerNotice: "Hindi opisyal na visualization site ito. Pakisuri ang impormasyon gamit ang opisyal na anunsyo ng Kumamoto Prefecture at Cabinet Office.",
    bannerCloseAriaLabel: "Isara ang paalalang ito",
    infoDisclaimer: "Paunang datos ang lahat ng numero sa bawat oras at maaaring magbago habang tumutuloy ang imbestigasyon.",
    infoCreditPrefix: "Pinagmulan: Materyales ng pulong ng Disaster Response Headquarters ng Kumamoto Prefecture / Ulat ng pinsala ng Cabinet Office / ",
    infoCreditGsiLinkText: "GSI Tiles (Geospatial Information Authority of Japan)",
    infoOpenSourcePrefix: "Open source ang site na ito:",
    infoGithubLinkText: "GitHub (wideplain/disaster-map-kumamoto-2026)",
    infoAnalytics: "Gumagamit ang site na ito ng Google Analytics para malaman kung paano ito ginagamit.",

    sourcePrefix: "Pinagmulan: ",
    sourceNewsLinkTemplate: "Impormasyon ng Cabinet Office tungkol sa sakuna (ulat noong {date})",
    sourceNewsReportNotFound: "Walang nahanap na ulat para sa oras na ito",
    sourceNewsUnavailable: "Hindi na-load ang datos ng balita",

    valNoData: "Walang datos",
    valUnknownSuffix: " (may hindi kilalang bahagi)",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "Wala pang ulat mula sa Kumamoto Prefecture kaya ipinapakita ang datos ng ulat ng {source} (hindi kasama sa kabuuan ng prepektura)",
    waterSourceBadgeTextTemplate: "mula sa ulat ng {source}",

    extrasPrefix: "※ Hindi pa naitalaga sa munisipalidad: ",
    extrasDeathsInvestigating: "{n} nasa ilalim ng imbestigasyon bilang may kaugnayan sa sakuna",
    extrasDeathsPossible: "{n} posibleng may kaugnayan sa sakuna",
    extrasUnidentifiedDeaths: "{n} hindi pa nakikilala",
    extrasUnidentifiedInjuredPrefix: "Sa mga hindi pa nakikilala: ",
    extrasInjuredLight: "{n} magaan na sugat",
    extrasInjuredModerate: "{n} katamtamang sugat",
    extrasInjuredSevere: "{n} malubhang sugat",
    extrasWaterSourceNote: "※ Ang mga munisipalidad na wala pang ulat mula sa prepektura ay ipinapakita sa mapa gamit ang datos ng Cabinet Office (hindi kasama sa kabuuan ng prepektura)",

    newsBadgeNew: "BAGO",
    newsBadgeUpdated: "NA-UPDATE",
    newsGroupGlobalTemplate: "Buong prepektura ({n})",
    newsGroupMuniLabel: "Ayon sa munisipalidad",
    newsEmptyNoData: "Hindi na-load ang datos ng balita.",
    newsEmptyNoReport: "Walang ulat para sa oras na ito.",
    newsEmptyNoMatch: "Walang balitang tumutugma sa oras/kategoryang ito.",
    newsEmptyNoneAtPoint: "Walang balita para sa oras na ito.",
    newsMarkerAriaLabelTemplate: "{muni}: {n} balita",
    newsTranslationNotice: "Ang mga balita ay direktang sipi sa orihinal na Japanese mula sa opisyal na mapagkukunan.",

    catLifeline: "Serbisyong pangkabuhayan",
    catTransport: "Transportasyon",
    catMedical: "Medikal at welfare",
    catDaily: "Pang-araw-araw na buhay at pamahalaan",
    catIndustry: "Industriya",

    metricEvacueesLabel: "Mga evacuee", metricEvacueesUnit: " katao",
    metricSheltersLabel: "Mga evacuation center", metricSheltersUnit: " sentro",
    metricDeathsLabel: "Namatay", metricDeathsUnit: " katao",
    metricInjuredLabel: "Nasugatan", metricInjuredUnit: " katao",
    metricHousesLabel: "Nasirang bahay", metricHousesUnit: " bahay",
    metricWaterOutageLabel: "Bahay na walang tubig", metricWaterOutageUnit: " bahay",
    metricWaterStationsLabel: "Water station", metricWaterStationsUnit: " estasyon",
    metricPowerOutageLabel: "Bahay na walang kuryente", metricPowerOutageUnit: " bahay",

    eventMetaTemplate: "M{m}・Pinakamataas na intensity {shindo}・Nangyari {date}・{epicenter}（lalim {depth}km）",
  },

  ne: {
    appTitle: "रेइवा ८ औं वर्ष कुमामोतो भूकम्प क्षति नक्सा",
    metaDescriptionTemplate: "कुमामोतो भूकम्प २०२६ को नगरपालिका अनुसार क्षति नक्सा। {date} सम्म: विस्थापित {evacuees} जना, आश्रय स्थल {shelters}, पानी नआएका घरधुरी {water}। आधिकारिक विवरणमा आधारित अनौपचारिक साइट।",
    ogDescriptionTemplate: "{date} सम्म: विस्थापित {evacuees} जना, आश्रय स्थल {shelters} वटा, पानी नआएका घरधुरी {water}। नक्सामा हेर्नुहोस्।",
    dataPageLinkText: "पाठ संस्करण: सबै तथ्याङ्क तालिका",
    noscriptNote: "नक्सा हेर्न JavaScript आवश्यक छ। तथ्याङ्क {link} मा पनि उपलब्ध छ।",
    langSwitchAriaLabel: "भाषा",
    menuButtonAriaLabel: "मेनु",
    menuAriaLabel: "मेनु",

    modeMetric: "तथ्याङ्क नक्सा",
    modeNews: "समाचार नक्सा",
    modeAriaLabel: "नक्सा देखाउने तरिका",

    panelLeftAriaLabel: "सूचक छनोट र नगरपालिकाअनुसारको अवस्था",
    panelToggleRanking: "सूचक・नगरपालिका",
    panelCloseAriaLabel: "यो प्यानल बन्द गर्नुहोस्",
    panelMetricSubhead: "देखाउने सूचक छान्नुहोस्",
    metricSwitchAriaLabel: "देखाउने सूचक छान्नुहोस्",
    statPrefTotal: "कुमामोतो प्रान्त जम्मा",
    statLabelTemplate: "कुमामोतो प्रान्त जम्मा - {metric}",
    rankingHeading: "नगरपालिकाअनुसार अवस्था（बढी भएका क्रममा・माथिल्लो १०）",
    tableToggleBtn: "तालिकामा हेर्नुहोस्（सबै नगरपालिका・सबै सूचक）",

    panelNewsSubhead: "श्रेणीअनुसार छान्नुहोस्",
    newsFilterAriaLabel: "समाचार श्रेणीअनुसार छान्नुहोस्",
    newsHeading: "समाचार सूची",

    mapAriaLabel: "नगरपालिकाअनुसार क्षतिको नक्सा",
    epicenterLabel: "भूकम्पको केन्द्रबिन्दु",

    legendTitleDefault: "गोलाको आकार",
    legendTitleTemplate: "गोलाको आकार（{metric}）",
    legendNote: "सानो खाली गोलो थोप्लो = ० (प्रतिवेदन आइसक्यो) ／ केही नदेखिनु = अझै प्रतिवेदन आएको छैन",
    labelsHiddenZoomHint: "खप्टिएकाले {n} लेबल लुकाइएको छ (जुम गर्न ट्याप गर्नुहोस्)",

    tableOverlayAriaLabel: "सबै नगरपालिका र सबै सूचकको तथ्याङ्क तालिका",
    tableClose: "← नक्सामा फर्किनुहोस्",
    tableHeading: "सबै नगरपालिका・सबै सूचक（हालको समयबिन्दु）",
    tableColMuni: "नगरपालिका",
    tableCaption: "{date}को तथ्याङ्क। “—” ले तथ्याङ्क नभएको (अझै प्रकाशित नभएको) जनाउँछ; “＊” ले केही विवरण अज्ञात भई थाहा भएको भागको मात्र जोड जनाउँछ; “†” ले कुमामोतो प्रान्तको प्रतिवेदन अझै नआएकाले नाइकाकुफुको प्रतिवेदनको मानले पूरा गरिएको जनाउँछ।",

    panelToggleDetail: "विवरण",
    panelRightAriaLabel: "नगरपालिकाको विवरण",
    detailPlaceholder: "नक्सामा गोलो, वा बायाँको सूचीमा नगरपालिकामा क्लिक गर्दा विवरण देखिन्छ।",
    detailNoDataAtPoint: "यो समयबिन्दुको तथ्याङ्क छैन।",
    sparklineHeadingTemplate: "परिवर्तन（{metric}）",
    sparklineCurrentTemplate: "हाल: {value}",
    sparklineCurrentNoData: "हाल: तथ्याङ्क छैन",
    unknownComponentNote: "（अज्ञात भाग समावेश: केही विवरण अझै प्रतिवेदन नभएकाले यो थाहा भएको भागको मात्र जोड हो）",
    waterSourceNoteDetail: "नाइकाकुफुको प्रतिवेदनको मान देखाइएको（कुमामोतो प्रान्तको प्रतिवेदन अझै नआएकाले प्रान्तको जम्मामा समावेश छैन）",
    waterPeakTemplate: "पानी बन्द भएको उच्चतम: {value}",
    waterPeriodTemplate: "पानी आपूर्ति अवधि: {value}",

    tlPrevAriaLabel: "अघिल्लो समयबिन्दुमा",
    tlPrevTitle: "अघिल्लो（←）",
    tlNextAriaLabel: "अर्को समयबिन्दुमा",
    tlNextTitle: "अर्को（→）",
    tlPlayAriaLabel: "स्वचालित प्ले",
    tlPlay: "प्ले ▶",
    tlPause: "रोक्नुहोस् ❚❚",
    tlSliderAriaLabel: "समयबिन्दु छान्नुहोस्",
    tlInfoToggle: "स्रोत र टिप्पणी",

    disclaimerStrong: "यो साइट सार्वजनिक सामग्रीलाई हेर्न सजिलो बनाई देखाइएको अनौपचारिक साइट हो। सही जानकारीको लागि सधैं प्राथमिक स्रोत（कुमामोतो प्रान्त र नाइकाकुफुको आधिकारिक घोषणा）हेर्नुहोस्।",
    bannerNotice: "यो अनौपचारिक भिजुअलाइजेसन साइट हो। सही जानकारीको लागि कुमामोतो प्रान्त र नाइकाकुफुको आधिकारिक घोषणा हेर्नुहोस्।",
    bannerCloseAriaLabel: "यो सूचना बन्द गर्नुहोस्",
    infoDisclaimer: "सबै अंकहरू प्रत्येक समयबिन्दुको प्रारम्भिक तथ्याङ्क हुन् र पछि अनुसन्धानले परिवर्तन हुन सक्छ।",
    infoCreditPrefix: "स्रोत: कुमामोतो प्रान्त विपद् प्रतिकार्य मुख्यालय बैठक सामग्री／नाइकाकुफु विपद् जानकारी क्षति प्रतिवेदन／",
    infoCreditGsiLinkText: "जीएसआई टाइल (राष्ट्रिय भू-स्थानिक सूचना संस्थान)",
    infoOpenSourcePrefix: "यो साइट खुला स्रोत हो:",
    infoGithubLinkText: "GitHub（wideplain/disaster-map-kumamoto-2026）",
    infoAnalytics: "यो साइटले प्रयोगको अवस्था बुझ्न Google Analytics प्रयोग गर्छ।",

    sourcePrefix: "स्रोत: ",
    sourceNewsLinkTemplate: "नाइकाकुफु विपद् जानकारी（{date} सम्मको प्रतिवेदन）",
    sourceNewsReportNotFound: "यो समयबिन्दुसँग मिल्ने प्रतिवेदन फेला परेन",
    sourceNewsUnavailable: "समाचार तथ्याङ्क लोड हुन सकेन",

    valNoData: "तथ्याङ्क छैन",
    valUnknownSuffix: "（अज्ञात भाग समावेश）",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "कुमामोतो प्रान्तको प्रतिवेदन अझै नआएकाले {source} प्रतिवेदनको मान देखाइएको（प्रान्तको जम्मामा समावेश छैन）",
    waterSourceBadgeTextTemplate: "{source} प्रतिवेदन अनुसार",

    extrasPrefix: "※ नगरपालिका अझै निर्धारण नभएका: ",
    extrasDeathsInvestigating: "विपद्सम्बन्धी अनुसन्धानमा {n} जना",
    extrasDeathsPossible: "विपद्सम्बन्धी सम्भावित {n} जना",
    extrasUnidentifiedDeaths: "परिचय नखुलेका {n} जना",
    extrasUnidentifiedInjuredPrefix: "परिचय नखुलेकाहरूमध्ये",
    extrasInjuredLight: "सामान्य घाइते {n} जना",
    extrasInjuredModerate: "मध्यम घाइते {n} जना",
    extrasInjuredSevere: "गम्भीर घाइते {n} जना",
    extrasWaterSourceNote: "※ प्रान्तले अझै प्रतिवेदन नगरेका नगरपालिकाहरू नक्सामा नाइकाकुफुको प्रतिवेदनको मानले देखाइएको छ（प्रान्तको जम्मामा समावेश छैन）",

    newsBadgeNew: "नयाँ",
    newsBadgeUpdated: "अद्यावधिक",
    newsGroupGlobalTemplate: "सम्पूर्ण प्रान्त（{n} वटा）",
    newsGroupMuniLabel: "नगरपालिकाअनुसार",
    newsEmptyNoData: "समाचार तथ्याङ्क लोड हुन सकेन।",
    newsEmptyNoReport: "यो समयबिन्दुसँग मिल्ने प्रतिवेदन छैन।",
    newsEmptyNoMatch: "यो समयबिन्दु र श्रेणीसँग मिल्ने समाचार छैन।",
    newsEmptyNoneAtPoint: "यो समयबिन्दुको समाचार छैन।",
    newsMarkerAriaLabelTemplate: "{muni}: {n} समाचार",
    newsTranslationNotice: "समाचारहरू आधिकारिक स्रोतबाट जापानी मूल पाठमै उद्धृत गरिएका हुन्।",

    catLifeline: "जीवनरेखा सेवा",
    catTransport: "यातायात",
    catMedical: "स्वास्थ्य・कल्याण",
    catDaily: "दैनिक जीवन・प्रशासन",
    catIndustry: "उद्योग",

    metricEvacueesLabel: "विस्थापित जनसंख्या", metricEvacueesUnit: " जना",
    metricSheltersLabel: "आश्रय स्थलको संख्या", metricSheltersUnit: " वटा",
    metricDeathsLabel: "मृतकको संख्या", metricDeathsUnit: " जना",
    metricInjuredLabel: "घाइतेको संख्या", metricInjuredUnit: " जना",
    metricHousesLabel: "क्षतिग्रस्त घर", metricHousesUnit: " वटा",
    metricWaterOutageLabel: "पानी नआएका घरधुरी", metricWaterOutageUnit: " घरधुरी",
    metricWaterStationsLabel: "पानी वितरण केन्द्र", metricWaterStationsUnit: " वटा",
    metricPowerOutageLabel: "बिजुली नभएका घरधुरी", metricPowerOutageUnit: " घरधुरी",

    eventMetaTemplate: "M{m}・अधिकतम तीव्रता {shindo}・{date} मा भएको・{epicenter}（गहिराइ {depth}km）",
  },

  "pt-BR": {
    appTitle: "Mapa de Danos do Terremoto de Kumamoto 2026",
    metaDescriptionTemplate: "Mapa de danos do Terremoto de Kumamoto 2026 por município. Em {date}: {evacuees} evacuados, {shelters} abrigos, {water} domicílios sem água. Site não oficial baseado em relatórios oficiais.",
    ogDescriptionTemplate: "Em {date}: {evacuees} evacuados, {shelters} abrigos, {water} domicílios sem água. Danos por município em mapa com linha do tempo.",
    dataPageLinkText: "Versão em texto: todas as tabelas de dados",
    noscriptNote: "O mapa interativo requer JavaScript. Os dados também estão disponíveis em {link}.",
    langSwitchAriaLabel: "Idioma",
    menuButtonAriaLabel: "Menu",
    menuAriaLabel: "Menu",

    modeMetric: "Mapa de dados",
    modeNews: "Mapa de notícias",
    modeAriaLabel: "Modo de exibição do mapa",

    panelLeftAriaLabel: "Seleção de indicador e situação por município",
    panelToggleRanking: "Indicador / municípios",
    panelCloseAriaLabel: "Fechar este painel",
    panelMetricSubhead: "Escolha um indicador",
    metricSwitchAriaLabel: "Escolha um indicador",
    statPrefTotal: "Total da Província de Kumamoto",
    statLabelTemplate: "Total da Província de Kumamoto - {metric}",
    rankingHeading: "Por município (maiores valores, top 10)",
    tableToggleBtn: "Ver tabela (todos os municípios, todos os indicadores)",

    panelNewsSubhead: "Filtrar por categoria",
    newsFilterAriaLabel: "Filtrar notícias por categoria",
    newsHeading: "Lista de notícias",

    mapAriaLabel: "Mapa de danos por município",
    epicenterLabel: "Epicentro",

    legendTitleDefault: "Tamanho do círculo",
    legendTitleTemplate: "Tamanho do círculo ({metric})",
    legendNote: "Ponto pequeno vazado = 0 (informado) / sem círculo = ainda não informado",
    labelsHiddenZoomHint: "{n} rótulos ocultos por sobreposição (toque para ampliar)",

    tableOverlayAriaLabel: "Tabela de dados de todos os municípios e indicadores",
    tableClose: "← Voltar ao mapa",
    tableHeading: "Todos os municípios / todos os indicadores (momento atual)",
    tableColMuni: "Município",
    tableCaption: "{date}. “—” significa sem dados (ainda não publicados); “＊” significa que o total soma apenas a parte conhecida do detalhamento; “†” significa valor complementado pelo relatório do Gabinete do Governo, pois a Província de Kumamoto ainda não informou.",

    panelToggleDetail: "Detalhes",
    panelRightAriaLabel: "Detalhes do município",
    detailPlaceholder: "Clique em um círculo no mapa, ou em um município na lista à esquerda, para ver os detalhes.",
    detailNoDataAtPoint: "Sem dados para este momento.",
    sparklineHeadingTemplate: "Evolução ({metric})",
    sparklineCurrentTemplate: "Atual: {value}",
    sparklineCurrentNoData: "Atual: sem dados",
    unknownComponentNote: "(inclui parte desconhecida: parte do detalhamento ainda não foi informada, então este é apenas o total da parte conhecida)",
    waterSourceNoteDetail: "Exibido com o valor do relatório do Gabinete do Governo (a Província de Kumamoto ainda não informou, então não está incluído no total da província)",
    waterPeakTemplate: "Pico de falta de água: {value}",
    waterPeriodTemplate: "Período de abastecimento: {value}",

    tlPrevAriaLabel: "Momento anterior",
    tlPrevTitle: "Anterior (←)",
    tlNextAriaLabel: "Próximo momento",
    tlNextTitle: "Próximo (→)",
    tlPlayAriaLabel: "Reprodução automática",
    tlPlay: "Reproduzir ▶",
    tlPause: "Pausar ❚❚",
    tlSliderAriaLabel: "Escolher momento",
    tlInfoToggle: "Fontes e notas",

    disclaimerStrong: "Este site é uma visualização não oficial de materiais públicos. Sempre verifique as informações precisas nas fontes primárias (anúncios oficiais da Província de Kumamoto e do Gabinete do Governo).",
    bannerNotice: "Este é um site de visualização não oficial. Verifique as informações com os anúncios oficiais da Província de Kumamoto e do Gabinete do Governo.",
    bannerCloseAriaLabel: "Fechar este aviso",
    infoDisclaimer: "Todos os números são valores preliminares de cada momento e podem mudar conforme as investigações avançam.",
    infoCreditPrefix: "Fontes: materiais de reunião da Sede de Resposta a Desastres da Província de Kumamoto / relatórios de danos do Gabinete do Governo / ",
    infoCreditGsiLinkText: "Mapas GSI (Instituto Geoespacial do Japão)",
    infoOpenSourcePrefix: "Este site é de código aberto:",
    infoGithubLinkText: "GitHub (wideplain/disaster-map-kumamoto-2026)",
    infoAnalytics: "Este site usa o Google Analytics para entender como é utilizado.",

    sourcePrefix: "Fonte: ",
    sourceNewsLinkTemplate: "Informações de desastres do Gabinete do Governo (relatório em {date})",
    sourceNewsReportNotFound: "Nenhum relatório encontrado para este momento",
    sourceNewsUnavailable: "Não foi possível carregar os dados de notícias",

    valNoData: "Sem dados",
    valUnknownSuffix: " (inclui parte desconhecida)",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "Ainda não informado pela Província de Kumamoto, então o valor do relatório {source} é exibido (não incluído no total da província)",
    waterSourceBadgeTextTemplate: "do relatório {source}",

    extrasPrefix: "※ Ainda não atribuído a um município: ",
    extrasDeathsInvestigating: "{n} em investigação como relacionados ao desastre",
    extrasDeathsPossible: "{n} possivelmente relacionados ao desastre",
    extrasUnidentifiedDeaths: "{n} não identificados",
    extrasUnidentifiedInjuredPrefix: "Entre os não identificados: ",
    extrasInjuredLight: "{n} feridos leves",
    extrasInjuredModerate: "{n} feridos moderados",
    extrasInjuredSevere: "{n} feridos graves",
    extrasWaterSourceNote: "※ Municípios ainda não informados pela província são exibidos no mapa com valores do relatório do Gabinete do Governo (não incluídos no total da província)",

    newsBadgeNew: "NOVO",
    newsBadgeUpdated: "ATUALIZADO",
    newsGroupGlobalTemplate: "Toda a província ({n})",
    newsGroupMuniLabel: "Por município",
    newsEmptyNoData: "Não foi possível carregar os dados de notícias.",
    newsEmptyNoReport: "Não há relatório para este momento.",
    newsEmptyNoMatch: "Nenhuma notícia corresponde a este momento/categoria.",
    newsEmptyNoneAtPoint: "Nenhuma notícia para este momento.",
    newsMarkerAriaLabelTemplate: "{muni}: {n} notícias",
    newsTranslationNotice: "As notícias são citadas no original em japonês, tal como nas fontes oficiais.",

    catLifeline: "Infraestrutura essencial",
    catTransport: "Transporte",
    catMedical: "Saúde e assistência social",
    catDaily: "Vida cotidiana e administração",
    catIndustry: "Indústria",

    metricEvacueesLabel: "Evacuados", metricEvacueesUnit: " pessoas",
    metricSheltersLabel: "Abrigos", metricSheltersUnit: " abrigos",
    metricDeathsLabel: "Óbitos", metricDeathsUnit: " óbitos",
    metricInjuredLabel: "Feridos", metricInjuredUnit: " feridos",
    metricHousesLabel: "Casas danificadas", metricHousesUnit: " casas",
    metricWaterOutageLabel: "Domicílios sem água", metricWaterOutageUnit: " domicílios",
    metricWaterStationsLabel: "Pontos de abastecimento de água", metricWaterStationsUnit: " pontos",
    metricPowerOutageLabel: "Domicílios sem energia", metricPowerOutageUnit: " domicílios",

    eventMetaTemplate: "M{m}・Intensidade máxima {shindo}・Ocorrido em {date}・{epicenter}（profundidade {depth}km）",
  },

  id: {
    appTitle: "Peta Kerusakan Gempa Kumamoto 2026",
    metaDescriptionTemplate: "Peta kerusakan Gempa Kumamoto 2026 per wilayah. Per {date}: {evacuees} pengungsi, {shelters} tempat pengungsian, {water} rumah tangga tanpa air. Situs tidak resmi berdasarkan laporan resmi.",
    ogDescriptionTemplate: "Per {date}: {evacuees} pengungsi, {shelters} tempat pengungsian, {water} rumah tangga tanpa air. Lihat kerusakan per wilayah di peta.",
    dataPageLinkText: "Versi teks: semua tabel data",
    noscriptNote: "Peta memerlukan JavaScript. Data juga tersedia di {link}.",
    langSwitchAriaLabel: "Bahasa",
    menuButtonAriaLabel: "Menu",
    menuAriaLabel: "Menu",

    modeMetric: "Peta data",
    modeNews: "Peta berita",
    modeAriaLabel: "Mode tampilan peta",

    panelLeftAriaLabel: "Pemilihan indikator dan kondisi tiap kota/kabupaten",
    panelToggleRanking: "Indikator / wilayah",
    panelCloseAriaLabel: "Tutup panel ini",
    panelMetricSubhead: "Pilih indikator yang ditampilkan",
    metricSwitchAriaLabel: "Pilih indikator yang ditampilkan",
    statPrefTotal: "Total Prefektur Kumamoto",
    statLabelTemplate: "Total Prefektur Kumamoto - {metric}",
    rankingHeading: "Berdasarkan wilayah (terbanyak, 10 teratas)",
    tableToggleBtn: "Lihat tabel (semua wilayah, semua indikator)",

    panelNewsSubhead: "Filter berdasarkan kategori",
    newsFilterAriaLabel: "Filter berita berdasarkan kategori",
    newsHeading: "Daftar berita",

    mapAriaLabel: "Peta kerusakan per wilayah",
    epicenterLabel: "Episentrum",

    legendTitleDefault: "Ukuran lingkaran",
    legendTitleTemplate: "Ukuran lingkaran ({metric})",
    legendNote: "Titik kecil berongga = 0 (sudah dilaporkan) / tidak ditampilkan = belum dilaporkan",
    labelsHiddenZoomHint: "{n} label disembunyikan karena tumpang tindih (ketuk untuk memperbesar)",

    tableOverlayAriaLabel: "Tabel data semua wilayah dan indikator",
    tableClose: "← Kembali ke peta",
    tableHeading: "Semua wilayah / semua indikator (waktu saat ini)",
    tableColMuni: "Wilayah",
    tableCaption: "{date}. “—” berarti tidak ada data (belum dipublikasikan); “＊” berarti total hanya menjumlahkan bagian yang sudah diketahui; “†” berarti nilai dilengkapi dari laporan Kantor Kabinet karena Prefektur Kumamoto belum melaporkannya.",

    panelToggleDetail: "Detail",
    panelRightAriaLabel: "Detail wilayah",
    detailPlaceholder: "Klik lingkaran pada peta, atau wilayah pada daftar di sebelah kiri, untuk melihat detail.",
    detailNoDataAtPoint: "Tidak ada data untuk waktu ini.",
    sparklineHeadingTemplate: "Tren ({metric})",
    sparklineCurrentTemplate: "Saat ini: {value}",
    sparklineCurrentNoData: "Saat ini: tidak ada data",
    unknownComponentNote: "(termasuk bagian yang belum diketahui: sebagian rincian belum dilaporkan, sehingga ini hanya total dari bagian yang diketahui)",
    waterSourceNoteDetail: "Ditampilkan dengan nilai laporan Kantor Kabinet (belum dilaporkan oleh Prefektur Kumamoto sehingga tidak termasuk dalam total prefektur)",
    waterPeakTemplate: "Puncak gangguan air: {value}",
    waterPeriodTemplate: "Periode distribusi air: {value}",

    tlPrevAriaLabel: "Waktu sebelumnya",
    tlPrevTitle: "Sebelumnya (←)",
    tlNextAriaLabel: "Waktu berikutnya",
    tlNextTitle: "Berikutnya (→)",
    tlPlayAriaLabel: "Putar otomatis",
    tlPlay: "Putar ▶",
    tlPause: "Jeda ❚❚",
    tlSliderAriaLabel: "Pilih waktu",
    tlInfoToggle: "Sumber & catatan",

    disclaimerStrong: "Situs ini adalah visualisasi tidak resmi dari materi publik. Selalu periksa informasi akurat pada sumber utama (pengumuman resmi dari Prefektur Kumamoto dan Kantor Kabinet).",
    bannerNotice: "Ini adalah situs visualisasi tidak resmi. Mohon periksa informasi melalui pengumuman resmi Prefektur Kumamoto dan Kantor Kabinet.",
    bannerCloseAriaLabel: "Tutup pemberitahuan ini",
    infoDisclaimer: "Semua angka adalah data sementara pada setiap waktu dan dapat berubah seiring berlanjutnya investigasi.",
    infoCreditPrefix: "Sumber: materi rapat Markas Tanggap Bencana Prefektur Kumamoto / laporan kerusakan Kantor Kabinet / ",
    infoCreditGsiLinkText: "Peta GSI (Badan Informasi Geospasial Jepang)",
    infoOpenSourcePrefix: "Situs ini bersifat open source:",
    infoGithubLinkText: "GitHub (wideplain/disaster-map-kumamoto-2026)",
    infoAnalytics: "Situs ini menggunakan Google Analytics untuk memahami cara penggunaannya.",

    sourcePrefix: "Sumber: ",
    sourceNewsLinkTemplate: "Informasi bencana Kantor Kabinet (laporan per {date})",
    sourceNewsReportNotFound: "Tidak ditemukan laporan untuk waktu ini",
    sourceNewsUnavailable: "Data berita gagal dimuat",

    valNoData: "Tidak ada data",
    valUnknownSuffix: " (termasuk bagian yang belum diketahui)",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "Belum dilaporkan oleh Prefektur Kumamoto sehingga nilai laporan {source} ditampilkan (tidak termasuk dalam total prefektur)",
    waterSourceBadgeTextTemplate: "berdasarkan laporan {source}",

    extrasPrefix: "※ Belum ditetapkan ke wilayah tertentu: ",
    extrasDeathsInvestigating: "{n} sedang diselidiki terkait bencana",
    extrasDeathsPossible: "{n} kemungkinan terkait bencana",
    extrasUnidentifiedDeaths: "{n} belum teridentifikasi",
    extrasUnidentifiedInjuredPrefix: "Di antara yang belum teridentifikasi: ",
    extrasInjuredLight: "{n} luka ringan",
    extrasInjuredModerate: "{n} luka sedang",
    extrasInjuredSevere: "{n} luka berat",
    extrasWaterSourceNote: "※ Wilayah yang belum dilaporkan prefektur ditampilkan di peta menggunakan nilai laporan Kantor Kabinet (tidak termasuk dalam total prefektur)",

    newsBadgeNew: "BARU",
    newsBadgeUpdated: "DIPERBARUI",
    newsGroupGlobalTemplate: "Seluruh prefektur ({n})",
    newsGroupMuniLabel: "Berdasarkan wilayah",
    newsEmptyNoData: "Data berita gagal dimuat.",
    newsEmptyNoReport: "Tidak ada laporan untuk waktu ini.",
    newsEmptyNoMatch: "Tidak ada berita yang sesuai dengan waktu/kategori ini.",
    newsEmptyNoneAtPoint: "Tidak ada berita untuk waktu ini.",
    newsMarkerAriaLabelTemplate: "{muni}: {n} berita",
    newsTranslationNotice: "Berita dikutip apa adanya dalam bahasa Jepang asli dari sumber resmi.",

    catLifeline: "Utilitas dasar",
    catTransport: "Transportasi",
    catMedical: "Medis & kesejahteraan",
    catDaily: "Kehidupan sehari-hari & pemerintahan",
    catIndustry: "Industri",

    metricEvacueesLabel: "Pengungsi", metricEvacueesUnit: " orang",
    metricSheltersLabel: "Tempat pengungsian", metricSheltersUnit: " lokasi",
    metricDeathsLabel: "Korban meninggal", metricDeathsUnit: " orang",
    metricInjuredLabel: "Korban luka", metricInjuredUnit: " orang",
    metricHousesLabel: "Rumah rusak", metricHousesUnit: " unit",
    metricWaterOutageLabel: "Rumah tangga tanpa air", metricWaterOutageUnit: " rumah tangga",
    metricWaterStationsLabel: "Titik distribusi air", metricWaterStationsUnit: " lokasi",
    metricPowerOutageLabel: "Rumah tangga tanpa listrik", metricPowerOutageUnit: " rumah tangga",

    eventMetaTemplate: "M{m}・Intensitas maksimum {shindo}・Terjadi {date}・{epicenter}（kedalaman {depth}km）",
  },

  my: {
    appTitle: "ရေဝါခေတ် ၈ နှစ် ကုမမိုတို ငလျင် ပျက်စီးမှု မြေပုံ",
    metaDescriptionTemplate: "ကုမမိုတို ငလျင် ၂၀၂၆ မြို့နယ်အလိုက် ပျက်စီးမှု မြေပုံ။ {date} အထိ ဘေးရှောင်သူ {evacuees} ဦး၊ ခိုလှုံရာစခန်း {shelters} ခု၊ ရေမရသော အိမ်ထောင်စု {water} စု။ တရားဝင် ထုတ်ပြန်ချက်များအပေါ် အခြေခံသော အလွတ်သဘော ဆိုက်။",
    ogDescriptionTemplate: "{date} အထိ ဘေးရှောင်သူ {evacuees} ဦး၊ ခိုလှုံရာစခန်း {shelters} ခု၊ ရေမရသော အိမ်ထောင်စု {water} စု။ မြေပုံပေါ်တွင် ကြည့်ရှုပါ။",
    dataPageLinkText: "စာသားပုံစံ ဒေတာဇယားများ",
    noscriptNote: "မြေပုံကြည့်ရန် JavaScript လိုအပ်သည်။ ဒေတာကို {link} တွင်လည်း ကြည့်နိုင်သည်။",
    langSwitchAriaLabel: "ဘာသာစကား",
    menuButtonAriaLabel: "မီနူး",
    menuAriaLabel: "မီနူး",

    modeMetric: "ကိန်းဂဏန်း မြေပုံ",
    modeNews: "သတင်း မြေပုံ",
    modeAriaLabel: "မြေပုံ ပြသမှု စနစ်",

    panelLeftAriaLabel: "အညွှန်းကိန်း ရွေးချယ်မှုနှင့် မြို့နယ်အလိုက် အခြေအနေ",
    panelToggleRanking: "အညွှန်းကိန်း・မြို့နယ်",
    panelCloseAriaLabel: "ဤ panel ကို ပိတ်ပါ",
    panelMetricSubhead: "ပြသမည့် အညွှန်းကိန်း ရွေးပါ",
    metricSwitchAriaLabel: "ပြသမည့် အညွှန်းကိန်း ရွေးပါ",
    statPrefTotal: "ကုမမိုတို ပြည်နယ် စုစုပေါင်း",
    statLabelTemplate: "ကုမမိုတို ပြည်နယ် စုစုပေါင်း - {metric}",
    rankingHeading: "မြို့နယ်အလိုက် အခြေအနေ（အများဆုံး အစီအစဉ်・ထိပ်ဆုံး ၁၀）",
    tableToggleBtn: "ဇယားဖြင့် ကြည့်ရန်（မြို့နယ်အားလုံး・အညွှန်းကိန်း အားလုံး）",

    panelNewsSubhead: "အမျိုးအစားဖြင့် စစ်ထုတ်ရန်",
    newsFilterAriaLabel: "သတင်းအမျိုးအစားဖြင့် စစ်ထုတ်ရန်",
    newsHeading: "သတင်း စာရင်း",

    mapAriaLabel: "မြို့နယ်အလိုက် ပျက်စီးမှု မြေပုံ",
    epicenterLabel: "ငလျင်ဗဟိုချက်",

    legendTitleDefault: "စက်ဝိုင်း အရွယ်အစား",
    legendTitleTemplate: "စက်ဝိုင်း အရွယ်အစား（{metric}）",
    legendNote: "အလွတ် အစက်ငယ် = ၀（သတင်းပို့ပြီး）／ မပြသခြင်း = သတင်းပို့ရသေးခြင်း မရှိ",
    labelsHiddenZoomHint: "ထပ်နေသောကြောင့် တံဆိပ် {n} ခုကို ဖျောက်ထားသည် (ချဲ့ရန် နှိပ်ပါ)",

    tableOverlayAriaLabel: "မြို့နယ်အားလုံးနှင့် အညွှန်းကိန်းအားလုံး ဒေတာဇယား",
    tableClose: "← မြေပုံသို့ ပြန်သွားရန်",
    tableHeading: "မြို့နယ်အားလုံး・အညွှန်းကိန်း အားလုံး（လက်ရှိ အချိန်）",
    tableColMuni: "မြို့နယ်",
    tableCaption: "{date} ဒေတာ။ 「—」သည် ဒေတာမရှိ（မထုတ်ပြန်ရသေး）ကို၊ 「＊」သည် အချို့အသေးစိတ် မသိရသေးသဖြင့် သိရသော အပိုင်းသာ ပေါင်းထားခြင်းကို၊ 「†」သည် ကုမမိုတို ပြည်နယ် အစီရင်ခံစာ မရရှိသေးသဖြင့် ကက်ဘိနက်ရုံး အစီရင်ခံစာ တန်ဖိုးဖြင့် ဖြည့်စွက်ထားခြင်းကို ဆိုလိုသည်။",

    panelToggleDetail: "အသေးစိတ်",
    panelRightAriaLabel: "မြို့နယ် အသေးစိတ်",
    detailPlaceholder: "မြေပုံပေါ်ရှိ စက်ဝိုင်း သို့မဟုတ် ဘယ်ဘက် စာရင်းရှိ မြို့နယ်ကို နှိပ်ပါက အသေးစိတ် ပြသပါမည်။",
    detailNoDataAtPoint: "ဤအချိန်အတွက် ဒေတာ မရှိပါ။",
    sparklineHeadingTemplate: "အပြောင်းအလဲ（{metric}）",
    sparklineCurrentTemplate: "လက်ရှိ: {value}",
    sparklineCurrentNoData: "လက်ရှိ: ဒေတာ မရှိပါ",
    unknownComponentNote: "（မသိရသေးသော အပိုင်း ပါဝင်သည်: အသေးစိတ်အချို့ သတင်းပို့ရသေးခြင်း မရှိသဖြင့် သိရသော အပိုင်းသာ ပေါင်းထားသည်）",
    waterSourceNoteDetail: "ကက်ဘိနက်ရုံး အစီရင်ခံစာ တန်ဖိုးဖြင့် ပြသထားသည်（ကုမမိုတို ပြည်နယ် အစီရင်ခံစာ မရရှိသေးသဖြင့် ပြည်နယ် စုစုပေါင်းတွင် မပါဝင်ပါ）",
    waterPeakTemplate: "ရေပြတ်တောက်မှု အမြင့်ဆုံး: {value}",
    waterPeriodTemplate: "ရေဖြန့်ချီသည့် ကာလ: {value}",

    tlPrevAriaLabel: "ယခင် အချိန်သို့",
    tlPrevTitle: "ယခင်（←）",
    tlNextAriaLabel: "နောက် အချိန်သို့",
    tlNextTitle: "နောက်（→）",
    tlPlayAriaLabel: "အလိုအလျောက် ဖွင့်ရန်",
    tlPlay: "ဖွင့်ရန် ▶",
    tlPause: "ရပ်ရန် ❚❚",
    tlSliderAriaLabel: "အချိန် ရွေးပါ",
    tlInfoToggle: "ရင်းမြစ်・မှတ်ချက်",

    disclaimerStrong: "ဤဆိုက်သည် အများပြည်သူသုံး စာရွက်စာတမ်းများကို ကြည့်ရှုရလွယ်ကူစွာ ပုံဖော်ထားသော အလွတ်သဘော ဆိုက်ဖြစ်သည်။ တိကျသော အချက်အလက်များအတွက် မူရင်းရင်းမြစ်（ကုမမိုတို ပြည်နယ်နှင့် ကက်ဘိနက်ရုံး၏ တရားဝင် ကြေညာချက်များ）ကို အမြဲ စစ်ဆေးပါ။",
    bannerNotice: "ဤသည် အလွတ်သဘော ပုံဖော်မှု ဆိုက်ဖြစ်သည်။ တိကျသော အချက်အလက်များကို ကုမမိုတို ပြည်နယ်နှင့် ကက်ဘိနက်ရုံး၏ တရားဝင် ကြေညာချက်များဖြင့် စစ်ဆေးပါ။",
    bannerCloseAriaLabel: "ဤအသိပေးချက်ကို ပိတ်ပါ",
    infoDisclaimer: "ကိန်းဂဏန်းများသည် အချိန်တိုင်း၏ ကနဦးအချက်အလက်များဖြစ်ပြီး နောင်တွင် စုံစမ်းစစ်ဆေးမှုများအရ ပြောင်းလဲနိုင်ပါသည်။",
    infoCreditPrefix: "ရင်းမြစ်: ကုမမိုတို ပြည်နယ် ဘေးအန္တရာယ် တုံ့ပြန်မှု ဌာနချုပ် အစည်းအဝေး စာရွက်စာတမ်း／ကက်ဘိနက်ရုံး ဘေးအန္တရာယ် သတင်းအချက်အလက် ပျက်စီးမှု အစီရင်ခံစာ／",
    infoCreditGsiLinkText: "GSI မြေပုံ (ဂျပန် ပထဝီအချက်အလက် အာဏာပိုင်ဌာန)",
    infoOpenSourcePrefix: "ဤဆိုက်သည် open source ဖြစ်သည်:",
    infoGithubLinkText: "GitHub（wideplain/disaster-map-kumamoto-2026）",
    infoAnalytics: "ဤဆိုက်သည် အသုံးပြုမှု အခြေအနေကို သိရှိရန် Google Analytics ကို အသုံးပြုသည်။",

    sourcePrefix: "ရင်းမြစ်: ",
    sourceNewsLinkTemplate: "ကက်ဘိနက်ရုံး ဘေးအန္တရာယ် သတင်းအချက်အလက်（{date} အထိ အစီရင်ခံစာ）",
    sourceNewsReportNotFound: "ဤအချိန်နှင့် ကိုက်ညီသော အစီရင်ခံစာ မတွေ့ပါ",
    sourceNewsUnavailable: "သတင်းဒေတာ ဖွင့်၍ မရပါ",

    valNoData: "ဒေတာ မရှိပါ",
    valUnknownSuffix: "（မသိရသေးသော အပိုင်း ပါဝင်သည်）",
    valDash: "—",

    waterSourceBadgeTitleTemplate: "ကုမမိုတို ပြည်နယ် အစီရင်ခံစာ မရရှိသေးသဖြင့် {source} အစီရင်ခံစာ တန်ဖိုးကို ပြသထားသည်（ပြည်နယ် စုစုပေါင်းတွင် မပါဝင်ပါ）",
    waterSourceBadgeTextTemplate: "{source} အစီရင်ခံစာအရ",

    extrasPrefix: "※ မြို့နယ် မသတ်မှတ်ရသေးသူများ: ",
    extrasDeathsInvestigating: "ဘေးအန္တရာယ်နှင့် ဆက်စပ်သည်ဟု စုံစမ်းနေဆဲ {n} ဦး",
    extrasDeathsPossible: "ဘေးအန္တရာယ်နှင့် ဆက်စပ်နိုင်ခြေ ရှိသူ {n} ဦး",
    extrasUnidentifiedDeaths: "အမည်မသိ {n} ဦး",
    extrasUnidentifiedInjuredPrefix: "အမည်မသိသူများအနက်",
    extrasInjuredLight: "ပေါ့ပါးသော ဒဏ်ရာ {n} ဦး",
    extrasInjuredModerate: "အလယ်အလတ် ဒဏ်ရာ {n} ဦး",
    extrasInjuredSevere: "ပြင်းထန်သော ဒဏ်ရာ {n} ဦး",
    extrasWaterSourceNote: "※ ပြည်နယ်မှ အစီရင်ခံစာ မရရှိသေးသော မြို့နယ်များကို ကက်ဘိနက်ရုံး အစီရင်ခံစာ တန်ဖိုးဖြင့် မြေပုံတွင် ပြသထားသည်（ပြည်နယ် စုစုပေါင်းတွင် မပါဝင်ပါ）",

    newsBadgeNew: "အသစ်",
    newsBadgeUpdated: "အပ်ဒိတ်",
    newsGroupGlobalTemplate: "ပြည်နယ်တစ်ခုလုံး（{n} ခု）",
    newsGroupMuniLabel: "မြို့နယ်အလိုက်",
    newsEmptyNoData: "သတင်းဒေတာ ဖွင့်၍ မရပါ။",
    newsEmptyNoReport: "ဤအချိန်နှင့် ကိုက်ညီသော အစီရင်ခံစာ မရှိပါ။",
    newsEmptyNoMatch: "ဤအချိန်・အမျိုးအစားနှင့် ကိုက်ညီသော သတင်း မရှိပါ။",
    newsEmptyNoneAtPoint: "ဤအချိန်အတွက် သတင်း မရှိပါ။",
    newsMarkerAriaLabelTemplate: "{muni}: သတင်း {n} ခု",
    newsTranslationNotice: "သတင်းများသည် တရားဝင် ရင်းမြစ်များမှ ဂျပန် မူရင်း အတိုင်း ကိုးကားထားခြင်း ဖြစ်သည်။",

    catLifeline: "အသက်မွေးမြစ် ဝန်ဆောင်မှု",
    catTransport: "သယ်ယူပို့ဆောင်ရေး",
    catMedical: "ဆေးဘက်ဆိုင်ရာ・လူမှုဖူလုံရေး",
    catDaily: "နေ့စဉ်ဘဝ・အုပ်ချုပ်ရေး",
    catIndustry: "စက်မှုလုပ်ငန်း",

    metricEvacueesLabel: "ဘေးရှောင်သူ အရေအတွက်", metricEvacueesUnit: " ဦး",
    metricSheltersLabel: "ခိုလှုံရာစခန်း အရေအတွက်", metricSheltersUnit: " ခု",
    metricDeathsLabel: "သေဆုံးသူ အရေအတွက်", metricDeathsUnit: " ဦး",
    metricInjuredLabel: "ဒဏ်ရာရသူ အရေအတွက်", metricInjuredUnit: " ဦး",
    metricHousesLabel: "အိမ် ပျက်စီးမှု", metricHousesUnit: " လုံး",
    metricWaterOutageLabel: "ရေမရသော အိမ်ထောင်စု", metricWaterOutageUnit: " အိမ်ထောင်စု",
    metricWaterStationsLabel: "ရေဖြန့်ချီရာစခန်း အရေအတွက်", metricWaterStationsUnit: " ခု",
    metricPowerOutageLabel: "မီးမရသော အိမ်ထောင်စု", metricPowerOutageUnit: " အိမ်ထောင်စု",

    eventMetaTemplate: "M{m}・အများဆုံး ရှိစ်ဒိုအဆင့် {shindo}・{date} တွင် ဖြစ်ပွား・{epicenter}（အနက် {depth}km）",
  },
};

/* ===========================================================
   エンジン（t / setLang / formatDateTime 等）
   =========================================================== */

let _currentLang = I18N_DEFAULT_LANG;
const _listeners = [];

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m));
}

// ja が唯一の正。他言語でキーが欠けていた場合だけ ja へフォールバックする
// （現状は全言語ぶん埋めてあるので、フォールバックは発生しない想定）
function t(key, vars) {
  const table = STRINGS[_currentLang] || STRINGS[I18N_DEFAULT_LANG];
  const raw = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : STRINGS[I18N_DEFAULT_LANG][key];
  if (raw === undefined) return key; // 未知キー（実装ミス）はキー名をそのまま出して気づけるようにする
  return interpolate(raw, vars);
}

function getLang() {
  return _currentLang;
}

function isValidLangCode(code) {
  return I18N_LANGS.some((l) => l.code === code);
}

function readInitialLang() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("lang");
    if (fromUrl && isValidLangCode(fromUrl)) return fromUrl;
  } catch (e) {
    /* URLSearchParams非対応・SSR等は無視してlocalStorageへフォールバック */
  }
  try {
    // 言語別静的ページ（/en/ 等）はビルド時に page-lang メタを持つ。
    // URLが言語を宣言している場合は localStorage の記憶より優先する
    const pageLangMeta = document.querySelector('meta[name="page-lang"]');
    const pageLang = pageLangMeta && pageLangMeta.getAttribute("content");
    if (pageLang && isValidLangCode(pageLang)) return pageLang;
  } catch (e) {
    /* document不可（Node実行時等）は無視 */
  }
  try {
    const stored = window.localStorage.getItem(I18N_STORAGE_KEY);
    if (stored && isValidLangCode(stored)) return stored;
  } catch (e) {
    /* localStorage不可（プライベートモード等）でも起動は継続する */
  }
  return I18N_DEFAULT_LANG;
}

function persistLang(code) {
  try {
    window.localStorage.setItem(I18N_STORAGE_KEY, code);
  } catch (e) {
    /* 保存できなくても致命的ではないので無視 */
  }
}

function setLang(code, opts) {
  if (!isValidLangCode(code)) code = I18N_DEFAULT_LANG;
  const changed = code !== _currentLang;
  _currentLang = code;
  if (typeof document !== "undefined" && document.documentElement) {
    // easy-ja / pt-BR はHTML lang属性としては ja / pt を使う（BCP47の主タグ）
    document.documentElement.lang = code === "easy-ja" ? "ja" : code.split("-")[0];
  }
  if (!opts || opts.persist !== false) persistLang(code);
  if (changed || (opts && opts.force)) {
    _listeners.forEach((cb) => {
      try {
        cb(code);
      } catch (e) {
        console.error(e);
      }
    });
  }
}

function onChange(cb) {
  _listeners.push(cb);
}

function init() {
  setLang(readInitialLang(), { persist: false, force: true });
}

/* ===========================================================
   日時フォーマット（Asia/Tokyo固定の文字列を直接解釈する。
   タイムゾーン変換に伴う誤差を避けるため Date のローカル変換は使わない）
   =========================================================== */

function parseJST(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

function weekdayIndex(y, mo, d) {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function weekdayName(y, mo, d, lang) {
  const table = WEEKDAY_NAMES[lang] || WEEKDAY_NAMES[I18N_DEFAULT_LANG];
  return table[weekdayIndex(y, mo, d)];
}

// 日本語・やさしい日本語・中国語・韓国語は元号圏の慣用表記（月/日＋曜日＋時点系の助詞）、
// それ以外は月日を数字表記＋「as of」に相当する語で統一する（月名の翻訳テーブルを
// 増やさず、実装の堅牢性と保守性を優先した判断）
function formatDateTimeForLang(iso, lang) {
  const p = parseJST(iso);
  const wd = weekdayName(p.y, p.mo, p.d, lang);
  const hm = `${pad2(p.h)}:${pad2(p.mi)}`;
  const mmdd = `${pad2(p.mo)}/${pad2(p.d)}`;

  switch (lang) {
    case "ja":
    case "easy-ja":
      return `${p.mo}月${p.d}日（${wd}）${hm}時点`;
    case "zh":
      return `${p.mo}月${p.d}日（${wd}）${hm} 时点`;
    case "ko":
      return `${p.mo}월${p.d}일(${wd}) ${hm} 시점`;
    case "vi":
      return `Tính đến ${mmdd} (${wd}) ${hm}`;
    case "fil":
      return `Bilang ng ${mmdd} (${wd}) ${hm}`;
    case "ne":
      return `${mmdd} (${wd}) ${hm} सम्म`;
    case "pt-BR":
      return `Em ${mmdd} (${wd}) ${hm}`;
    case "id":
      return `Per ${mmdd} (${wd}) ${hm}`;
    case "my":
      return `${mmdd} (${wd}) ${hm} အချိန်အထိ`;
    case "en":
    default:
      return `As of ${mmdd} (${wd}) ${hm}`;
  }
}

function formatDateTime(iso) {
  return formatDateTimeForLang(iso, _currentLang);
}

// 地震発生日時（ヘッダーの「M{m}・最大震度{shindo}・{date}発生・…」用）。
// 「時点」「as of」に相当する語を含まない、年月日時刻だけの素の表記。
// 曜日を含む formatDateTimeForLang とは文脈が異なる（「発生」に続く名詞句）ため別関数にする
function formatOriginDateTime(iso, lang) {
  const p = parseJST(iso);
  const hm = `${pad2(p.h)}:${pad2(p.mi)}`;
  switch (lang) {
    case "ja":
    case "easy-ja":
    case "zh":
      return `${p.y}年${p.mo}月${p.d}日${hm}`;
    case "ko":
      return `${p.y}년${p.mo}월${p.d}일 ${hm}`;
    default:
      return `${p.y}/${pad2(p.mo)}/${pad2(p.d)} ${hm}`;
  }
}

function formatEventOrigin(iso) {
  return formatOriginDateTime(iso, _currentLang);
}

/* ===========================================================
   公開API
   =========================================================== */

const I18N = {
  LANGS: I18N_LANGS,
  DEFAULT_LANG: I18N_DEFAULT_LANG,
  t,
  getLang,
  setLang,
  onChange,
  init,
  formatDateTime,
  formatDateTimeForLang,
  formatEventOrigin,
  muniName,
  prefName,
  // テスト・デバッグ用に生データも公開する（app.js からは基本 t()/formatDateTime() 経由で使う）
  _STRINGS: STRINGS,
  _MUNI_ROMAJI: MUNI_ROMAJI,
  _PREF_ROMAJI: PREF_ROMAJI,
  _WEEKDAY_NAMES: WEEKDAY_NAMES,
};

if (typeof window !== "undefined") window.I18N = I18N;
if (typeof module !== "undefined" && module.exports) module.exports = I18N;
