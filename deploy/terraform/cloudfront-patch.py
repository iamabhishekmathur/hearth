#!/usr/bin/env python3
"""
Patch the existing hearth-app.xyz CloudFront distribution to route the backend
API + WebSocket paths to the ALB origin, leaving the S3 landing default behavior
untouched. Idempotent: re-running only updates the origin domain/protocol.

Usage:  python3 cloudfront-patch.py <DISTRIBUTION_ID> <ORIGIN_HOST> [http|https]

ORIGIN_HOST is api.hearth-app.xyz (https, via the ALB's ACM cert) in production;
the raw ALB DNS name with `http` is the fallback used before the cert exists.
"""
import subprocess, json, sys

DIST_ID = sys.argv[1]
ORIGIN_HOST = sys.argv[2]
ORIGIN_SCHEME = sys.argv[3] if len(sys.argv) > 3 else "https"
ORIGIN_ID = "alb-hearth-api"

# Managed policies:
CACHE_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"          # CachingDisabled
ORIGIN_ALLVIEWER = "b689b0a8-53d0-40ab-baf2-68738e2966ac"        # AllViewerExceptHostHeader
API_PATHS = ["/api/*", "/ws/*", "/socket.io/*"]


def aws(*args):
    out = subprocess.run(["aws", *args], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"aws {' '.join(args)} failed:\n{out.stderr}")
    return out.stdout


cfg_raw = aws("cloudfront", "get-distribution-config", "--id", DIST_ID)
cfg = json.loads(cfg_raw)
etag = cfg["ETag"]
dc = cfg["DistributionConfig"]

# --- upsert ALB origin ---
# https-only (default): CloudFront -> ALB over TLS via api.hearth-app.xyz, so the
# ALB reports X-Forwarded-Proto: https natively. http-only is the pre-cert fallback.
origin = {
    "Id": ORIGIN_ID,
    "DomainName": ORIGIN_HOST,
    "OriginPath": "",
    "CustomHeaders": {"Quantity": 0},
    "CustomOriginConfig": {
        "HTTPPort": 80,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "http-only" if ORIGIN_SCHEME == "http" else "https-only",
        "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
        "OriginReadTimeout": 60,
        "OriginKeepaliveTimeout": 5,
    },
    "ConnectionAttempts": 3,
    "ConnectionTimeout": 10,
    "OriginShield": {"Enabled": False},
}
origins = [o for o in dc["Origins"]["Items"] if o["Id"] != ORIGIN_ID]
origins.append(origin)
dc["Origins"] = {"Quantity": len(origins), "Items": origins}

# --- upsert cache behaviors for API/WS paths ---
def behavior(path):
    return {
        "PathPattern": path,
        "TargetOriginId": ORIGIN_ID,
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
            "Quantity": 7,
            "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
            "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
        },
        "Compress": False,
        "CachePolicyId": CACHE_DISABLED,
        "OriginRequestPolicyId": ORIGIN_ALLVIEWER,
        "SmoothStreaming": False,
        "FieldLevelEncryptionId": "",
        "LambdaFunctionAssociations": {"Quantity": 0},
        "FunctionAssociations": {"Quantity": 0},
    }

existing = [b for b in dc.get("CacheBehaviors", {}).get("Items", [])
            if b["PathPattern"] not in API_PATHS]
items = [behavior(p) for p in API_PATHS] + existing
dc["CacheBehaviors"] = {"Quantity": len(items), "Items": items}

with open("/tmp/hearth-cf-config.json", "w") as f:
    json.dump(dc, f)

aws("cloudfront", "update-distribution", "--id", DIST_ID,
    "--if-match", etag,
    "--distribution-config", "file:///tmp/hearth-cf-config.json")
print(f"Patched {DIST_ID}: {API_PATHS} -> {ORIGIN_SCHEME}://{ORIGIN_HOST}")
