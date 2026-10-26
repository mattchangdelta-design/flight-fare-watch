import hashlib, io, urllib.request, zipfile, boto3
def handler(e, c):
    buf, sums = io.BytesIO(), {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, path in sorted(e["files"].items()):
            url = "https://raw.githubusercontent.com/%s/%s/%s" % (e["repo"], e["ref"], path)
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "flight-pack"}), timeout=15) as r:
                src = r.read()
            sums[name] = hashlib.sha256(src).hexdigest()
            zi = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            zi.external_attr, zi.compress_type = 0o644 << 16, zipfile.ZIP_DEFLATED
            z.writestr(zi, src)
    data = buf.getvalue()
    boto3.client("s3").put_object(Bucket=e["bucket"], Key=e["key"], Body=data, ContentType="application/zip")
    return {"ok": True, "key": e["key"], "bytes": len(data), "md5": hashlib.md5(data).hexdigest(), "sha256": sums}
