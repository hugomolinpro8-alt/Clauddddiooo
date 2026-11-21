import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests

from vwatch import filters
from vwatch.buyer import Buyer, GuardRails
from vwatch.client import BlockedError, detect_block, parse_cookie_header
from vwatch.config import (ConfigError, PurchaseConfig, SearchConfig, load_config,
                           parse_vinted_url)
from vwatch.har_tool import analyse
from vwatch.models import Item
from vwatch.storage import Storage

RAW = {
    "id": 123,
    "title": "Veste Carhartt Detroit neuve",
    "price": {"amount": "30.0", "currency_code": "EUR"},
    "total_item_price": {"amount": "32.2", "currency_code": "EUR"},
    "brand_title": "Carhartt",
    "size_title": "M",
    "status": "Neuf avec étiquette",
    "url": "https://www.vinted.fr/items/123-veste",
    "photo": {"url": "https://img/x.jpg", "high_resolution": {"timestamp": 1700000000}},
    "user": {"id": 9, "login": "Bob"},
}


def item(**over):
    raw = {**RAW, **over}
    return Item.from_api(raw, "www.vinted.fr")


def search(**kw):
    return SearchConfig(name=kw.pop("name", "s"), domain="www.vinted.fr", **kw)


# ---------------------------------------------------------------- modèles
def test_item_parsing_dict_and_string_prices():
    it = item()
    assert (it.price, it.total_price, it.currency) == (30.0, 32.2, "EUR")
    assert it.seller_login == "Bob" and it.created_at.year == 2023
    it2 = item(price="12.5", total_item_price=None)
    assert it2.price == 12.5 and it2.total_price == 12.5


# ---------------------------------------------------------------- config
def test_parse_vinted_url():
    domain, p = parse_vinted_url(
        "https://www.vinted.be/catalog?search_text=nike&catalog[]=1206&brand_ids[]=53"
        "&brand_ids[]=54&size_ids[]=207&status_ids[]=6&price_to=50&order=newest_first")
    assert domain == "www.vinted.be"
    assert p == {"search_text": "nike", "catalog_ids": [1206], "brand_ids": [53, 54],
                 "size_ids": [207], "status_ids": [6], "price_max": 50.0}


def test_api_params():
    s = search(search_text="x", brand_ids=[1, 2], price_max=20.0)
    p = s.api_params(20)
    assert p["order"] == "newest_first" and p["brand_ids"] == "1,2" and p["price_to"] == "20"


def _write_cfg(tmp_path, extra=""):
    (tmp_path / "config.yaml").write_text(
        "searches:\n  - name: a\n    search_text: x\n" + extra, encoding="utf-8")
    return tmp_path / "config.yaml"


def test_config_defaults_safe(tmp_path):
    cfg = load_config(_write_cfg(tmp_path), tmp_path / "none.env")
    assert cfg.purchase.mode == "simulation" and not cfg.purchase.auto_buy_enabled


def test_config_rejects_fast_interval(tmp_path):
    with pytest.raises(ConfigError):
        load_config(_write_cfg(tmp_path, "    interval_seconds: 5\n"), tmp_path / "x")


def test_config_real_requires_ack(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text("purchase:\n  mode: real\nsearches:\n  - name: a\n", encoding="utf-8")
    with pytest.raises(ConfigError):
        load_config(p, tmp_path / "x")


def test_config_auto_buy_requires_item_max(tmp_path):
    with pytest.raises(ConfigError):
        load_config(_write_cfg(tmp_path, "    auto_buy: true\n"), tmp_path / "x")


# ---------------------------------------------------------------- filtres
def test_filters_keywords_word_boundary():
    s = search(exclude_keywords=["lot"])
    assert filters.match(item(title="Veste pilote"), s)[0]
    assert not filters.match(item(title="Lot de 3 vestes"), s)[0]


def test_filters_accents_and_include():
    s = search(include_keywords=["etiquette"], include_any=["detroit", "chore"])
    assert not filters.match(item(), s)[0]  # "étiquette" absent du titre
    assert filters.match(item(title="Veste Detroit avec étiquette"), s)[0]


def test_filters_price_country_age():
    assert not filters.match(item(), search(price_max=20))[0]
    assert not filters.match(item(user={"login": "b", "country_code": "DE"}),
                             search(countries=["FR"]))[0]
    assert filters.match(item(), search(countries=["FR"]))[0]  # pays inconnu → gardé
    now = datetime.fromtimestamp(1700000000, tz=timezone.utc) + timedelta(hours=3)
    assert not filters.match(item(), search(max_age_minutes=60), now=now)[0]


# ---------------------------------------------------------------- client
class FakeResp:
    def __init__(self, status, text="{}", ctype="application/json", headers=None):
        self.status_code, self.text = status, text
        self.headers = {"Content-Type": ctype, **(headers or {})}


def test_detect_block():
    assert detect_block(FakeResp(200)) is None
    assert detect_block(FakeResp(401)) is None  # géré comme session expirée
    assert detect_block(FakeResp(429)).status == 429
    b = detect_block(FakeResp(403, "<html>captcha-delivery.com</html>", "text/html"))
    assert "captcha" in b.reason
    assert detect_block(FakeResp(200, "<html></html>", "text/html")) is not None


def test_parse_cookie_header():
    assert parse_cookie_header("a=1; b=x=y; ;c") == {"a": "1", "b": "x=y"}


# ---------------------------------------------------------------- garde-fous
class NullNotifier:
    def __init__(self):
        self.sent = []

    def send(self, text, *a, **k):
        self.sent.append(text)


@pytest.fixture
def store(tmp_path):
    s = Storage(tmp_path / "t.db")
    yield s
    s.close()


def pcfg(**kw):
    base = dict(auto_buy_enabled=True, max_price_per_item=50, daily_budget=60,
                weekly_budget=100, seller_blacklist=["evil"])
    return PurchaseConfig(**{**base, **kw})


def test_guardrails(store):
    g = GuardRails(pcfg(), store)
    s = search(auto_buy=True, auto_buy_max_price=40)
    assert g.check(item(), s, "auto").allowed
    assert not g.check(item(), search(), "auto").allowed               # pas auto_buy
    assert not GuardRails(pcfg(auto_buy_enabled=False), store).check(item(), s, "auto").allowed
    assert not g.check(item(user={"login": "Evil"}), s, "auto").allowed  # liste noire
    assert not g.check(item(total_item_price="45"), s, "auto").allowed   # > max recherche
    assert g.check(item(total_item_price="45"), s, "manual").allowed     # manuel : max global
    assert not g.check(item(total_item_price="55"), s, "manual").allowed


def test_one_auto_buy_per_search_per_day_and_budgets(store):
    notifier = NullNotifier()
    b = Buyer(pcfg(daily_budget=70), store, notifier)
    s = search(auto_buy=True, auto_buy_max_price=40)
    assert b.buy(item(), s, "auto").allowed
    assert "SIMULATION" in notifier.sent[-1]
    d = b.buy(item(id=124), s, "auto")
    assert not d.allowed and "auto-achat" in d.reason
    assert not b.buy(item(), s, "manual").allowed                       # déjà acheté
    assert b.buy(item(id=125), s, "manual").allowed                     # 32.2 + 32.2 ≤ 70
    d = b.buy(item(id=126), s, "manual")
    assert not d.allowed and "budget jour" in d.reason


def test_real_mode_without_flow_never_pays(store):
    b = Buyer(pcfg(mode="real", i_understand_real_money=True), store, NullNotifier())
    d = b.buy(item(), search(auto_buy=True, auto_buy_max_price=40), "auto")
    assert not d.allowed and "non implémenté" in d.reason


# ---------------------------------------------------------------- HAR
def test_har_redaction(tmp_path):
    har = {"log": {"entries": [{
        "request": {"method": "POST",
                    "url": "https://www.vinted.fr/api/v2/transactions/55/checkout",
                    "headers": [{"name": "Cookie", "value": "access_token_web=SECRET"},
                                {"name": "X-CSRF-Token", "value": "CSRFSECRET"}],
                    "postData": {"mimeType": "application/json",
                                 "text": json.dumps({"item_id": 123, "email": "a@b.c",
                                                     "card_token": "tok_SECRET",
                                                     "type": "purchase"})}},
        "response": {"status": 200, "content": {"mimeType": "application/json",
                                                "text": json.dumps({"id": 55,
                                                                    "address": "1 rue"})}},
    }]}}
    p = tmp_path / "a.har"
    p.write_text(json.dumps(har), encoding="utf-8")
    rows = analyse(p)
    dumped = json.dumps(rows)
    assert rows[0]["interesting"]
    for secret in ("SECRET", "a@b.c", "1 rue"):
        assert secret not in dumped
    assert rows[0]["request_body"]["type"] == "purchase"
