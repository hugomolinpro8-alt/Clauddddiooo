"""Analyse d'un fichier HAR exporté des DevTools, avec caviardage des secrets.

Usage : python -m vwatch har capture.har [-o resume.md]

Le résumé produit liste les requêtes API Vinted (méthode, chemin,
paramètres, structure du corps et de la réponse) SANS cookies, jetons,
e-mail, adresse ni données bancaires : tu peux le partager pour que les
endpoints soient identifiés.
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlparse

SENSITIVE_HEADERS = {
    "cookie", "set-cookie", "authorization", "x-csrf-token", "x-anon-id",
    "x-v-udt", "x-datadome-clientid", "proxy-authorization",
}
SENSITIVE_KEY = re.compile(
    r"token|password|passwd|secret|card|iban|bic|cvc|cvv|pan|email|e-mail|phone|"
    r"address|street|city|postal|zip|first_?name|last_?name|full_?name|login|"
    r"session|cookie|fingerprint|device|ip_?addr|birth|signature|nonce",
    re.I,
)
# Valeurs textuelles conservées car utiles pour comprendre le flux.
SAFE_STRING_KEYS = re.compile(
    r"^(type|status|state|code|currency|currency_code|order|kind|method|"
    r"payment_method|shipping_method|delivery_type|action|step|flow|result|"
    r"message_code|provider|brand|channel)$", re.I,
)
INTERESTING = re.compile(
    r"transaction|checkout|purchase|buy|payment|pay|order|offer|shipping|"
    r"pickup|delivery|wallet|conversation", re.I,
)
STATIC = re.compile(r"\.(js|css|png|jpe?g|gif|webp|svg|woff2?|ico|map)(\?|$)", re.I)


def redact(value: Any, key: str = "", depth: int = 0) -> Any:
    if depth > 6:
        return "…"
    if isinstance(value, dict):
        return {k: redact(v, k, depth + 1) for k, v in list(value.items())[:60]}
    if isinstance(value, list):
        out = [redact(v, key, depth + 1) for v in value[:3]]
        if len(value) > 3:
            out.append(f"… (+{len(value) - 3})")
        return out
    if key and SENSITIVE_KEY.search(key):
        return "[CAVIARDÉ]"
    if isinstance(value, str):
        if SAFE_STRING_KEYS.match(key or "") and len(value) <= 40:
            return value
        if re.fullmatch(r"\d{1,12}", value):
            return value  # identifiants numériques (annonce, transaction)
        return f"<texte {len(value)} car.>"
    return value  # nombres, booléens, null


def _parse_body(text: str | None, mime: str = "") -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        if "x-www-form-urlencoded" in mime:
            return dict(parse_qsl(text))
        return f"<corps non JSON, {len(text)} car.>"


def _redact_path(path: str) -> str:
    # Les longues chaînes hexadécimales/UUID dans l'URL peuvent être des jetons.
    return re.sub(r"[0-9a-f]{24,}|[0-9a-f]{8}-[0-9a-f-]{27,}", "<id>", path, flags=re.I)


def analyse(har_path: Path) -> list[dict]:
    with har_path.open(encoding="utf-8") as f:
        har = json.load(f)
    entries = har.get("log", {}).get("entries", [])
    out = []
    for e in entries:
        req, resp = e.get("request", {}), e.get("response", {})
        url = urlparse(req.get("url", ""))
        if "vinted" not in url.netloc or STATIC.search(url.path):
            continue
        if not (url.path.startswith(("/api/", "/web/api/")) or req.get("method") != "GET"):
            continue
        headers = {h["name"].lower(): h["value"] for h in req.get("headers", [])}
        post = req.get("postData") or {}
        content = dict(resp.get("content") or {})
        if content.get("encoding") == "base64" and content.get("text"):
            try:
                content["text"] = base64.b64decode(content["text"]).decode("utf-8", "replace")
            except ValueError:
                content["text"] = None
        out.append({
            "method": req.get("method"),
            "host": url.netloc,
            "path": _redact_path(url.path),
            "query": redact(dict(parse_qsl(url.query))),
            "status": resp.get("status"),
            "interesting": bool(INTERESTING.search(url.path)),
            "headers_present": sorted(
                f"{k}{' [CAVIARDÉ]' if k in SENSITIVE_HEADERS else ''}"
                for k in headers if k.startswith(("x-", "content-type", "authorization"))
            ),
            "request_body": redact(_parse_body(post.get("text"), post.get("mimeType", ""))),
            "response_body": redact(_parse_body(content.get("text"), content.get("mimeType", ""))),
        })
    return out


def to_markdown(rows: list[dict], source: str) -> str:
    lines = [f"# Résumé HAR caviardé — {Path(source).name}", "",
             f"{len(rows)} requêtes API Vinted. Les lignes ⭐ concernent probablement "
             "l'achat/paiement.", "",
             "| # | | Méthode | Chemin | Statut |", "|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        lines.append(f"| {i} | {'⭐' if r['interesting'] else ''} | {r['method']} | "
                     f"`{r['path']}` | {r['status']} |")
    lines.append("")
    for i, r in enumerate(rows, 1):
        lines += [f"## {i}. {r['method']} {r['host']}{r['path']} → {r['status']}"
                  + (" ⭐" if r["interesting"] else ""), ""]
        for label, key in (("Paramètres", "query"), ("Corps envoyé", "request_body"),
                           ("Réponse", "response_body")):
            if r[key]:
                dumped = json.dumps(r[key], ensure_ascii=False, indent=2)
                if len(dumped) > 4000:
                    dumped = dumped[:4000] + "\n… (tronqué)"
                lines += [f"**{label}**", "```json", dumped, "```"]
        if r["headers_present"]:
            lines.append("En-têtes : " + ", ".join(f"`{h}`" for h in r["headers_present"]))
        lines.append("")
    return "\n".join(lines)


def run(har_file: str, output: str | None = None) -> Path | None:
    path = Path(har_file)
    if not path.is_file():
        print(f"Fichier HAR introuvable : {path}")
        return None
    try:
        rows = analyse(path)
    except (ValueError, UnicodeDecodeError) as exc:
        print(f"Fichier HAR illisible ({exc}). Réexporte-le depuis les DevTools.")
        return None
    out = Path(output) if output else Path(har_file).with_suffix(".resume.md")
    out.write_text(to_markdown(rows, har_file), encoding="utf-8")
    starred = sum(r["interesting"] for r in rows)
    print(f"{len(rows)} requêtes API analysées ({starred} liées à l'achat).")
    print(f"Résumé caviardé écrit dans : {out}")
    print("Relis-le avant de le partager ; ne partage JAMAIS le fichier .har brut.")
    return out
