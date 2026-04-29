-- Pokemon TCG CQRS - Cassandra Read Side Schema

CREATE KEYSPACE IF NOT EXISTS pokemon_tcg
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE pokemon_tcg;

-- Query: "Show me all cards in a user's collection"
-- Partition key = user_id so all cards for a user are co-located
-- market_price_usd is the live TCGPlayer price captured at command time via PokéWallet API
CREATE TABLE IF NOT EXISTS collection_by_user (
    user_id          TEXT,
    collection_id    TEXT,
    card_id          TEXT,
    card_name        TEXT,
    set_name         TEXT,
    rarity           TEXT,
    condition        TEXT,
    market_price_usd DECIMAL,
    acquired_at      TIMESTAMP,
    PRIMARY KEY (user_id, collection_id)
) WITH CLUSTERING ORDER BY (collection_id ASC);

-- Query: "Show me all trade listings by a user"
CREATE TABLE IF NOT EXISTS trade_listings_by_user (
    user_id       TEXT,
    listing_id    TEXT,
    card_id       TEXT,
    card_name     TEXT,
    collection_id TEXT,
    status        TEXT,
    created_at    TIMESTAMP,
    PRIMARY KEY (user_id, listing_id)
) WITH CLUSTERING ORDER BY (listing_id ASC);

-- Query: "Show me the trade history for a user"
CREATE TABLE IF NOT EXISTS trade_history_by_user (
    user_id      TEXT,
    trade_id     TEXT,
    initiator_id TEXT,
    receiver_id  TEXT,
    completed_at TIMESTAMP,
    PRIMARY KEY (user_id, trade_id)
) WITH CLUSTERING ORDER BY (trade_id ASC);

-- Query: "Browse cards by set" (used by the Market page)
-- Populated by sync/api_sync.py pulling live data from PokéWallet API.
-- pokewallet_id stores the API's native card ID for future direct lookups.
CREATE TABLE IF NOT EXISTS cards_by_set (
    set_name         TEXT,
    card_id          TEXT,
    card_name        TEXT,
    rarity           TEXT,
    card_type        TEXT,
    market_price_usd DECIMAL,
    pokewallet_id    TEXT,
    PRIMARY KEY (set_name, card_id)
);
-- No static seed data — cards_by_set is populated entirely by api_sync.py at runtime.
