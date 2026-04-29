import os
import re
from flask import Blueprint, request, send_file, abort
from api.pokewallet import get_card_image_bytes

image_bp = Blueprint("images", __name__)

# Local file cache so we only hit the PokéWallet API once per card image
CACHE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "static", "cards",
)
os.makedirs(CACHE_DIR, exist_ok=True)

# PokéWallet IDs are pk_<hex> or just <hex>; reject anything outside that shape
SAFE_ID = re.compile(r"^[a-zA-Z0-9_]+$")


@image_bp.route("/card-image/<card_id>")
def card_image(card_id: str):
    if not SAFE_ID.match(card_id):
        abort(400)

    size = request.args.get("size", "low")
    if size not in ("low", "high"):
        size = "low"

    cached_path = os.path.join(CACHE_DIR, f"{card_id}_{size}.jpg")

    if not os.path.exists(cached_path):
        image_bytes = get_card_image_bytes(card_id, size)
        if not image_bytes:
            abort(404)
        with open(cached_path, "wb") as f:
            f.write(image_bytes)

    return send_file(cached_path, mimetype="image/jpeg", max_age=86400)
