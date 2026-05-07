# PokéCollect

A Pokémon Trading Card Game collection manager built around a CQRS architecture. Search the modern card catalog, build a personal collection, get live TCGPlayer prices, and ask a local LLM questions about your cards.

Built as a CSC545 final project to demonstrate distributed-systems patterns: command/query separation, an event-driven write side, multiple specialized read stores, and a RAG layer over a vector index.

## Architecture

The application splits writes from reads through a Kafka event bus.

```
                        ┌──────────────┐
   user actions ─────►  │    Flask     │  ──── publish ──┐
   (add, remove)        │   commands   │                 ▼
                        └──────┬───────┘          ┌─────────────┐
                               │ write              │   Kafka     │
                               ▼                  │   topic      │
                        ┌──────────────┐          └──────┬──────┘
                        │    MySQL     │  source-of-truth │
                        │ (write side) │                  │
                        └──────────────┘                  │
                                                          │ subscribe
                                       ┌──────────────────┼──────────────────┐
                                       ▼                  ▼                  ▼
                              ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐
                              │   Cassandra    │ │   PostgreSQL   │ │  (catalog sync   │
                              │  (read side)   │ │   + pgvector   │ │   writes both)   │
                              │ collection_by_ │ │   embeddings   │ └──────────────────┘
                              │ user, cards_   │ │   for RAG      │
                              │ by_set         │ │                │
                              └────────────────┘ └────────────────┘
                                       ▲                  ▲
                                       │                  │
                                       └─── Flask read ───┘
                                              queries

   PokéWallet API ──► sync service (every 24h) ──► Cassandra + Postgres
                      live price lookup on add ──► Postgres
```

- **MySQL** is the authoritative write side — users, cards, and collections.
- **Kafka** carries events between the write side and the read models.
- **Cassandra** holds denormalized read models keyed for fast user/set lookups.
- **PostgreSQL with pgvector** stores card embeddings (sentence-transformers) and current TCGPlayer prices, used by both the search page and the RAG chatbot.
- **Ollama** runs a local LLM (`phi3:mini`) to answer card questions using context retrieved from pgvector.
- **PokéWallet API** is the source of card data and live pricing.

## Stack

- Python 3.11+, Flask 3
- MySQL 8 (write side)
- Apache Cassandra (read side)
- PostgreSQL 16 + pgvector (vector search + price cache)
- Apache Kafka (event bus)
- Ollama with `phi3:mini` (local LLM)
- sentence-transformers `all-MiniLM-L6-v2` for embeddings

## Project layout

```
app.py                  Flask entry point — wires up blueprints and context
config.py               Loads config from .env

routes/                 HTTP layer
  query_routes.py       /, /collection, /market — read-side views
  command_routes.py     /commands/* — write-side actions (add, remove, add-copy)
  rag_routes.py         /chat, /chat/ask — AI chat endpoints
  auth_routes.py        /login/<id>, /logout
  image_routes.py       /card-image/<id> — proxies card images

commands/               Write side
  handlers.py           handle_add_card, handle_add_from_search, handle_remove_card
  mysql_writer.py       SQLAlchemy writes to MySQL master tables

queries/                Read side
  cassandra_queries.py  Reads from collection_by_user, cards_by_set
  postgres_search.py    Catalog search, current price overlay, paginated results

consumers/              Kafka consumers (separate processes)
  cassandra_consumer.py Subscribes to events, writes to Cassandra read model
  postgres_consumer.py  Subscribes to events, writes to Postgres

events/definitions.py   Dataclasses for CardAddedToCollection, CardRemoved...
event_bus/bus.py        Kafka producer/consumer factory

api/pokewallet.py       PokéWallet REST client + TCGPlayer price extraction
sync/api_sync.py        Standalone catalog sync (runs once per day)

rag/rag_module.py       Embed query → pgvector similarity → Ollama answer

db/                     Schema definitions
  mysql_schema.sql
  cassandra_schema.cql
  postgres_schema.sql

templates/              Jinja2 templates (base, home, collection, chat, …)
static/                 CSS/images
```

## Running locally

Prerequisites: MySQL, Cassandra, Kafka, PostgreSQL with pgvector, and Ollama all running locally with the schemas applied.

1. Copy `.env.example` to `.env` (or create one) with credentials for MySQL, Postgres, Cassandra, Kafka, PokéWallet API key.
2. `python -m venv venv && venv\Scripts\activate`
3. `pip install -r requirements.txt`
4. Apply schemas in `db/` to their respective databases.
5. Start the four processes (each in its own terminal):
   - `python app.py` — Flask web app on http://127.0.0.1:5000
   - `python -m consumers.cassandra_consumer`
   - `python -m consumers.postgres_consumer`
   - `python -m sync.api_sync` — catalog sync (runs immediately, then every 24h)

The Cassandra and Postgres consumers must both be running for collection writes to propagate to the read side.

## Features

- **Card search** with pagination (25/page), filterable by set, excludes Energy cards.
- **Collection** view with deduplication — duplicate copies collapse into one tile with a `× N` quantity, `+`/`−` controls per card, and a running total value.
- **Live pricing** — TCGPlayer prices are fetched on-demand when adding to a collection or opening the collection page, and cached in Postgres so subsequent loads are instant. Prices persist across catalog sync passes.
- **AI chat** — vector-similarity context retrieval over the catalog, answered by a local LLM. The chat is sandboxed via a hardened system prompt and has no SQL/tool access.
- **Sync service** — pulls XY-era and newer English sets (146 sets, ~10k cards) from PokéWallet, respecting the 100 req/hour rate limit.

## Notes

- The PokéWallet free tier is 100 req/hour, 1000 req/day. The sync runs once per 24 hours to stay within the daily budget.
- The PokéWallet `/sets/{id}` bulk endpoint omits TCGPlayer prices, so live prices come from `/cards/{id}` lookups triggered by the user adding to a collection.
- `backfill_collection_prices.py` is a one-shot script that fetches live prices for any cards already in collections.
