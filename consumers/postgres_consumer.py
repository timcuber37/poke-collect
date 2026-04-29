"""
Run this as a standalone process: python -m consumers.postgres_consumer
Pops events from Kafka, embeds card data, and stores vectors in Postgres via pgvector.
"""
import logging
import psycopg2
from sentence_transformers import SentenceTransformer
from event_bus.bus import make_consumer
import config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_model = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def get_pg_conn():
    return psycopg2.connect(config.POSTGRES_DSN)


def embed(text: str) -> list[float]:
    return get_model().encode(text).tolist()


def upsert_card_embedding(conn, event: dict):
    card_text = (
        f"Card: {event['card_name']}. "
        f"Set: {event['set_name']}. "
        f"Rarity: {event['rarity']}. "
        f"Owned by user: {event['user_id']}. "
        f"Condition: {event['condition']}."
    )
    vector = embed(card_text)

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO card_embeddings (card_id, user_id, collection_id, card_name,
                                         set_name, rarity, condition, content, embedding)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (collection_id) DO UPDATE
              SET content   = EXCLUDED.content,
                  embedding = EXCLUDED.embedding
            """,
            (
                event["card_id"], event["user_id"], event["collection_id"],
                event["card_name"], event["set_name"], event["rarity"],
                event["condition"], card_text, vector,
            ),
        )
    conn.commit()
    logger.info("Postgres: upserted embedding for %s", event["card_name"])


def delete_card_embedding(conn, event: dict):
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM card_embeddings WHERE collection_id = %s",
            (event["collection_id"],),
        )
    conn.commit()
    logger.info("Postgres: deleted embedding for collection %s", event["collection_id"])


def run():
    conn     = get_pg_conn()
    consumer = make_consumer(group_id="postgres-consumer")
    logger.info("Postgres consumer started, listening on topic '%s'", config.KAFKA_TOPIC)
    for message in consumer:
        event      = message.value
        event_type = event.get("event_type")
        try:
            if event_type == "card_added_to_collection":
                upsert_card_embedding(conn, event)
            elif event_type == "card_removed_from_collection":
                delete_card_embedding(conn, event)
        except Exception as exc:
            logger.error("Error processing event %s: %s", event_type, exc)
            conn = get_pg_conn()


if __name__ == "__main__":
    run()
