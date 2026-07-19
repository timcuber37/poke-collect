package com.tcgtracker.scan;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.tcgtracker.external.OcrResult;
import com.tcgtracker.external.OcrWord;
import com.tcgtracker.query.dto.CardDto;
import com.tcgtracker.scan.dto.ScanCandidate;
import com.tcgtracker.scan.dto.ScanDebug;

class ScanCaptureServiceTest {

    private static OcrResult ocr() {
        return new OcrResult("Xerneas\n091/086", List.of(new OcrWord("Xerneas", 40, 10, 12)));
    }

    private static ParsedCard parsed() {
        return new ParsedCard("Xerneas", "091/086", null);
    }

    private static List<ScanCandidate> candidates() {
        return List.of(new ScanCandidate(
            new CardDto("pk1", "Xerneas", "Fates Collide", "Rare", "Fairy", 2.0, "091/086"), 1.0));
    }

    @Test
    void returnsNullWhenDisabled() {
        ScanCaptureService capture = new ScanCaptureService(false, "");
        assertNull(capture.record(ocr(), parsed(), candidates()));
    }

    @Test
    void capturesRawOcrWhenEnabled() {
        ScanCaptureService capture = new ScanCaptureService(true, "");
        ScanDebug debug = capture.record(ocr(), parsed(), candidates());
        assertNotNull(debug);
        assertEquals("Xerneas\n091/086", debug.fullText());
        assertEquals(1, debug.words().size());
        assertEquals("Xerneas", debug.words().get(0).text());
    }

    @Test
    void nullOcrIsSafeEvenWhenEnabled() {
        ScanCaptureService capture = new ScanCaptureService(true, "");
        assertNull(capture.record(null, ParsedCard.empty(), List.of()));
    }

    @Test
    void appendsJsonlWhenCaptureFileSet(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("corpus.jsonl");
        ScanCaptureService capture = new ScanCaptureService(true, file.toString());

        capture.record(ocr(), parsed(), candidates());
        capture.record(ocr(), parsed(), candidates());

        List<String> lines = Files.readAllLines(file);
        assertEquals(2, lines.size(), "each scan appends one JSONL row");
        assertTrue(lines.get(0).contains("\"091/086\""), "row should include the parsed collector number");
        assertTrue(lines.get(0).contains("\"fullText\""), "row should include the raw OCR text");
    }
}
