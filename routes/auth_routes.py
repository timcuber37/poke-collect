from flask import Blueprint, request, redirect, url_for
import auth

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/login/<user_id>", methods=["POST", "GET"])
def login(user_id: str):
    auth.login(user_id)
    return redirect(request.referrer or url_for("queries.home"))


@auth_bp.route("/logout", methods=["POST", "GET"])
def logout():
    auth.logout()
    return redirect(url_for("queries.home"))
