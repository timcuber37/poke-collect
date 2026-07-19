package com.tcgtracker.sync;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.datastax.oss.driver.api.core.CqlSession;
import com.datastax.oss.driver.api.core.cql.SimpleStatement;
import com.fasterxml.jackson.databind.JsonNode;
import com.tcgtracker.external.PokeWalletClient;

/**
 * Shared catalog-refresh primitive: pull one set's cards (all pages) from
 * PokéWallet and upsert them into both read models — the Cassandra
 * {@code cards_by_set} table (Market browse) and the Postgres
 * {@code catalog_embeddings} table (collection price overlay + search).
 *
 * Used by both the scheduled {@link CatalogSyncJob} (full daily pass) and the
 * on-demand collection price refresh, so the per-set upsert logic lives in one
 * place. No Spring profile — instantiated in every role that wires it.
 */
@Service
public class CatalogRefreshService {

    private static final Logger log = LoggerFactory.getLogger(CatalogRefreshService.class);

    private static final int PAGE_SIZE = 200;

    private static final String CASS_INSERT_PRICED =
        "INSERT INTO cards_by_set (set_name, card_id, card_name, rarity, card_type, market_price_usd, pokewallet_id) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)";
    private static final String CASS_INSERT_NOPRICE =
        "INSERT INTO cards_by_set (set_name, card_id, card_name, rarity, card_type, pokewallet_id) " +
        "VALUES (?, ?, ?, ?, ?, ?)";
    private static final String PG_UPSERT =
        "INSERT INTO catalog_embeddings (pokewallet_id, card_name, card_number, set_name, rarity, card_type, market_price_usd) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (pokewallet_id) DO UPDATE SET " +
        "  card_number = COALESCE(EXCLUDED.card_number, catalog_embeddings.card_number), " +
        "  market_price_usd = COALESCE(EXCLUDED.market_price_usd, catalog_embeddings.market_price_usd), " +
        "  updated_at = NOW()";

    private final PokeWalletClient pokewallet;
    private final CqlSession cql;
    private final JdbcTemplate pg;

    public CatalogRefreshService(PokeWalletClient pokewallet, CqlSession cql,
                                 @Qualifier("postgresJdbcTemplate") JdbcTemplate postgresJdbcTemplate) {
        this.pokewallet = pokewallet;
        this.cql = cql;
        this.pg = postgresJdbcTemplate;
    }

    /** Cards upserted + pages fetched (one PokéWallet call per page) for a set refresh. */
    public record SetRefresh(int cardsUpdated, int pagesFetched) {}

    /**
     * Refresh a single set from a {@code /sets} entry. Pages through
     * {@code /sets/{set_id}} and upserts each card's current price into both read
     * models. Costs one API call per page (most sets fit a single 200-card page).
     */
    public SetRefresh refreshSet(JsonNode setInfo) {
        String setId = setInfo.path("set_id").asText(null);
        String setName = setInfo.path("name").asText(setId);
        if (setId == null) {
            return new SetRefresh(0, 0);
        }

        int page = 1;
        int synced = 0;
        int pages = 0;
        while (true) {
            JsonNode data = pokewallet.getSetCards(setId, page, PAGE_SIZE);
            pages++;
            JsonNode cards = data == null ? null : data.get("cards");
            if (cards == null || !cards.isArray() || cards.isEmpty()) {
                break;
            }

            for (JsonNode card : cards) {
                if (upsertCard(setName, card)) {
                    synced++;
                }
            }

            JsonNode pagination = data.path("pagination");
            if (page >= pagination.path("total_pages").asInt(1)) {
                break;
            }
            page++;
        }
        log.info("Refreshed {} cards from set '{}' ({} page(s))", synced, setName, pages);
        return new SetRefresh(synced, pages);
    }

    /** Upsert one card into Cassandra + Postgres. Returns false if the row was skipped. */
    private boolean upsertCard(String setName, JsonNode card) {
        JsonNode info = card.path("card_info");
        String cardId = card.path("id").asText("");
        String cardName = info.path("name").asText(info.path("clean_name").asText(""));
        String cardNumber = info.path("card_number").asText(null); // e.g. "054/086"; null if absent
        String rarity = info.path("rarity").asText("Unknown");
        String cardType = info.path("card_type").asText("Unknown");
        Double price = pokewallet.extractTcgPlayerPrice(card);
        if (cardId.isEmpty() || cardName.isEmpty()) {
            return false;
        }

        if (price != null) {
            cql.execute(SimpleStatement.newInstance(CASS_INSERT_PRICED,
                setName, cardId, cardName, rarity, cardType, BigDecimal.valueOf(price), cardId));
        } else {
            cql.execute(SimpleStatement.newInstance(CASS_INSERT_NOPRICE,
                setName, cardId, cardName, rarity, cardType, cardId));
        }
        pg.update(PG_UPSERT, cardId, cardName, cardNumber, setName, rarity, cardType, price);
        return true;
    }

    /**
     * Map of {@code set_name -> set metadata} for English sets, built from a single
     * {@code /sets} call. Lets callers resolve the {@code set_name} stored on a
     * user's collection rows back to the {@code set_id} the price endpoint needs
     * (the read models persist only the name). First entry wins on name collisions.
     */
    public Map<String, JsonNode> englishSetInfoByName() {
        Map<String, JsonNode> byName = new HashMap<>();
        for (JsonNode s : pokewallet.getAllSets()) {
            if (!"eng".equalsIgnoreCase(s.path("language").asText(""))) {
                continue;
            }
            String name = s.path("name").asText(null);
            if (name != null) {
                byName.putIfAbsent(name, s);
            }
        }
        return byName;
    }
}
