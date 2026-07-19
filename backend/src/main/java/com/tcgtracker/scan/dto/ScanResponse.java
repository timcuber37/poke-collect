package com.tcgtracker.scan.dto;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

import com.tcgtracker.scan.ParsedCard;

/**
 * Result of POST /api/scan: the ranked candidate listings (best first) plus what
 * OCR parsed, so the SPA can show the read text and let the user confirm a match.
 * {@code debug} carries the raw OCR and is present only when scan debug capture is
 * enabled; it is omitted from the JSON otherwise ({@link JsonInclude.Include#NON_NULL}).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ScanResponse(List<ScanCandidate> candidates, ParsedCard parsed, ScanDebug debug) {}
