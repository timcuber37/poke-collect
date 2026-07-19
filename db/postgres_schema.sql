-- Poke-Collect - Postgres Schema
-- Runs on Supabase or a local Postgres instance.

-- Populated by sync/api_sync.py from the PokéWallet API.
-- Used for card search, set filtering, and price display.
CREATE TABLE IF NOT EXISTS catalog_embeddings (
    id               SERIAL PRIMARY KEY,
    pokewallet_id    TEXT        NOT NULL UNIQUE,
    card_name        TEXT        NOT NULL,
    -- Collector number (e.g. "054/086"), from PokéWallet card_info.card_number.
    -- The strong discriminator for card-scan matching across same-name printings.
    card_number      TEXT,
    set_name         TEXT        NOT NULL,
    rarity           TEXT        NOT NULL,
    card_type        TEXT        NOT NULL,
    market_price_usd DECIMAL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS catalog_embeddings_card_name_idx   ON catalog_embeddings (card_name);
CREATE INDEX IF NOT EXISTS catalog_embeddings_card_number_idx ON catalog_embeddings (card_number);
CREATE INDEX IF NOT EXISTS catalog_embeddings_set_name_idx    ON catalog_embeddings (set_name);
CREATE INDEX IF NOT EXISTS catalog_embeddings_rarity_idx      ON catalog_embeddings (rarity);

-- Existing databases: additive migration (safe to re-run).
ALTER TABLE catalog_embeddings ADD COLUMN IF NOT EXISTS card_number TEXT;
