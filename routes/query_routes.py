from flask import Blueprint, request, render_template, redirect, url_for
from queries.cassandra_queries import (
    get_collection_by_user,
    get_trade_history_by_user,
    get_cards_by_set,
    get_all_set_names,
)
from queries.postgres_search import search_catalog
from commands.mysql_writer   import get_users
import auth

query_bp = Blueprint("queries", __name__)


@query_bp.route("/")
def home():
    query   = request.args.get("q", "").strip()
    results = search_catalog(query) if query else []
    return render_template("home.html", query=query, results=results)


@query_bp.route("/collection")
def collection_view():
    user_id = auth.current_user_id()
    if not user_id:
        return redirect(url_for("queries.home"))
    cards = get_collection_by_user(user_id)
    return render_template("collection.html", cards=cards)


@query_bp.route("/market")
def market():
    sets         = get_all_set_names()
    selected_set = request.args.get("set_name", sets[0] if sets else "")
    cards        = get_cards_by_set(selected_set) if selected_set else []
    return render_template("market.html", sets=sets, selected_set=selected_set, cards=cards)


@query_bp.route("/trades")
def trades():
    users        = get_users()
    selected_uid = request.args.get("user_id", users[0]["user_id"] if users else "")
    trades_list  = get_trade_history_by_user(selected_uid) if selected_uid else []
    return render_template("trades.html", trades=trades_list, users=users, selected_user=selected_uid)
