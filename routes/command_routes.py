from flask import Blueprint, request, redirect, url_for, flash
from commands.handlers import (
    handle_add_from_search,
    handle_remove_card,
)
import auth

command_bp = Blueprint("commands", __name__)


@command_bp.route("/commands/add-from-search", methods=["POST"])
def add_from_search():
    user_id = auth.current_user_id()
    if not user_id:
        return redirect(url_for("queries.home"))

    price_raw = request.form.get("market_price_usd", "").strip()
    market_price = float(price_raw) if price_raw else None

    handle_add_from_search(
        user_id          = user_id,
        pokewallet_id    = request.form["pokewallet_id"],
        card_name        = request.form["card_name"],
        set_name         = request.form["set_name"],
        rarity           = request.form["rarity"],
        card_type        = request.form["card_type"],
        condition        = request.form.get("condition", "Near Mint"),
        market_price_usd = market_price,
    )
    return redirect(request.referrer or url_for("queries.collection_view"))


@command_bp.route("/commands/remove-card", methods=["POST"])
def remove_card():
    user_id = auth.current_user_id()
    if not user_id:
        return redirect(url_for("queries.home"))
    handle_remove_card(user_id, request.form["collection_id"])
    return redirect(url_for("queries.collection_view"))
