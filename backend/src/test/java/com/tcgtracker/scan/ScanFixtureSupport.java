package com.tcgtracker.scan;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Loads scan tuning-corpus fixtures (Phase 3c/3d) from test resources. Fixture JSON
 * mirrors the capture shape emitted by {@link ScanCaptureService} / the SPA's
 * "Copy capture JSON" button, so a real scan can be pasted in with only the expected
 * fields added. Fixture holders ignore unknown properties, so extra capture fields
 * ({@code at}, {@code parsed}, {@code topCandidate}, …) are tolerated.
 */
final class ScanFixtureSupport {

    static final ObjectMapper MAPPER = new ObjectMapper();

    private ScanFixtureSupport() {}

    static <T> List<T> load(String resource, TypeReference<List<T>> type) {
        try (InputStream in = ScanFixtureSupport.class.getResourceAsStream(resource)) {
            if (in == null) {
                throw new IllegalStateException("Missing fixture resource: " + resource);
            }
            return MAPPER.readValue(in, type);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to read fixtures: " + resource, e);
        }
    }
}
