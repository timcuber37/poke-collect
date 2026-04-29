from flask import session
from commands.mysql_writer import get_users


def current_user_id() -> str | None:
    return session.get("user_id")


def current_user() -> dict | None:
    uid = current_user_id()
    if not uid:
        return None
    for u in get_users():
        if u["user_id"] == uid:
            return u
    return None


def login(user_id: str) -> None:
    session["user_id"] = user_id


def logout() -> None:
    session.pop("user_id", None)
