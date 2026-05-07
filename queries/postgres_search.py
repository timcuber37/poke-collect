import psycopg2
import config

PAGE_SIZE = 25


def search_catalog(query: str = "", set_name: str = "", page: int = 1) -> tuple[list[dict], int]:
    """
    Search catalog_embeddings by card name and/or set name.
    Returns (results, total_count) for pagination.
    Pure read-side: never touches MySQL or Kafka.
    """
    if not query and not set_name:
        return [], 0

    conditions = ["card_type NOT ILIKE 'Energy%%'"]
    params: list = []

    if query:
        conditions.append("card_name ILIKE %s")
        params.append(f"%{query}%")

    if set_name:
        conditions.append("set_name = %s")
        params.append(set_name)

    where  = " AND ".join(conditions)
    offset = max(0, (page - 1) * PAGE_SIZE)

    conn = psycopg2.connect(config.POSTGRES_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT COUNT(*) FROM catalog_embeddings WHERE {where}",
                params,
            )
            total = cur.fetchone()[0]

            cur.execute(
                f"""
                SELECT pokewallet_id, card_name, set_name, rarity, card_type, market_price_usd
                FROM   catalog_embeddings
                WHERE  {where}
                ORDER  BY market_price_usd DESC NULLS LAST, card_name
                LIMIT  %s OFFSET %s
                """,
                params + [PAGE_SIZE, offset],
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    results = [
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
    return results, total


def get_current_prices(card_ids: list[str]) -> dict[str, float | None]:
    """Return a {pokewallet_id: market_price_usd} map for the given card IDs."""
    if not card_ids:
        return {}
    conn = psycopg2.connect(config.POSTGRES_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pokewallet_id, market_price_usd FROM catalog_embeddings "
                "WHERE pokewallet_id = ANY(%s)",
                (card_ids,),
            )
            return {r[0]: float(r[1]) if r[1] is not None else None for r in cur.fetchall()}
    finally:
        conn.close()


def get_catalog_set_names() -> list[str]:
    """Return distinct set names from the synced catalog, alphabetically sorted."""
    conn = psycopg2.connect(config.POSTGRES_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT set_name FROM catalog_embeddings ORDER BY set_name")
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
