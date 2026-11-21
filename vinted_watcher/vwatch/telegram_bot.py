"""Notifications et commandes Telegram (API Bot HTTP, sans dépendance externe)."""

from __future__ import annotations

import html
import logging
import threading
import time
from typing import Callable

import requests

from .config import TelegramConfig
from .models import Item

log = logging.getLogger(__name__)

Button = tuple[str, str]  # (texte, callback_data)


def esc(text: object) -> str:
    return html.escape(str(text), quote=False)


def format_item(item: Item, search_name: str, extra: str = "") -> str:
    lines = [f"🆕 <b>{esc(item.title)}</b>"]
    price = f"{item.price:.2f} {esc(item.currency)}"
    if item.total_price and abs(item.total_price - item.price) > 0.005:
        price += f" (≈ {item.total_price:.2f} avec protection, hors port)"
    lines.append(f"💶 {price}")
    details = [x for x in (item.brand, item.size and f"Taille {item.size}", item.status) if x]
    if details:
        lines.append("🏷 " + esc(" · ".join(details)))
    if item.seller_login:
        lines.append(f"👤 {esc(item.seller_login)}"
                     + (f" ({esc(item.country_code)})" if item.country_code else ""))
    lines.append(f"🔎 {esc(search_name)}")
    lines.append(f'🔗 <a href="{esc(item.url)}">Ouvrir dans Vinted</a>')
    if extra:
        lines.append(extra)
    return "\n".join(lines)


class TelegramNotifier:
    def __init__(self, cfg: TelegramConfig, session: requests.Session | None = None):
        self.cfg = cfg
        self.enabled = cfg.enabled and bool(cfg.token and cfg.chat_id)
        if cfg.enabled and not self.enabled:
            log.warning("Telegram activé mais TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID manquants.")
        self.api = f"https://api.telegram.org/bot{cfg.token}/"
        self.http = session or requests.Session()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ------------------------------------------------------------ bas niveau
    def _call(self, method: str, http_timeout: float = 20, **payload) -> dict | None:
        if not self.enabled:
            return None
        for attempt in range(3):
            try:
                resp = self.http.post(self.api + method, json=payload, timeout=http_timeout)
                data = resp.json()
            except (requests.RequestException, ValueError) as exc:
                log.warning("Telegram %s : erreur réseau (%s)", method, exc)
                time.sleep(2 * (attempt + 1))
                continue
            if data.get("ok"):
                return data.get("result")
            retry = (data.get("parameters") or {}).get("retry_after")
            if retry:
                time.sleep(min(int(retry), 60))
                continue
            log.warning("Telegram %s refusé : %s", method, data.get("description"))
            return None
        return None

    @staticmethod
    def _keyboard(buttons: list[list[Button]] | None) -> dict | None:
        if not buttons:
            return None
        return {"inline_keyboard": [
            [{"text": t, "callback_data": d} for t, d in row] for row in buttons
        ]}

    # ------------------------------------------------------------ envoi
    def send(self, text: str, buttons: list[list[Button]] | None = None,
             silent: bool = False) -> dict | None:
        payload = dict(chat_id=self.cfg.chat_id, text=text, parse_mode="HTML",
                       disable_web_page_preview=True, disable_notification=silent)
        kb = self._keyboard(buttons)
        if kb:
            payload["reply_markup"] = kb
        return self._call("sendMessage", **payload)

    def send_item(self, item: Item, search_name: str,
                  buttons: list[list[Button]] | None = None, extra: str = "") -> dict | None:
        caption = format_item(item, search_name, extra)
        kb = self._keyboard(buttons)
        if item.photo_url:
            payload = dict(chat_id=self.cfg.chat_id, photo=item.photo_url,
                           caption=caption[:1024], parse_mode="HTML")
            if kb:
                payload["reply_markup"] = kb
            result = self._call("sendPhoto", **payload)
            if result:
                return result
        return self.send(caption, buttons)

    def edit_buttons(self, chat_id: int | str, message_id: int,
                     buttons: list[list[Button]] | None) -> None:
        self._call("editMessageReplyMarkup", chat_id=chat_id, message_id=message_id,
                   reply_markup=self._keyboard(buttons) or {"inline_keyboard": []})

    def answer_callback(self, callback_id: str, text: str = "") -> None:
        self._call("answerCallbackQuery", callback_query_id=callback_id, text=text[:200])

    # ------------------------------------------------------------ écoute
    def start_listening(
        self,
        on_command: Callable[[str, list[str]], None],
        on_callback: Callable[[dict], None],
        get_offset: Callable[[], int],
        set_offset: Callable[[int], None],
    ) -> None:
        if not (self.enabled and self.cfg.listen_commands):
            return

        def loop():
            log.info("Écoute des commandes Telegram démarrée.")
            while not self._stop.is_set():
                # Long polling : Telegram garde la connexion ouverte 30 s max.
                updates = self._call(
                    "getUpdates", http_timeout=40, timeout=30, offset=get_offset(),
                    allowed_updates=["message", "callback_query"],
                )
                if updates is None:
                    self._stop.wait(5)
                    continue
                for upd in updates:
                    set_offset(upd["update_id"] + 1)
                    try:
                        self._dispatch(upd, on_command, on_callback)
                    except Exception:  # une commande ratée ne doit pas tuer le bot
                        log.exception("Erreur lors du traitement d'une mise à jour Telegram")

        self._thread = threading.Thread(target=loop, name="telegram", daemon=True)
        self._thread.start()

    def _authorized(self, chat_id: object) -> bool:
        return str(chat_id) == str(self.cfg.chat_id)

    def _dispatch(self, upd: dict, on_command, on_callback) -> None:
        if "callback_query" in upd:
            cq = upd["callback_query"]
            chat = (cq.get("message") or {}).get("chat", {}).get("id")
            if not self._authorized(chat):
                log.warning("Callback ignoré depuis un chat non autorisé (%s)", chat)
                return
            on_callback(cq)
        elif "message" in upd:
            msg = upd["message"]
            if not self._authorized(msg.get("chat", {}).get("id")):
                log.warning("Message ignoré depuis un chat non autorisé (%s)",
                            msg.get("chat", {}).get("id"))
                return
            text = (msg.get("text") or "").strip()
            if text.startswith("/"):
                parts = text.split()
                cmd = parts[0][1:].split("@")[0].lower()
                on_command(cmd, parts[1:])

    def stop(self) -> None:
        self._stop.set()
