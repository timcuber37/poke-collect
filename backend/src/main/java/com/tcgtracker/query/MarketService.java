package com.tcgtracker.query;

import java.util.List;
import java.util.TreeSet;

import org.springframework.stereotype.Service;

import com.datastax.oss.driver.api.core.CqlSession;
import com.tcgtracker.query.cassandra.CardsBySetRepository;
import com.tcgtracker.query.dto.CardDto;

/**
 * Read-side "browse by set" backed by the Cassandra {@code cards_by_set} table.
 * Ports the Cassandra reads from queries/cassandra_queries.py.
 */
@Service
public class MarketService {

    private final CardsBySetRepository cardsBySet;
    private final CqlSession cql;

    public MarketService(CardsBySetRepository cardsBySet, CqlSession cql) {
        this.cardsBySet = cardsBySet;
        this.cql = cql;
    }

    /** All cards in a set, mapped to the shared CardDto. */
    public List<CardDto> cardsInSet(String setName) {
        return cardsBySet.findBySetName(setName).stream()
            .map(c -> new CardDto(
                c.getCardId(),
                c.getCardName(),
                c.getSetName(),
                c.getRarity(),
                c.getCardType(),
                c.getMarketPriceUsd() == null ? null : c.getMarketPriceUsd().doubleValue(),
                null)) // cards_by_set (Cassandra) has no collector number
            .toList();
    }

    /** Distinct set names currently present in cards_by_set, alphabetically sorted. */
    public List<String> allSetNames() {
        var rows = cql.execute("SELECT DISTINCT set_name FROM cards_by_set").all();
        TreeSet<String> names = new TreeSet<>();
        for (var row : rows) {
            String s = row.getString("set_name");
            if (s != null) names.add(s);
        }
        return List.copyOf(names);
    }
}
