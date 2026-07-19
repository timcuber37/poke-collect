package com.tcgtracker.scan;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.tcgtracker.external.OcrResult;
import com.tcgtracker.external.OcrWord;

class CardTextParserTest {

    private final CardTextParser parser = new CardTextParser();

    // ---- collector number extraction ----

    @Test
    void extractsStandardCollectorNumber() {
        assertEquals("091/086", CardTextParser.extractCollectorNumber("Xerneas\nHP 130\n091/086\nCRI"));
    }

    @Test
    void extractsNumberWithSpacesAroundSlash() {
        assertEquals("25/198", CardTextParser.extractCollectorNumber("Pikachu  25 / 198  Common"));
    }

    @Test
    void extractsSubsetNumber() {
        assertEquals("TG12/TG30", CardTextParser.extractCollectorNumber("Rayquaza VMAX  TG12/TG30"));
    }

    @Test
    void extractsPromoNumber() {
        assertEquals("SWSH123", CardTextParser.extractCollectorNumber("Charizard V  SWSH 123  Black Star Promo"));
    }

    @Test
    void returnsNullWhenNoNumber() {
        assertNull(CardTextParser.extractCollectorNumber("Charizard  Base Set  Fire"));
    }

    @Test
    void extractsSecretRareNumberedAboveSetTotal() {
        // Raw read is preserved; plausibility/index handling lives in the matcher now.
        assertEquals("199/197", CardTextParser.extractCollectorNumber("Charizard VMAX\n199/197\nSecret"));
    }

    // ---- name extraction from word boxes ----

    @Test
    void picksLargestTopWordAsNameAndIgnoresHpAndNumbers() {
        OcrResult ocr = new OcrResult(
            "Xerneas HP 130 Geo Storm 091/086",
            List.of(
                new OcrWord("Xerneas", 40, 10, 20),   // title
                new OcrWord("HP", 20, 12, 300),        // excluded: HP
                new OcrWord("130", 30, 12, 330),       // excluded: numeric
                new OcrWord("Geo", 12, 220, 20),       // body text, below top region
                new OcrWord("091/086", 14, 480, 20)    // collector number, bottom
            ));
        ParsedCard parsed = parser.parse(ocr);
        assertEquals("Xerneas", parsed.name());
        assertEquals("091/086", parsed.collectorNumber());
    }

    @Test
    void dropsHpStatGluedIntoTitleBaseline() {
        // The HP stat sits top-right, level with the name; OCR often reads it as one
        // token ("HP190", or "HD190" when the P is garbled). It must not join the name.
        OcrResult ocr = new OcrResult(
            "Basic\nMewtwo GX\nHP190",
            List.of(
                new OcrWord("HP190", 48, 89, 471),   // HP stat, tallest, on the title baseline
                new OcrWord("GX", 36, 100, 319),
                new OcrWord("Mewtwo", 39, 103, 175),
                new OcrWord("Basic", 15, 122, 94),    // stage label
                new OcrWord("body", 10, 800, 80)      // anchors image scale
            ));
        assertEquals("Mewtwo GX", parser.parse(ocr).name());
    }

    @Test
    void joinsMultiWordTitleLeftToRight() {
        OcrResult ocr = new OcrResult(
            "Iron Valiant ex 089/162",
            List.of(
                new OcrWord("Valiant", 38, 11, 90),
                new OcrWord("Iron", 38, 10, 20),
                new OcrWord("ex", 30, 12, 200),
                new OcrWord("089/162", 14, 470, 20)
            ));
        ParsedCard parsed = parser.parse(ocr);
        assertEquals("Iron Valiant ex", parsed.name());
        assertEquals("089/162", parsed.collectorNumber());
    }

    // ---- fallback to full text when no word boxes ----

    @Test
    void fallsBackToFirstSensibleLineWhenNoWordBoxes() {
        OcrResult ocr = new OcrResult("Basic\nPikachu\nHP 60\n025/198", List.of());
        ParsedCard parsed = parser.parse(ocr);
        assertEquals("Pikachu", parsed.name()); // "Basic" is skipped as a stage label
        assertEquals("025/198", parsed.collectorNumber());
    }

    @Test
    void handlesEmptyOcrGracefully() {
        ParsedCard parsed = parser.parse(OcrResult.empty());
        assertNull(parsed.name());
        assertNull(parsed.collectorNumber());
    }
}
