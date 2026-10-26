"""flight-places-build: one-off/occasional job that builds the destination list.

Downloads Travelpayouts' public data (zh-CN city + country names, airports, routes), keeps cities
with a flightable airport, converts names to Traditional Chinese (char table + Taiwan overrides),
scores popularity by route count, flags direct routes from Taiwan, and writes
s3://$CONFIG_BUCKET/places/places.json. Re-run any time to refresh."""
import gzip, json, os, urllib.request
import boto3

BUCKET = os.environ.get("CONFIG_BUCKET", "flight-config-656923393380")
UA = {"User-Agent": "Mozilla/5.0 (compatible; flight-notifier/1.0)", "Accept-Encoding": "gzip"}
TW_AIRPORTS = {"TPE", "TSA", "KHH", "RMQ"}
ST = json.load(open(os.path.join(os.path.dirname(__file__), "st_chars.json"), encoding="utf-8"))
# Names Taiwan writes differently from a straight Simplified->Traditional conversion.
CITY_FIX = {"SYD": "雪梨", "DXB": "杜拜", "IST": "伊斯坦堡", "PER": "伯斯", "ADL": "阿德雷德", "DPS": "峇里島",
            "ROR": "帛琉", "GUM": "關島", "CXR": "芽莊", "OKA": "沖繩", "TPE": "台北", "RMQ": "台中", "KHH": "高雄",
            "SPN": "塞班", "AKL": "奧克蘭", "CHC": "基督城", "BNE": "布里斯本", "CNS": "凱恩斯", "OOL": "黃金海岸",
            "MLE": "馬列（馬爾地夫）", "JHB": "新山", "PEN": "檳城", "KUL": "吉隆坡", "SGN": "胡志明市", "HAN": "河內",
            "REP": "暹粒", "PNH": "金邊", "RGN": "仰光", "KTM": "加德滿都", "NAN": "楠迪", "HNL": "檀香山",
            "SEA": "西雅圖", "YVR": "溫哥華", "SFO": "舊金山", "LAX": "洛杉磯", "NYC": "紐約"}
COUNTRY_FIX = {"NZ": "紐西蘭", "AU": "澳洲", "IT": "義大利", "SA": "沙烏地阿拉伯", "AE": "阿拉伯聯合大公國",
               "LA": "寮國", "BN": "汶萊", "MV": "馬爾地夫", "KP": "北韓", "KR": "韓國", "ID": "印尼",
               "HR": "克羅埃西亞", "TW": "台灣", "PW": "帛琉", "GU": "關島", "MP": "北馬里亞納群島",
               "SG": "新加坡", "MY": "馬來西亞", "CZ": "捷克", "RS": "塞爾維亞", "KE": "肯亞", "TZ": "坦尚尼亞",
               "QA": "卡達", "YE": "葉門", "CY": "賽普勒斯", "GE": "喬治亞", "BA": "波士尼亞與赫塞哥維納",
               "MK": "北馬其頓", "SI": "斯洛維尼亞", "MT": "馬爾他", "NG": "奈及利亞", "SN": "塞內加爾",
               "ZW": "辛巴威", "ZM": "尚比亞", "BZ": "貝里斯", "GT": "瓜地馬拉", "HN": "宏都拉斯", "CR": "哥斯大黎加",
               "MX": "墨西哥", "PE": "秘魯", "CL": "智利", "AR": "阿根廷", "BR": "巴西", "FJ": "斐濟", "TO": "東加",
               "VU": "萬那杜", "PG": "巴布亞紐幾內亞", "SB": "索羅門群島", "MH": "馬紹爾群島", "FM": "密克羅尼西亞"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        b = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            b = gzip.decompress(b)
    return json.loads(b)


def tw(s):
    return "".join(ST.get(ch, ch) for ch in s or "")


def handler(e, c):
    base = "https://api.travelpayouts.com/data/"
    cities = get(base + "zh-CN/cities.json")
    countries = {x["code"]: x for x in get(base + "zh-CN/countries.json")}
    airports = get(base + "en/airports.json")
    routes = get(base + "routes.json")
    a2c = {a["code"]: a.get("city_code") for a in airports if a.get("flightable")}
    weight, direct = {}, set()
    for r in routes:
        dc = a2c.get(r.get("arrival_airport_iata"))
        if not dc:
            continue
        weight[dc] = weight.get(dc, 0) + 1
        if r.get("departure_airport_iata") in TW_AIRPORTS and not r.get("codeshare"):
            direct.add(dc)
    out = []
    for x in cities:
        if not x.get("has_flightable_airport"):
            continue
        code = x["code"]
        en = (x.get("name_translations") or {}).get("en") or ""
        zh = CITY_FIX.get(code) or tw(x.get("name")) or en
        cc = x.get("country_code") or ""
        cz = COUNTRY_FIX.get(cc) or tw((countries.get(cc) or {}).get("name")) or cc
        out.append({"c": code, "n": zh, "e": en, "k": cc, "cn": cz, "w": weight.get(code, 0), "d": code in direct})
    out.sort(key=lambda p: (-p["d"], -p["w"], p["e"]))
    body = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode()
    boto3.client("s3").put_object(Bucket=BUCKET, Key="places/places.json", Body=body, ContentType="application/json")
    top = [f'{p["c"]} {p["n"]}' for p in out[:15]]
    print("places", len(out), "direct", sum(p["d"] for p in out), "bytes", len(body))
    return {"ok": True, "count": len(out), "direct_from_tw": sum(p["d"] for p in out), "bytes": len(body), "top": top}
