from flask import Blueprint, request, render_template, redirect, url_for
from queries.cassandra_queries import get_collection_by_user
from queries.postgres_search   import search_catalog
from commands.mysql_writer     import get_users
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
