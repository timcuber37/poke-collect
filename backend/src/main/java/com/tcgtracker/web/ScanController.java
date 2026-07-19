package com.tcgtracker.web;

import java.io.IOException;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import com.tcgtracker.scan.ScanRateLimiter;
import com.tcgtracker.scan.ScanService;
import com.tcgtracker.scan.dto.ScanResponse;

/**
 * Card-scan endpoint. Accepts a webcam JPEG (multipart) and returns ranked catalog
 * candidates for the user to confirm. Auth-required (any authenticated user) — it
 * is enforced by the security config's {@code anyRequest().authenticated()} default,
 * since each call hits the paid Vision API. A per-user token bucket
 * ({@link ScanRateLimiter}) caps the scan rate so a single user can't run up the
 * Vision bill; over-limit requests get 429 with a {@code Retry-After} header.
 */
@RestController
@RequestMapping("/api")
public class ScanController {

    private final ScanService scan;
    private final ScanRateLimiter rateLimiter;

    public ScanController(ScanService scan, ScanRateLimiter rateLimiter) {
        this.scan = scan;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping(value = "/scan", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ScanResponse> scan(@AuthenticationPrincipal Jwt jwt,
                                             @RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No image uploaded");
        }
        // Guard against non-image uploads (the webcam sends image/jpeg). A missing
        // content type is tolerated; a present, non-image one is rejected — neither
        // path costs a Vision call or a rate-limit token.
        String contentType = file.getContentType();
        if (contentType != null && !contentType.startsWith("image/")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Uploaded file must be an image");
        }
        // Check the budget before spending a paid Vision call (a bad upload 400s
        // above without costing the user a token).
        ScanRateLimiter.Decision decision = rateLimiter.check(jwt.getSubject());
        if (!decision.allowed()) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", String.valueOf(decision.retryAfterSeconds()))
                .build();
        }
        try {
            return ResponseEntity.ok(scan.scan(file.getBytes()));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Could not read uploaded image", e);
        } catch (IllegalStateException e) {
            // Vision not configured / upstream failure.
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, e.getMessage(), e);
        }
    }
}
