package com.tcgtracker.scan;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ScanRateLimiterTest {

    // Virtual clock (nanos) so refill can be tested without real waiting.
    private final long[] now = {0L};

    private ScanRateLimiter limiter(int capacity, double refillPerMinute) {
        now[0] = 0L;
        return new ScanRateLimiter(capacity, refillPerMinute, () -> now[0]);
    }

    private void advanceSeconds(double seconds) {
        now[0] += (long) (seconds * 1_000_000_000L);
    }

    @Test
    void allowsUpToCapacityThenDenies() {
        ScanRateLimiter rl = limiter(3, 60); // burst 3, refill 1/sec

        assertTrue(rl.check("u").allowed());
        assertTrue(rl.check("u").allowed());
        assertTrue(rl.check("u").allowed());

        ScanRateLimiter.Decision denied = rl.check("u");
        assertFalse(denied.allowed());
        assertTrue(denied.retryAfterSeconds() >= 1, "denied response should carry a Retry-After hint");
    }

    @Test
    void refillsOverTime() {
        ScanRateLimiter rl = limiter(1, 60); // 1 token cap, refill 1/sec

        assertTrue(rl.check("u").allowed());
        assertFalse(rl.check("u").allowed());

        advanceSeconds(1.0);
        assertTrue(rl.check("u").allowed(), "a token should have refilled after one second");
    }

    @Test
    void bucketsAreIsolatedPerUser() {
        ScanRateLimiter rl = limiter(1, 0); // no refill

        assertTrue(rl.check("alice").allowed());
        assertFalse(rl.check("alice").allowed());
        assertTrue(rl.check("bob").allowed(), "one user's exhaustion must not affect another");
    }
}
