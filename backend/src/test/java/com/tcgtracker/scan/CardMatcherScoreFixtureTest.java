package com.tcgtracker.scan;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.type.TypeReference;
import com.tcgtracker.query.dto.CardDto;

/**
 * Phase 3d ranking harness: over a small candidate pool, {@link CardMatcher#score}
 * must rank the right catalog listing first. Pure scoring (no DB), so it exercises the
 * number/name weighting and confidence you'll tune for the auto-select threshold.
 *
 * Candidates carry {@code cardName} + {@code cardNumber} — mirroring the real catalog
 * now that the collector number is its own column. The winner is identified by its
 * {@code cardNumber} (same-name cards differ only by number). Each entry in
 * {@code /scan/match-fixtures.json} becomes a named test asserting the argmax is
 * {@code expectedBest} (and, when given, that its confidence clears
 * {@code expectedMinConfidence} — the lever for "auto-select vs. ask the user").
 */
class CardMatcherScoreFixtureTest {

    @TestFactory
    Stream<DynamicTest> ranksBestCandidateFirst() {
        List<MatchFixture> fixtures = ScanFixtureSupport.load(
            "/scan/match-fixtures.json", new TypeReference<List<MatchFixture>>() {});
        return fixtures.stream().map(f -> DynamicTest.dynamicTest(f.label, () -> {
            ParsedCard parsed = new ParsedCard(
                f.parsed == null ? null : f.parsed.name,
                f.parsed == null ? null : f.parsed.collectorNumber,
                null);

            Cand best = null;
            double bestScore = -1;
            for (Cand c : f.candidates) {
                double s = CardMatcher.score(parsed, card(c));
                if (s > bestScore) {
                    bestScore = s;
                    best = c;
                }
            }

            assertNotNull(best, "no candidates scored");
            assertEquals(f.expectedBest, best.cardNumber, "top-ranked candidate (by number)");
            if (f.expectedMinConfidence != null) {
                assertTrue(bestScore >= f.expectedMinConfidence,
                    "best score " + bestScore + " below expected floor " + f.expectedMinConfidence);
            }
        }));
    }

    private static CardDto card(Cand c) {
        return new CardDto("pk_" + (c.cardName + c.cardNumber).hashCode(),
            c.cardName, "Set", "Rare", "Psychic", 1.0, c.cardNumber);
    }

    /** One matcher fixture. Public fields so Jackson binds; unknown capture fields ignored. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    static final class MatchFixture {
        public String label = "(unlabeled)";
        public Parsed parsed;
        public List<Cand> candidates = List.of();
        public String expectedBest;
        public Double expectedMinConfidence;

        @JsonIgnoreProperties(ignoreUnknown = true)
        static final class Parsed {
            public String name;
            public String collectorNumber;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    static final class Cand {
        public String cardName;
        public String cardNumber;
    }
}
