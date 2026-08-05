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


def main():
    pref = load("pref_snapshots.json")
    bousai = load("bousai_snapshots.json")
    munis = load("municipalities.json")

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
