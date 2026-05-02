import psycopg2
import config


def search_catalog(query: str = "", set_name: str = "", limit: int = 30) -> list[dict]:
    """
    Search catalog_embeddings by card name and/or set name.
    Pure read-side: never touches MySQL or Kafka.
    """
    if not query and not set_name:
        return []

    conditions = ["card_type NOT ILIKE 'Energy%%'"]
    params: list = []

    if query:
        conditions.append("card_name ILIKE %s")
        params.append(f"%{query}%")

    if set_name:
        conditions.append("set_name = %s")
        params.append(set_name)
        limit = 200  # show full set when browsing by set

    params.append(limit)
    where = " AND ".join(conditions)

    conn = psycopg2.connect(config.POSTGRES_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT pokewallet_id, card_name, set_name, rarity, card_type, market_price_usd
                FROM   catalog_embeddings
                WHERE  {where}
                ORDER  BY market_price_usd DESC NULLS LAST, card_name
                LIMIT  %s
                """,
                params,
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


def get_catalog_set_names() -> list[str]:
    """Return distinct set names from the synced catalog, alphabetically sorted."""
    conn = psycopg2.connect(config.POSTGRES_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT set_name FROM catalog_embeddings ORDER BY set_name")
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
