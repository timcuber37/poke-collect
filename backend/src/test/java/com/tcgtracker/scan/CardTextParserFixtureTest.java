package com.tcgtracker.scan;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.type.TypeReference;
import com.tcgtracker.external.OcrResult;
import com.tcgtracker.external.OcrWord;

/**
 * Phase 3c regression harness: holds {@link CardTextParser} to real OCR captures.
 *
 * Each entry in {@code /scan/parse-fixtures.json} becomes its own named test. To grow
 * the corpus: enable scan debug capture ({@code SCAN_DEBUG_ENABLED=true}), scan a card,
 * paste the captured JSON here, and set {@code expectedName}/{@code expectedNumber} to
 * the correct values. A fixture with neither expectation is exercised (must not throw)
 * but asserts nothing — useful for parking a tricky scan before deciding the target.
 * When the parser gets a case wrong, that fixture fails: fix the regex/heuristic, not
 * the fixture.
 */
class CardTextParserFixtureTest {

    private final CardTextParser parser = new CardTextParser();

    @TestFactory
    Stream<DynamicTest> parsesFixtures() {
        List<ParseFixture> fixtures = ScanFixtureSupport.load(
            "/scan/parse-fixtures.json", new TypeReference<List<ParseFixture>>() {});
        return fixtures.stream().map(f -> DynamicTest.dynamicTest(f.label, () -> {
            OcrResult ocr = new OcrResult(f.fullText, f.words == null ? List.of() : f.words);
            ParsedCard parsed = parser.parse(ocr);
            assertNotNull(parsed, "parser returned null");
            if (f.expectNoNumber) {
                assertNull(parsed.collectorNumber(), "expected no collector number");
            } else if (f.expectedNumber != null) {
                assertEquals(f.expectedNumber, parsed.collectorNumber(), "collector number");
            }
            if (f.expectedName != null) {
                assertEquals(f.expectedName, parsed.name(), "card name");
            }
        }));
    }

    /** One parser fixture. Public fields so Jackson binds; unknown capture fields ignored. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    static final class ParseFixture {
        public String label = "(unlabeled)";
        public String fullText = "";
        public List<OcrWord> words;
        public String expectedName;
        public String expectedNumber;
        public boolean expectNoNumber = false;
    }
}
