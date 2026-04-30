"""
PokéWallet catalog sync service.
Run as a standalone process: python -m sync.api_sync

Fetches live card + pricing data from the PokéWallet API and writes it
directly to the Cassandra read model (cards_by_set) and Postgres vector
store (catalog_embeddings). This is intentionally a read-side concern —
it never touches MySQL or the Kafka event bus.

Rate limit awareness (Free plan: 100 req/hour):
  - Sleeps SYNC_DELAY_SECONDS between set fetches to stay within limits.
  - Full catalog sync (~850 sets) takes ~10 hours; interval is set accordingly.
"""
import logging
import time

import psycopg2
from cassandra.cluster import Cluster
from cassandra.policies import DCAwareRoundRobinPolicy
from sentence_transformers import SentenceTransformer

import config
from api.pokewallet import get_all_sets, get_set_cards, extract_tcgplayer_price

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SYNC_DELAY_SECONDS    = 40
SYNC_INTERVAL_SECONDS = 43200  # 12 hours — full pass takes ~10 h on free plan

_embed_model = None


def get_embed_model() -> SentenceTransformer:
    global _embed_model
    if _embed_model is None:
        _embed_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embed_model


def get_cassandra_session():
    cluster = Cluster(
        contact_points=config.CASSANDRA_HOSTS,
        port=config.CASSANDRA_PORT,
        load_balancing_policy=DCAwareRoundRobinPolicy(local_dc="datacenter1"),
    )
    return cluster.connect(config.CASSANDRA_KEYSPACE)


def get_pg_conn():
    return psycopg2.connect(config.POSTGRES_DSN)


def clear_catalog_tables(cass_session, pg_conn):
    cass_session.execute("TRUNCATE cards_by_set")
    with pg_conn.cursor() as cur:
        cur.execute("TRUNCATE catalog_embeddings RESTART IDENTITY")
    pg_conn.commit()
    logger.info("Cleared cards_by_set and catalog_embeddings")


def sync_set(cass_session, pg_conn, set_info: dict) -> int:
    """Fetch all cards in one set and write them to Cassandra + Postgres."""
    set_id   = set_info.get("set_id")  # use set_id (numeric) — set_code can be ambiguous
    set_name = set_info.get("name") or str(set_id)
    if not set_id:
        return 0

    page         = 1
    total_synced = 0

    while True:
        data  = get_set_cards(str(set_id), page=page, limit=200)
        cards = data.get("cards") or []
        if not cards:
            break

        for card in cards:
            info      = card.get("card_info") or {}
            card_id   = card.get("id", "")
            card_name = info.get("name") or info.get("clean_name", "")
            rarity    = info.get("rarity") or "Unknown"
            card_type = info.get("card_type") or "Unknown"
            price_usd = extract_tcgplayer_price(card)

            if not card_id or not card_name:
                continue

            cass_session.execute(
                """
                INSERT INTO cards_by_set
                  (set_name, card_id, card_name, rarity, card_type, market_price_usd, pokewallet_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (set_name, card_id, card_name, rarity, card_type, price_usd, card_id),
            )

            if price_usd is not None:
                content = (
                    f"Card: {card_name}. Set: {set_name}. Rarity: {rarity}. "
                    f"Type: {card_type}. TCGPlayer price: ${price_usd:.2f} USD."
                )
            else:
                content = (
                    f"Card: {card_name}. Set: {set_name}. "
                    f"Rarity: {rarity}. Type: {card_type}."
                )
            embedding = get_embed_model().encode(content).tolist()

            with pg_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO catalog_embeddings
                      (pokewallet_id, card_name, set_name, rarity, card_type,
                       market_price_usd, content, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (pokewallet_id) DO UPDATE
                      SET market_price_usd = EXCLUDED.market_price_usd,
                          content          = EXCLUDED.content,
                          embedding        = EXCLUDED.embedding,
                          updated_at       = NOW()
                    """,
                    (card_id, card_name, set_name, rarity, card_type,
                     price_usd, content, embedding),
                )
            pg_conn.commit()
            total_synced += 1

        pagination = data.get("pagination") or {}
        if page >= pagination.get("total_pages", 1):
            break
        page += 1

    logger.info("Synced %d cards from set '%s'", total_synced, set_name)
    return total_synced


def run_sync_pass():
    logger.info("Starting catalog sync pass...")
    cass_session = get_cassandra_session()
    pg_conn      = get_pg_conn()

    clear_catalog_tables(cass_session, pg_conn)

    all_sets = get_all_sets()
    logger.info("Found %d sets — syncing all", len(all_sets))

    total = 0
    for i, set_info in enumerate(all_sets):
        synced = sync_set(cass_session, pg_conn, set_info)
        total += synced
        if i < len(all_sets) - 1:
            logger.info("Waiting %ds before next set request...", SYNC_DELAY_SECONDS)
            time.sleep(SYNC_DELAY_SECONDS)

    logger.info("Sync pass complete. Total cards synced: %d", total)


def run():
    logger.info("PokéWallet sync service started.")
    while True:
        try:
            run_sync_pass()
        except Exception as exc:
            logger.error("Sync pass failed: %s", exc)
        logger.info("Next sync in %d seconds.", SYNC_INTERVAL_SECONDS)
        time.sleep(SYNC_INTERVAL_SECONDS)


if __name__ == "__main__":
    run()
