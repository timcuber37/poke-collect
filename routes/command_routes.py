from flask import Blueprint, request, redirect, url_for, render_template
from commands.handlers import (
    handle_add_card,
    handle_add_from_search,
    handle_remove_card,
    handle_list_for_trade,
    handle_complete_trade,
)
from commands.mysql_writer import get_users, get_all_cards, get_open_listings
import auth

command_bp = Blueprint("commands", __name__)


@command_bp.route("/commands", methods=["GET"])
def commands_page():
    return render_template(
        "commands.html",
        users=get_users(),
        cards=get_all_cards(),
        listings=get_open_listings(),
    )


@command_bp.route("/commands/add-card", methods=["POST"])
def add_card():
    user_id = request.form["user_id"]
    handle_add_card(user_id, request.form["card_id"], request.form.get("condition", "Near Mint"))
    return redirect(url_for("commands.commands_page"))


@command_bp.route("/commands/list-for-trade", methods=["POST"])
def list_for_trade():
    user_id = request.form["user_id"]
    handle_list_for_trade(user_id, request.form["collection_id"])
    return redirect(url_for("commands.commands_page"))


@command_bp.route("/commands/complete-trade", methods=["POST"])
def complete_trade():
    handle_complete_trade(
        initiator_id      = request.form["initiator_id"],
        receiver_id       = request.form["receiver_id"],
        initiator_listing = request.form["initiator_listing"],
        receiver_listing  = request.form["receiver_listing"],
    )
    return redirect(url_for("queries.trades"))


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
