-- Pokemon TCG CQRS - Postgres + pgvector RAG Schema

CREATE EXTENSION IF NOT EXISTS vector;

-- Populated by consumers/postgres_consumer.py via Kafka events.
-- Represents cards owned by users — includes market price at time of acquisition.
CREATE TABLE IF NOT EXISTS card_embeddings (
    id               SERIAL PRIMARY KEY,
    card_id          TEXT        NOT NULL,
    user_id          TEXT        NOT NULL,
    collection_id    TEXT        NOT NULL UNIQUE,
    card_name        TEXT        NOT NULL,
    set_name         TEXT        NOT NULL,
    rarity           TEXT        NOT NULL,
    condition        TEXT        NOT NULL,
    market_price_usd DECIMAL,
    content          TEXT        NOT NULL,
    embedding        vector(384),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Populated by sync/api_sync.py from the PokéWallet API.
-- Represents the full card catalog with live prices — used for RAG market queries.
CREATE TABLE IF NOT EXISTS catalog_embeddings (
    id               SERIAL PRIMARY KEY,
    pokewallet_id    TEXT        NOT NULL UNIQUE,
    card_name        TEXT        NOT NULL,
    set_name         TEXT        NOT NULL,
    rarity           TEXT        NOT NULL,
    card_type        TEXT        NOT NULL,
    market_price_usd DECIMAL,
    content          TEXT        NOT NULL,
    embedding        vector(384),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS card_embeddings_embedding_idx
    ON card_embeddings
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 10);

CREATE INDEX IF NOT EXISTS catalog_embeddings_embedding_idx
    ON catalog_embeddings
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 10);

CREATE INDEX IF NOT EXISTS card_embeddings_user_idx ON card_embeddings (user_id);
