package com.tcgtracker.query.dto;

/** A single catalog card as returned to the SPA. */
public record CardDto(
    String pokewalletId,
    String cardName,
    String setName,
    String rarity,
    String cardType,
    Double marketPriceUsd,
    // Collector number (e.g. "054/086"), from the catalog's card_number column. The
    // strong signal for card-scan matching. Null for rows not yet backfilled and for
    // the Cassandra-sourced Market view (cards_by_set has no number).
    String cardNumber
) {}
