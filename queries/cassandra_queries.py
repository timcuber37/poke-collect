from cassandra.cluster import Cluster
from cassandra.policies import DCAwareRoundRobinPolicy
import config

_session = None


def get_session():
    global _session
    if _session is None:
        cluster = Cluster(
            contact_points=config.CASSANDRA_HOSTS,
            port=config.CASSANDRA_PORT,
            load_balancing_policy=DCAwareRoundRobinPolicy(local_dc="datacenter1"),
        )
        _session = cluster.connect(config.CASSANDRA_KEYSPACE)
    return _session


def get_collection_by_user(user_id: str) -> list[dict]:
    rows = get_session().execute(
        "SELECT collection_id, card_id, card_name, set_name, rarity, condition, "
        "market_price_usd, acquired_at "
        "FROM collection_by_user WHERE user_id = %s",
        (user_id,),
    )
    return [
        {
            "collection_id":    r.collection_id,
            "card_id":          r.card_id,
            "card_name":        r.card_name,
            "set_name":         r.set_name,
            "rarity":           r.rarity,
            "condition":        r.condition,
            "market_price_usd": float(r.market_price_usd) if r.market_price_usd is not None else None,
            "acquired_at":      r.acquired_at,
        }
        for r in rows
    ]


def get_trade_history_by_user(user_id: str) -> list[dict]:
    rows = get_session().execute(
        "SELECT trade_id, initiator_id, receiver_id, completed_at "
        "FROM trade_history_by_user WHERE user_id = %s",
        (user_id,),
    )
    return [
        {
            "trade_id":     r.trade_id,
            "initiator_id": r.initiator_id,
            "receiver_id":  r.receiver_id,
            "completed_at": r.completed_at,
        }
        for r in rows
    ]


def get_cards_by_set(set_name: str) -> list[dict]:
    rows = get_session().execute(
        "SELECT card_id, card_name, rarity, card_type, market_price_usd "
        "FROM cards_by_set WHERE set_name = %s",
        (set_name,),
    )
    return [
        {
            "card_id":          r.card_id,
            "card_name":        r.card_name,
            "rarity":           r.rarity,
            "card_type":        r.card_type,
            "market_price_usd": r.market_price_usd,
        }
        for r in rows
    ]


def get_all_set_names() -> list[str]:
    """Return distinct set names currently in cards_by_set (driven by api_sync)."""
    rows = get_session().execute("SELECT DISTINCT set_name FROM cards_by_set")
    return sorted({r.set_name for r in rows})
