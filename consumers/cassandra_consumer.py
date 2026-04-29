"""
Run this as a standalone process: python -m consumers.cassandra_consumer
Continuously pops events from Kafka and writes read models into Cassandra.
"""
import logging
from cassandra.cluster import Cluster
from cassandra.policies import DCAwareRoundRobinPolicy
from event_bus.bus import make_consumer
import config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_cassandra_session():
    cluster = Cluster(
        contact_points=config.CASSANDRA_HOSTS,
        port=config.CASSANDRA_PORT,
        load_balancing_policy=DCAwareRoundRobinPolicy(local_dc="datacenter1"),
    )
    session = cluster.connect(config.CASSANDRA_KEYSPACE)
    return session


def handle_card_added(session, event: dict):
    session.execute(
        """
        INSERT INTO collection_by_user
          (user_id, collection_id, card_id, card_name, set_name, rarity,
           condition, market_price_usd, acquired_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, toTimestamp(now()))
        """,
        (
            event["user_id"], event["collection_id"], event["card_id"],
            event["card_name"], event["set_name"], event["rarity"],
            event["condition"], event.get("market_price_usd"),
        ),
    )
    logger.info("Cassandra: inserted card %s for user %s", event["card_name"], event["user_id"])


def handle_card_removed(session, event: dict):
    session.execute(
        "DELETE FROM collection_by_user WHERE user_id=%s AND collection_id=%s",
        (event["user_id"], event["collection_id"]),
    )
    logger.info("Cassandra: removed card %s for user %s", event["card_name"], event["user_id"])


def handle_card_listed(session, event: dict):
    session.execute(
        """
        INSERT INTO trade_listings_by_user
          (user_id, listing_id, card_id, card_name, collection_id, status, created_at)
        VALUES (%s, %s, %s, %s, %s, 'open', toTimestamp(now()))
        """,
        (
            event["user_id"], event["listing_id"], event["card_id"],
            event["card_name"], event["collection_id"],
        ),
    )
    logger.info("Cassandra: listed card %s for trade", event["card_name"])


def handle_trade_completed(session, event: dict):
    for user_id in (event["initiator_id"], event["receiver_id"]):
        session.execute(
            """
            INSERT INTO trade_history_by_user
              (user_id, trade_id, initiator_id, receiver_id, completed_at)
            VALUES (%s, %s, %s, %s, toTimestamp(now()))
            """,
            (user_id, event["trade_id"], event["initiator_id"], event["receiver_id"]),
        )
    logger.info("Cassandra: recorded trade %s", event["trade_id"])


HANDLERS = {
    "card_added_to_collection":    handle_card_added,
    "card_removed_from_collection": handle_card_removed,
    "card_listed_for_trade":       handle_card_listed,
    "trade_completed":             handle_trade_completed,
}


def run():
    session  = get_cassandra_session()
    consumer = make_consumer(group_id="cassandra-consumer")
    logger.info("Cassandra consumer started, listening on topic '%s'", config.KAFKA_TOPIC)
    for message in consumer:
        event = message.value
        handler = HANDLERS.get(event.get("event_type"))
        if handler:
            try:
                handler(session, event)
            except Exception as exc:
                logger.error("Error processing event %s: %s", event.get("event_type"), exc)


if __name__ == "__main__":
    run()
