package com.tcgtracker.scan;

import java.util.List;

import org.springframework.stereotype.Service;

import com.tcgtracker.external.OcrResult;
import com.tcgtracker.external.VisionOcrClient;
import com.tcgtracker.scan.dto.ScanCandidate;
import com.tcgtracker.scan.dto.ScanDebug;
import com.tcgtracker.scan.dto.ScanResponse;

/**
 * Card-scan pipeline: OCR the photo (Vision) → parse name + collector number →
 * rank catalog candidates. The SPA then lets the user confirm a candidate, which
 * flows into the existing add-to-collection command. When scan debug capture is
 * enabled, the raw OCR is recorded for the tuning corpus and echoed back.
 */
@Service
public class ScanService {

    private static final int MAX_CANDIDATES = 5;

    private final VisionOcrClient vision;
    private final CardTextParser parser;
    private final CardMatcher matcher;
    private final ScanCaptureService capture;

    public ScanService(VisionOcrClient vision, CardTextParser parser, CardMatcher matcher,
                       ScanCaptureService capture) {
        this.vision = vision;
        this.parser = parser;
        this.matcher = matcher;
        this.capture = capture;
    }

    public ScanResponse scan(byte[] imageBytes) {
        OcrResult ocr = vision.detect(imageBytes);
        ParsedCard parsed = parser.parse(ocr);
        List<ScanCandidate> candidates = matcher.match(parsed, MAX_CANDIDATES);
        ScanDebug debug = capture.record(ocr, parsed, candidates); // null unless enabled
        return new ScanResponse(candidates, parsed, debug);
    }
}
