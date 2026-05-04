"""
One-time backfill: fetch live TCGPlayer prices for every card currently in any
user's collection that doesn't yet have a price in catalog_embeddings.

Usage: python backfill_collection_prices.py
"""
import time
import psycopg2

import config
from queries.cassandra_queries import get_session
from routes.command_routes import _fetch_and_cache_live_price


def main():
    sess = get_session()
    rows = list(sess.execute("SELECT card_id FROM collection_by_user"))
    collection_ids = list({r.card_id for r in rows})
    print(f"Found {len(collection_ids)} unique cards across all collections")

    conn = psycopg2.connect(config.POSTGRES_DSN)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT pokewallet_id FROM catalog_embeddings "
            "WHERE pokewallet_id = ANY(%s) AND market_price_usd IS NOT NULL",
            (collection_ids,),
        )
        already_priced = {r[0] for r in cur.fetchall()}
    conn.close()

    todo = [cid for cid in collection_ids if cid not in already_priced]
    print(f"{len(already_priced)} already have prices, {len(todo)} need backfilling")

    success = fail = 0
    for i, cid in enumerate(todo, 1):
        price = _fetch_and_cache_live_price(cid)
        if price is not None:
            success += 1
            print(f"  [{i}/{len(todo)}] {cid[:30]}... -> ${price:.2f}")
        else:
            fail += 1
            print(f"  [{i}/{len(todo)}] {cid[:30]}... -> no price")
        time.sleep(0.5)

    print(f"\nDone. {success} priced, {fail} no-price/failed.")


if __name__ == "__main__":
    main()
