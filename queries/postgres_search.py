import psycopg2
import config


def search_catalog(query: str, limit: int = 30) -> list[dict]:
    """
    Substring-search the catalog_embeddings table populated by api_sync.
    Pure read-side: never touches MySQL or Kafka.
    """
    if not query:
        return []
    pattern = f"%{query}%"
    conn = psycopg2.connect(config.POSTGRES_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pokewallet_id, card_name, set_name, rarity, card_type, market_price_usd
                FROM   catalog_embeddings
                WHERE  card_name ILIKE %s
                ORDER  BY market_price_usd DESC NULLS LAST, card_name
                LIMIT  %s
                """,
                (pattern, limit),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [
        {
            "pokewallet_id":    r[0],
            "card_name":        r[1],
            "set_name":         r[2],
            "rarity":           r[3],
            "card_type":        r[4],
            "market_price_usd": float(r[5]) if r[5] is not None else None,
        }
        for r in rows
    ]
