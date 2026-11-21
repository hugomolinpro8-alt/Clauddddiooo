"""Point d'entrée : python -m vwatch <commande>."""

from __future__ import annotations

import argparse
import logging
import logging.handlers
import sys
from pathlib import Path

from .config import AppConfig, ConfigError, load_config


def setup_logging(level: str, log_file: Path | None) -> None:
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s",
                            "%Y-%m-%d %H:%M:%S")
    root = logging.getLogger()
    root.setLevel(level)
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    root.addHandler(console)
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.handlers.RotatingFileHandler(log_file, maxBytes=5_000_000,
                                                  backupCount=5, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    for noisy in ("urllib3", "requests"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def cmd_check(cfg: AppConfig) -> int:
    """Interroge chaque recherche une fois, sans rien enregistrer ni notifier."""
    from . import filters
    from .client import VintedClient, VintedError

    client = VintedClient(cfg.domain, cfg.cookies, cfg.user_agent, cfg.cookies_state_path)
    rc = 0
    for s in cfg.searches:
        if not s.enabled:
            continue
        print(f"\n=== {s.name} ({s.domain}) ===")
        print("Paramètres API :", s.api_params(cfg.per_page))
        try:
            items = client.search(s.api_params(cfg.per_page))
        except VintedError as exc:
            print(f"ERREUR : {exc}")
            rc = 1
            break
        for it in items[:10]:
            ok, why = filters.match(it, s)
            mark = "✔" if ok else "✗"
            print(f" {mark} {it.id} | {it.title[:45]:45} | {it.price:7.2f} {it.currency} "
                  f"| {it.size[:8]:8} | {it.status[:18]:18} {'' if ok else '← ' + why}")
        print(f"{len(items)} annonces reçues (10 premières affichées).")
    return rc


def cmd_test_telegram(cfg: AppConfig) -> int:
    from .telegram_bot import TelegramNotifier

    n = TelegramNotifier(cfg.telegram)
    if not n.enabled:
        print("Telegram non configuré (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID dans .env).")
        return 1
    ok = n.send("✅ Test Vinted Watcher : les notifications fonctionnent.",
                [[("Bouton de test", "noop:0")]])
    print("Message envoyé." if ok else "Échec de l'envoi (voir les logs).")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="vwatch", description="Surveillance Vinted")
    parser.add_argument("-c", "--config", default="config.yaml")
    parser.add_argument("--env", default=None, help="fichier .env (défaut : à côté du config)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run", help="lancer la surveillance")
    sub.add_parser("check", help="tester les recherches une fois (aucune écriture)")
    sub.add_parser("test-telegram", help="envoyer un message de test")
    har = sub.add_parser("har", help="analyser un fichier HAR (caviardé)")
    har.add_argument("file")
    har.add_argument("-o", "--output")
    args = parser.parse_args(argv)

    if args.cmd == "har":
        from .har_tool import run as har_run
        return 0 if har_run(args.file, args.output) else 1

    try:
        cfg = load_config(args.config, args.env)
    except ConfigError as exc:
        print(f"Erreur de configuration : {exc}", file=sys.stderr)
        return 2
    setup_logging(cfg.log_level, cfg.log_file if args.cmd == "run" else None)

    if args.cmd == "check":
        return cmd_check(cfg)
    if args.cmd == "test-telegram":
        return cmd_test_telegram(cfg)

    from .app import App
    from .client import VintedError

    env_path = Path(args.env) if args.env else Path(args.config).resolve().parent / ".env"
    try:
        App(cfg, env_path).run()
    except VintedError as exc:
        logging.getLogger("vwatch").error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
