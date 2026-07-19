package com.tcgtracker.scan.dto;

import java.util.List;

import com.tcgtracker.external.OcrWord;

/**
 * Raw OCR behind a scan, attached to {@link ScanResponse} only when
 * {@code scan.debug.enabled=true}. Surfaces the exact input to the parser/matcher
 * (full text + word boxes) so real Vision output can be harvested into a tuning
 * corpus and frozen as regression fixtures (Phase 3c/3d). Never populated in normal
 * operation, so it doesn't leak OCR internals to users.
 */
public record ScanDebug(String fullText, List<OcrWord> words) {}
