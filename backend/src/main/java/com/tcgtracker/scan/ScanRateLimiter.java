package com.tcgtracker.scan;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Per-user token-bucket rate limiter for the paid card-scan endpoint. Each scan
 * costs one Google Vision unit, so this caps how fast a single user can burn
 * through them: a burst of up to {@code capacity} scans, refilling at
 * {@code refillPerMinute}.
 *
 * In-memory and per-user, mirroring
 * {@link com.tcgtracker.query.CollectionPriceRefreshService}'s cooldown: a single
 * web instance backs the app and this is a cost courtesy, not a correctness
 * guarantee, so no external store is needed. The bucket map is keyed by user id
 * (bounded by the user count), so it needs no eviction — same as the refresh service.
 */
@Component
public class ScanRateLimiter {

    private final int capacity;
    private final double refillPerSecond;
    private final LongSupplier nanoClock;
    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    // @Autowired disambiguates: this class has a second (test-only) constructor, so
    // Spring needs to be told which one to inject.
    @Autowired
    public ScanRateLimiter(
        @Value("${scan.rate-limit.capacity:20}") int capacity,
        @Value("${scan.rate-limit.refill-per-minute:10}") double refillPerMinute
    ) {
        this(capacity, refillPerMinute, System::nanoTime);
    }

    // Test seam: inject a virtual clock so refill can be exercised without sleeping.
    ScanRateLimiter(int capacity, double refillPerMinute, LongSupplier nanoClock) {
        this.capacity = capacity;
        this.refillPerSecond = refillPerMinute / 60.0;
        this.nanoClock = nanoClock;
    }

    /** Try to consume one scan token for the user; denied carries a Retry-After hint. */
    public Decision check(String userId) {
        Bucket b = buckets.computeIfAbsent(userId, k -> new Bucket(capacity, nanoClock.getAsLong()));
        synchronized (b) {
            long now = nanoClock.getAsLong();
            double elapsedSec = Math.max(0, (now - b.lastRefillNanos) / 1_000_000_000.0);
            b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSecond);
            b.lastRefillNanos = now;
            if (b.tokens >= 1.0) {
                b.tokens -= 1.0;
                return new Decision(true, 0);
            }
            long retryAfter = refillPerSecond <= 0
                ? Long.MAX_VALUE
                : (long) Math.ceil((1.0 - b.tokens) / refillPerSecond);
            return new Decision(false, Math.max(1, retryAfter));
        }
    }

    private static final class Bucket {
        double tokens;
        long lastRefillNanos;

        Bucket(double tokens, long lastRefillNanos) {
            this.tokens = tokens;
            this.lastRefillNanos = lastRefillNanos;
        }
    }

    /** Outcome of a rate-limit check: allowed, or denied with a Retry-After hint (seconds). */
    public record Decision(boolean allowed, long retryAfterSeconds) {}
}
