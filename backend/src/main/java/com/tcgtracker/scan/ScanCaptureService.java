package com.tcgtracker.scan;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.tcgtracker.external.OcrResult;
import com.tcgtracker.scan.dto.ScanCandidate;
import com.tcgtracker.scan.dto.ScanDebug;

/**
 * Phase 2.5 tuning-corpus capture. When {@code scan.debug.enabled=true}, records each
 * scan's raw OCR + parsed result so real Vision output can be harvested into
 * regression fixtures for tuning the parser/matcher (Phase 3c/3d). Three sinks:
 *  - the returned {@link ScanDebug}, surfaced in the SPA for copy/paste;
 *  - a one-line summary on the {@code scan.capture} logger (retrievable via container logs);
 *  - an optional append to {@code scan.debug.capture-file} for a durable JSONL corpus.
 *
 * Disabled by default: normal scans pay no cost and leak no OCR internals.
 */
@Component
public class ScanCaptureService {

    private static final Logger log = LoggerFactory.getLogger("scan.capture");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final boolean enabled;
    private final String captureFile;

    public ScanCaptureService(
        @Value("${scan.debug.enabled:false}") boolean enabled,
        @Value("${scan.debug.capture-file:}") String captureFile
    ) {
        this.enabled = enabled;
        this.captureFile = captureFile == null ? "" : captureFile;
    }

    /**
     * Record a scan for the tuning corpus. Returns the {@link ScanDebug} to attach to
     * the response, or {@code null} when capture is disabled or there is no OCR.
     */
    public ScanDebug record(OcrResult ocr, ParsedCard parsed, List<ScanCandidate> candidates) {
        if (!enabled || ocr == null) {
            return null;
        }
        ScanCandidate top = (candidates == null || candidates.isEmpty()) ? null : candidates.get(0);
        log.info("scan capture: name='{}' number='{}' words={} top='{}'@{}",
            parsed == null ? null : parsed.name(),
            parsed == null ? null : parsed.collectorNumber(),
            ocr.words() == null ? 0 : ocr.words().size(),
            top == null ? null : top.card().cardName(),
            top == null ? null : String.format("%.2f", top.confidence()));

        if (!captureFile.isBlank()) {
            appendJsonl(ocr, parsed, top);
        }
        return new ScanDebug(ocr.fullText(), ocr.words());
    }

    /** Best-effort durable corpus: one JSON object per line. Never fails the scan. */
    private void appendJsonl(OcrResult ocr, ParsedCard parsed, ScanCandidate top) {
        try {
            ObjectNode row = MAPPER.createObjectNode();
            row.put("at", Instant.now().toString());
            ObjectNode p = row.putObject("parsed");
            p.put("name", parsed == null ? null : parsed.name());
            p.put("collectorNumber", parsed == null ? null : parsed.collectorNumber());
            p.put("setCode", parsed == null ? null : parsed.setCode());
            row.put("fullText", ocr.fullText());
            row.set("words", MAPPER.valueToTree(ocr.words()));
            if (top != null) {
                ObjectNode t = row.putObject("topCandidate");
                t.put("pokewalletId", top.card().pokewalletId());
                t.put("cardName", top.card().cardName());
                t.put("confidence", top.confidence());
            }
            Files.writeString(Path.of(captureFile),
                MAPPER.writeValueAsString(row) + System.lineSeparator(),
                StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException | RuntimeException e) {
            log.warn("scan capture: could not append to {}: {}", captureFile, e.toString());
        }
    }
}
