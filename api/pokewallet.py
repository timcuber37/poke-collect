"""
PokéWallet API client.
Docs: https://www.pokewallet.io/api-docs
Base URL: https://api.pokewallet.io
"""
import logging
import requests
import config

logger = logging.getLogger(__name__)

BASE_URL = "https://api.pokewallet.io"


def _headers() -> dict:
    return {"X-API-Key": config.POKEWALLET_API_KEY}


def _get(path: str, params: dict = None) -> dict | list | None:
    url = f"{BASE_URL}{path}"
    try:
        resp = requests.get(url, headers=_headers(), params=params, timeout=10)
        if resp.status_code == 404:
            return None
        if resp.status_code == 429:
            logger.warning("PokéWallet rate limit hit: %s", resp.json())
            return None
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        logger.error("PokéWallet API error for %s: %s", path, exc)
        return None


def extract_tcgplayer_price(card_data: dict) -> float | None:
    """
    Pull the lowest TCGPlayer market price from a card response.
    Prefers 'Normal' variant, falls back to the first available variant.
    """
    tcg = card_data.get("tcgplayer") or card_data.get("pricing", {}).get("tcgplayer")
    if not tcg:
        return None

    prices = tcg.get("prices") or tcg.get("variants") or []
    if isinstance(prices, dict):
        prices = list(prices.values())

    normal = next(
        (p for p in prices if str(p.get("sub_type_name", "")).lower() == "normal"), None
    )
    chosen = normal or (prices[0] if prices else None)
    if not chosen:
        return None

    for key in ("market", "mid", "low"):
        val = chosen.get(key)
        if val is not None:
            return float(val)
    return None


def search_cards(query: str, limit: int = 10) -> list[dict]:
    """Search cards by name. Returns list of card objects with pricing."""
    data = _get("/search", params={"q": query, "limit": limit})
    if data is None:
        return []
    return data.get("results") or data.get("cards") or []


def get_card(card_id: str) -> dict | None:
    """Fetch full card details + pricing by PokéWallet card ID."""
    return _get(f"/cards/{card_id}")


def get_live_price(card_name: str) -> float | None:
    """
    Convenience: search by card name and return the best available TCGPlayer price.
    Used by command handlers to enrich events with live market data.
    """
    results = search_cards(card_name, limit=5)
    for card in results:
        if card.get("name", "").lower() == card_name.lower():
            price = extract_tcgplayer_price(card)
            if price is not None:
                return price
    # fall back to first result if exact match not found
    if results:
        return extract_tcgplayer_price(results[0])
    return None


def get_all_sets() -> list[dict]:
    """Fetch all Pokemon sets. Returns list with name, set_code, card_count, release_date."""
    data = _get("/sets")
    if data is None:
        return []
    return data.get("sets") or data.get("results") or []


def get_set_cards(set_code: str, page: int = 1, limit: int = 200) -> dict:
    """
    Fetch a page of cards for a given set code.
    Returns dict with 'cards' list and 'pagination' info.
    """
    data = _get(f"/sets/{set_code}", params={"page": page, "limit": limit})
    return data or {}


def get_card_image_bytes(card_id: str, size: str = "low") -> bytes | None:
    """Fetch raw image bytes for a card. size = 'low' or 'high'. Returns None on failure."""
    try:
        resp = requests.get(
            f"{BASE_URL}/images/{card_id}",
            headers=_headers(),
            params={"size": size},
            timeout=15,
        )
        if resp.status_code == 200:
            return resp.content
        if resp.status_code in (404, 429):
            logger.warning("Image fetch %s: status %d", card_id, resp.status_code)
            return None
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.error("Image fetch error for %s: %s", card_id, exc)
    return None
