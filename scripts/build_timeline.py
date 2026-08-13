#!/usr/bin/env python3
"""県・内閣府のパース結果と座標をマージして web/data/ を生成する。"""
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JST = timezone(timedelta(hours=9))

# 地震調査研究推進本部 評価文書より（北緯32度34分・東経130度42分）
EPICENTER_LATLNG = [round(32 + 34 / 60, 3), round(130 + 42 / 60, 3)]


def load(name):
    with open(ROOT / "data" / name, encoding="utf-8") as f:
        return json.load(f)


def parse_dt(s):
    return datetime.fromisoformat(s)


def load_optional(name):
    path = ROOT / "data" / name
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def housing_started_by_muni(housing, dt):
    """その時点までに着手済みの建設型応急住宅の戸数を市町村ごとに合算する。

    「8月18日（予定）」のように着手予定の団地は、着手が確認できるまで
    数えない（予定日を過ぎても県の資料が「予定」のままのことがあるため）。
    団地が1つでも載っている市町村だけをキーに持たせ、未着手の市町村は
    0 として明示する（キー自体が無いと「未報告」と区別できない）。
    """
    result = {}
    for h in housing or []:
        muni = h.get("muni")
        if not muni:
            continue
        result.setdefault(muni, 0)
        if h.get("start_planned") or not h.get("start_date") or h.get("units") is None:
            continue
        if h["start_date"] <= dt.date().isoformat():
            result[muni] += h["units"]
    return result


def main():
    pref = load("pref_snapshots.json")
    bousai = load("bousai_snapshots.json")
    munis = load("municipalities.json")
    support = load_optional("support_sites.json")

    bsnaps = sorted(bousai["snapshots"], key=lambda s: s["datetime"])

    def nearest_bousai(dt):
        best = None
        for b in bsnaps:
            diff = abs((parse_dt(b["datetime"]) - dt).total_seconds())
            if best is None or diff < best[0]:
                best = (diff, b)
        return best[1] if best and best[0] <= 12 * 3600 else None

    unknown = set()
    snapshots = []
    for p in sorted(pref["snapshots"], key=lambda s: s["datetime"]):
        dt = parse_dt(p["datetime"])
        m = {k: dict(v) for k, v in p["municipalities"].items()}
        sources = [{"name": p["source_name"], "url": p["source_url"]}]

        b = nearest_bousai(dt)
        if b:
            sources.append({"name": b["source_name"], "url": b["source_url"]})
            for name, w in (b.get("water_outage") or {}).items():
                if name in m:
                    m[name]["water_period"] = w.get("period")
                    m[name]["water_note"] = w.get("note")
                    m[name]["water_outage_max"] = w.get("max")
                    # 県資料の断水欄が未報告(null)の間は内閣府報の現在戸数で補完する。
                    # 出典が県資料と異なるため water_outage_source で区別できるようにする
                    # （フロント側は補完値を合算に混ぜず、地図表示と注記のみに使う）
                    if m[name].get("water_outage") is None and w.get("current") is not None:
                        m[name]["water_outage"] = w.get("current")
                        m[name]["water_outage_source"] = "内閣府"
                elif name in munis:
                    m[name] = {
                        "water_outage": w.get("current"),
                        "water_outage_max": w.get("max"),
                        "water_period": w.get("period"),
                        "water_note": w.get("note"),
                    }
                else:
                    unknown.add(name)

        # 建設型応急住宅は県の別ページ（進捗状況）が出典で、報ごとの数値では
        # ないため、着手日から各時点の着工済み戸数を組み立てて重ねる
        for name, units in housing_started_by_muni(support and support.get("housing"), dt).items():
            if name in munis:
                m.setdefault(name, {})["housing_started"] = units
            else:
                unknown.add(name)

        t = p.get("totals") or {}

        def total_of(keys):
            vals = [t.get(k) for k in keys]
            known = [v for v in vals if v is not None]
            return sum(known) if known else None

        summary = {
            "shelters": t.get("shelters"),
            "evacuees": t.get("evacuees"),
            "deaths": t.get("deaths"),
            "injured": total_of(("injured_light", "injured_moderate", "injured_severe")),
            "houses": total_of(
                ("houses_full", "houses_large_half", "houses_half", "houses_partial", "houses_unclassified")
            ),
            "water_outage": t.get("water_outage"),
        }
        snapshots.append(
            {
                "id": p["id"],
                "datetime": p["datetime"],
                "sources": sources,
                "summary": summary,
                "extras": p.get("extras") or {},
                "municipalities": m,
            }
        )

    # 県が資料を出さない日（8/12など）は内閣府報だけの時点を足す。
    # 何も足さないとその日の報がスライダーのどこにも対応せず、
    # ニュースマップから丸ごと読めなくなるため。
    # 内閣府報には市町村別の断水しかないので、市町村別の内訳は断水だけ、
    # 県合計は避難所・避難者・断水だけを載せ、他は未報告(null)のままにする。
    # 由来の違いは bousai_only で区別し、UI側で「内閣府報のみの時点」と明示する
    pref_dts = [parse_dt(p["datetime"]) for p in pref["snapshots"]]
    for b in bsnaps:
        dt = parse_dt(b["datetime"])
        if any(abs((dt - pd).total_seconds()) <= 12 * 3600 for pd in pref_dts):
            continue

        m = {}
        for name, w in (b.get("water_outage") or {}).items():
            if name in munis:
                m[name] = {
                    "water_outage": w.get("current"),
                    "water_outage_source": "内閣府",
                    "water_outage_max": w.get("max"),
                    "water_period": w.get("period"),
                    "water_note": w.get("note"),
                }
            else:
                unknown.add(name)
        for name, units in housing_started_by_muni(support and support.get("housing"), dt).items():
            if name in munis:
                m.setdefault(name, {})["housing_started"] = units

        bs = b.get("summary") or {}
        snapshots.append(
            {
                "id": b["id"],
                "datetime": b["datetime"],
                "bousai_only": True,
                "sources": [{"name": b["source_name"], "url": b["source_url"]}],
                "summary": {
                    "shelters": bs.get("shelters"),
                    "evacuees": bs.get("evacuees"),
                    "deaths": None,
                    "injured": None,
                    "houses": None,
                    "water_outage": (b.get("water_outage_total") or {}).get("current"),
                },
                "extras": {},
                "municipalities": m,
            }
        )

    snapshots.sort(key=lambda s: s["datetime"])

    quake = bousai.get("quake") or {}
    timeline = {
        "event": {
            "name": "令和8年熊本地震",
            "origin": quake.get("origin", "2026-07-28T16:27:00+09:00"),
            "epicenter": quake.get("epicenter", "熊本県熊本地方"),
            "depth_km": quake.get("depth_km", 16),
            "magnitude": quake.get("magnitude", 7.1),
            "max_shindo": "7",
            "epicenter_latlng": EPICENTER_LATLNG,
            "shindo": quake.get("shindo"),
        },
        "updated": datetime.now(JST).isoformat(timespec="seconds"),
        "snapshots": snapshots,
    }

    out = ROOT / "web" / "data"
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "timeline.json", "w", encoding="utf-8") as f:
        json.dump(timeline, f, ensure_ascii=False, separators=(",", ":"))
    with open(out / "municipalities.json", "w", encoding="utf-8") as f:
        json.dump(munis, f, ensure_ascii=False, separators=(",", ":"))

    # 支援拠点は「最新の一覧で上書きされる」情報で時点スライダーに連動しない。
    # 生成物はそのまま web/data/support.json に置き、フロント側は読み込みに
    # 失敗しても他のモードに影響しないよう個別にtry/catchする
    if support:
        with open(out / "support.json", "w", encoding="utf-8") as f:
            json.dump(support, f, ensure_ascii=False, separators=(",", ":"))
        by_type = {}
        for s in support["sites"]:
            by_type[s["type"]] = by_type.get(s["type"], 0) + 1
        print(f"support: {len(support['sites'])} sites {by_type}")
    else:
        print("support_sites.json not found; skipped support.json")

    news_path = ROOT / "data" / "news_events.json"
    if news_path.exists():
        with open(news_path, encoding="utf-8") as f:
            ne = json.load(f)
        reports = sorted(ne["reports"], key=lambda r: r["datetime"])

        def nearest_report(dt):
            best = None
            for r in reports:
                diff = abs((parse_dt(r["datetime"]) - dt).total_seconds())
                if best is None or diff < best[0]:
                    best = (diff, r)
            return best[1]["id"] if best and best[0] <= 12 * 3600 else None

        news = {
            "categories": ["ライフライン", "交通", "医療・福祉", "生活・行政", "産業"],
            "reports": reports,
            "snapshot_report": {s["id"]: nearest_report(parse_dt(s["datetime"])) for s in snapshots},
            "events": ne["events"],
        }
        with open(out / "news.json", "w", encoding="utf-8") as f:
            json.dump(news, f, ensure_ascii=False, separators=(",", ":"))
        print(f"news: {len(ne['events'])} events, {len(reports)} reports")
    else:
        print("news_events.json not found; skipped news.json")

    print(f"snapshots: {len(snapshots)}")
    for s in snapshots:
        print(f"  {s['id']}: {len(s['municipalities'])} municipalities, summary={s['summary']}")
    if unknown:
        print(f"WARNING: water rows for municipalities without coordinates: {sorted(unknown)}", file=sys.stderr)


if __name__ == "__main__":
    main()
