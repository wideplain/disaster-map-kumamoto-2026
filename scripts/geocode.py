#!/usr/bin/env python3
import json
import time
import urllib.request
import urllib.parse
import ssl
from pathlib import Path

MUNICIPALITIES = {
    "熊本県": [
        "熊本市", "宇土市", "宇城市", "美里町", "荒尾市", "玉名市", "玉東町",
        "南関町", "長洲町", "和水町", "山鹿市", "菊池市", "合志市", "大津町",
        "菊陽町", "阿蘇市", "南小国町", "小国町", "産山村", "高森町", "西原村",
        "南阿蘇村", "御船町", "嘉島町", "益城町", "甲佐町", "山都町", "八代市",
        "氷川町", "水俣市", "芦北町", "津奈木町", "人吉市", "錦町", "多良木町",
        "湯前町", "水上村", "相良村", "五木村", "山江村", "球磨村", "あさぎり町",
        "上天草市", "天草市", "苓北町"
    ],
    "福岡県": ["柳川市", "大川市"],
    "佐賀県": ["佐賀市", "太良町", "白石町", "神埼市"],
    "長崎県": ["南島原市", "諫早市", "雲仙市"],
    "鹿児島県": ["薩摩川内市", "さつま町", "長島町", "阿久根市", "出水市", "いちき串木野市", "伊佐市", "湧水町"],
    "宮崎県": ["延岡市", "西都市", "椎葉村"]
}

API_BASE = "https://msearch.gsi.go.jp/address-search/AddressSearch"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def geocode_municipality(pref, municipality):
    query = f"{pref}{municipality}"
    encoded_query = urllib.parse.quote(query)
    url = f"{API_BASE}?q={encoded_query}"

    req = urllib.request.Request(url)
    req.add_header("User-Agent", USER_AGENT)

    ssl_context = ssl.create_default_context()

    try:
        with urllib.request.urlopen(req, context=ssl_context, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))

        if not data or not isinstance(data, list) or len(data) == 0:
            return None, data

        best_match = data[0]
        for result in data:
            title = result.get("properties", {}).get("title", "")
            if title.startswith(query):
                best_match = result
                break

        coords = best_match.get("geometry", {}).get("coordinates")
        if coords and len(coords) == 2:
            lng, lat = coords
            return {"lat": round(lat, 5), "lng": round(lng, 5)}, data

        return None, data
    except Exception as e:
        return None, str(e)


def main():
    result = {}
    errors = []

    for pref in sorted(MUNICIPALITIES.keys()):
        municipalities = MUNICIPALITIES[pref]
        for municipality in municipalities:
            coords, api_response = geocode_municipality(pref, municipality)

            if coords:
                result[municipality] = {
                    "pref": pref,
                    "lat": coords["lat"],
                    "lng": coords["lng"]
                }
            else:
                errors.append((pref, municipality, api_response))

            time.sleep(0.5)

    ok = validate(result)
    if errors:
        print("\n【取得失敗の詳細】")
        for pref, municipality, resp in errors:
            print(f"  - {pref}{municipality}: {str(resp)[:200]}")

    # 失敗や範囲外があるときは既存ファイルを上書きしない
    if not ok:
        raise SystemExit("検証に失敗したため municipalities.json は更新しませんでした。")

    output_file = Path(__file__).parent.parent / "data" / "municipalities.json"
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"出力ファイル: {output_file}")


def validate(result):
    LAT_MIN, LAT_MAX = 31.0, 34.5
    LNG_MIN, LNG_MAX = 129.0, 132.5

    total_expected = sum(len(municipalities) for municipalities in MUNICIPALITIES.values())
    total_obtained = len(result)

    failures = []
    out_of_range = []

    for municipality, data in result.items():
        lat = data["lat"]
        lng = data["lng"]

        if not (LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX):
            out_of_range.append((municipality, lat, lng))

    all_municipalities = set()
    for municipalities in MUNICIPALITIES.values():
        all_municipalities.update(municipalities)

    for municipality in all_municipalities:
        if municipality not in result:
            failures.append(municipality)

    print(f"\n========== 検証結果 ==========")
    print(f"期待件数: {total_expected}")
    print(f"取得件数: {total_obtained}")
    print(f"成功件数: {total_obtained - len(out_of_range)}")
    print(f"失敗・範囲外件数: {len(failures) + len(out_of_range)}")

    if failures:
        print(f"\n【失敗した市町村】")
        for municipality in failures:
            print(f"  - {municipality}")

    if out_of_range:
        print(f"\n【範囲外の座標】")
        for municipality, lat, lng in out_of_range:
            print(f"  - {municipality}: lat={lat}, lng={lng}")

    ok = total_expected == total_obtained and not failures and not out_of_range
    if ok:
        print("\n✓ すべての市町村を正常に取得しました。")
    return ok


if __name__ == "__main__":
    main()
