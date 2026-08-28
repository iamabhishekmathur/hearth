#!/usr/bin/env python3
"""
Reverse of cloudfront-patch.py: remove the ALB API/WebSocket behaviors and the
ALB origin from a CloudFront distribution, leaving it as a pure static site.
Used to return the apex (hearth-app.xyz) to marketing-only once the app moved to
its own app.hearth-app.xyz distribution.

Usage:  python3 cloudfront-unpatch.py <DISTRIBUTION_ID>
"""
import subprocess, json, sys

DIST_ID = sys.argv[1]
ORIGIN_ID = "alb-hearth-api"
API_PATHS = {"/api/*", "/ws/*", "/socket.io/*"}


def aws(*args):
    out = subprocess.run(["aws", *args], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"aws {' '.join(args)} failed:\n{out.stderr}")
    return out.stdout


cfg = json.loads(aws("cloudfront", "get-distribution-config", "--id", DIST_ID))
etag = cfg["ETag"]
dc = cfg["DistributionConfig"]

behaviors = [b for b in dc.get("CacheBehaviors", {}).get("Items", [])
             if b["PathPattern"] not in API_PATHS]
dc["CacheBehaviors"] = {"Quantity": len(behaviors), "Items": behaviors}

origins = [o for o in dc["Origins"]["Items"] if o["Id"] != ORIGIN_ID]
dc["Origins"] = {"Quantity": len(origins), "Items": origins}

with open("/tmp/hearth-cf-unpatch.json", "w") as f:
    json.dump(dc, f)

aws("cloudfront", "update-distribution", "--id", DIST_ID,
    "--if-match", etag,
    "--distribution-config", "file:///tmp/hearth-cf-unpatch.json")
print(f"Unpatched {DIST_ID}: removed {sorted(API_PATHS)} + origin {ORIGIN_ID}")
