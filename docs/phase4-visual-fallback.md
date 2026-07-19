# Phase 4 — Visual-Embedding Fallback (design)

**Status:** Deferred / research spike. Not started. This is the plan for when the OCR
path's residual failures prove common enough to justify it.

## Goal & scope

Identify a scanned card by its **artwork** when the text/number path can't:

- **Full-art / alt-art cards** — the collector number is small and set into busy art.
- **Framing / capture misses** — the bottom strip (number + set code) is out of frame
  or unreadable (the "Ninetales-class" failure we saw in 3c).

**Fallback, not replacement.** The OCR → name/number match (Phases 1–3) stays primary and
runs first. Visual search runs **only when that comes back low-confidence**, both to keep
accuracy high and to keep embedding cost off the common path.

## Why this is a real build (not a table reuse)

The `catalog_embeddings` table has **no vector column and no pgvector** — the name is
vestigial, left from the removed Ollama/RAG era. Phase 4 must add pgvector, an embedding
column, an embedding source, and a reference-image index. Our catalog Postgres is Supabase,
which ships `vector` as a first-class extension, so enabling it is one line.

## Where it slots into the pipeline

```
Today:   photo ─► VisionOcrClient (OCR) ─► CardTextParser ─► CardMatcher.match ─► ranked candidates
                                                                                   │
Phase 4 adds, in ScanService, after match():                                       ▼
   if topOcrConfidence < VISUAL_FALLBACK_THRESHOLD:
       queryVec        = EmbeddingClient.embed(croppedImageBytes)   // same crop we OCR
       visualCandidates = CatalogVisualSearch.nearest(queryVec, k)  // pgvector ANN
       response        = merge/rank(ocrCandidates, visualCandidates)
```

The scanned image is used twice on a weak read: once for OCR (text) and once for the
embedding (visual). No new capture UX needed.

## 1. Schema (Supabase Postgres)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE catalog_embeddings ADD COLUMN IF NOT EXISTS image_embedding vector(512);
ALTER TABLE catalog_embeddings ADD COLUMN IF NOT EXISTS embedding_model TEXT; -- provenance, for re-embeds

-- ~18k rows: brute-force cosine is single-digit ms, so an ANN index is OPTIONAL.
-- Add only if latency demands it later:
-- CREATE INDEX ON catalog_embeddings USING hnsw (image_embedding vector_cosine_ops);
```

Vector dimension is set by the model (CLIP ViT-B/32 = 512; Vertex `multimodalembedding@001`
= 1408, or a configurable 128/256/512). Embeddings are L2-normalized so cosine distance
(`<=>`) is the similarity metric.

## 2. Embedding source — pick one

| | Self-hosted CLIP sidecar | Vertex AI multimodal embeddings |
|---|---|---|
| Cost | one-time infra, no per-image fee | per-image fee on **build (18k) and every query** |
| Auth | none (local service) | GCP project + service account (separate from the Vision API key) |
| Fit | new `embedder` container in the existing compose stack | managed, nothing to host |
| Purpose-built | yes — image-similarity is CLIP's core job | general multimodal |
| Friction to start | build a small service | fastest to prototype |

**Recommendation: self-hosted CLIP sidecar.** A one-time index build over ~18k *static*
card images means per-call API cost adds up for no ongoing benefit, CLIP is exactly the
right tool for card-art similarity, and a small container drops cleanly into
`docker-compose.yml`. Vertex is the reasonable managed alternative if we want to prototype
without hosting a model.

CLIP sidecar sketch:
- A tiny Python/FastAPI (or ONNX) service `embedder`, `POST /embed` (image bytes →
  512-float L2-normalized vector), model e.g. `clip-ViT-B-32`.
- Add as a compose service on the `tcgtracker` network.
- Backend calls it via `RestClient`, mirroring `VisionOcrClient` → a new
  `external/EmbeddingClient`.

## 3. Reference-image index build (offline, incremental)

- **Image source:** the PokéWallet image endpoint, already wired as
  `PokeWalletClient.getCardImageBytes(cardId, size)` (`/images/{id}?size=`) and proxied/
  cached by `ImageController` into the `card_images` volume (`IMAGE_CACHE_DIR=/app/static/cards`).
  Coverage is **partial + rate-limited** — this is the real constraint, not embedding speed.
- **Build job:** a new component in the `sync` profile, mirroring
  `CatalogRefreshService` / `CatalogSyncJob`:
  - iterate catalog cards where `image_embedding IS NULL`, fetch the reference image
    (cache-first), embed via the sidecar, then
    `UPDATE catalog_embeddings SET image_embedding = ?, embedding_model = ? WHERE pokewallet_id = ?`.
  - **Resumable** (skips already-embedded rows — same idea as the `card_number` backfill),
    **rate-limited** (reuse the per-set delay), and **targetable per set** via an
    `EMBED_ONLY_SETS` knob mirroring `SYNC_ONLY_SETS`.
  - **Idempotent:** re-embed only when `embedding_model` changes.
- **Cost/time:** bounded by image-fetch rate, not embedding. Build once; incremental after.

## 4. Query path (online)

New read component `CatalogVisualSearch` (mirror `CatalogSearchService`, same
`postgresJdbcTemplate`):

```sql
SELECT pokewallet_id, card_name, set_name, rarity, card_type, market_price_usd, card_number,
       1 - (image_embedding <=> ?) AS similarity
FROM catalog_embeddings
WHERE image_embedding IS NOT NULL AND card_type NOT ILIKE 'Energy%'
ORDER BY image_embedding <=> ?
LIMIT ?;
```

`ScanService` embeds the cropped scan (same sidecar) and calls `nearest(queryVec, k)`.

## 5. Fallback wiring & confidence

- **Trigger only on weak OCR:** `topOcrConfidence < 0.55` (the existing LOW tier in
  `Scan.tsx`) — keeps embedding calls off the common path, consistent with the
  `ScanRateLimiter` cost-guard philosophy.
- **Combine signals:** map visual `similarity` → 0..1 confidence; if a visual candidate
  *also* appears in the OCR name pool, boost it (independent signals agree). Feed the result
  into the same `ScanResponse` candidate list, so the existing auto-select / choose / low
  tiers and the condition picker all work unchanged.
- **Cost guard:** if using a paid embedding API, add a second per-user bucket (extend
  `ScanRateLimiter`) so visual fallback can't be spammed.

Config (mirror `scan.*`):

```yaml
scan:
  visual-fallback:
    enabled: ${SCAN_VISUAL_FALLBACK:false}
    trigger-below-confidence: 0.55
    top-k: 5
```

## 6. Rollout (incremental milestones)

- **4a — Spike.** Stand up the `embedder` sidecar (or Vertex), enable pgvector, add the
  column. Embed **one set** (e.g. Chaos Rising via `EMBED_ONLY_SETS`). Manually confirm
  nearest-neighbor returns the right card for a handful of scans.
- **4b — Query path + fallback behind a flag** (`scan.visual-fallback.enabled=false` by
  default). **Evaluate against the Phase-2.5 capture corpus** — we already have the exact
  scans where OCR failed. Measure: does visual search rank the right card #1?
- **4c — Full index build** (all embeddable cards), then enable the fallback.
- **4d — Optional hardening.** HNSW index if latency needs it at scale; scheduled re-embed
  on model change.

## 7. Open questions / risks

- **Reference-image coverage.** Cards without a fetchable image can't be embedded → no
  visual fallback for them. Measure coverage before committing.
- **Does it actually help?** Evaluate on the real OCR-failure corpus (4b) *before* the full
  build. If visual search doesn't reliably rank full-art cards #1, reconsider the whole phase.
- **Model/dim lock-in.** The column dimension is fixed by the model; switching models means
  a full re-embed (hence the `embedding_model` provenance column).
- **Vertex path only:** separate GCP auth from the Vision key, and per-image cost on both
  build and query.

## 8. Cheaper things to try FIRST (may make Phase 4 unnecessary)

Before building an embedding pipeline, these directly target the same residual failures at a
fraction of the effort:

1. **Second OCR pass** on a rotated / re-cropped image when the first read is weak — cheap,
   reuses the existing Vision call path.
2. **Fuzzy set-symbol / set-code matching** — we already OCR the set code (`CRI` / `CRON`);
   a fuzzy match to the API's set-level `set_code` could disambiguate without any embeddings.
3. **Capture-time framing hint / stronger bottom-margin** — the Ninetales-class miss is a
   framing problem; guiding the user to get the number strip in frame fixes it with zero
   model infrastructure.

If these knock out most of the residual, Phase 4 may never be needed.
