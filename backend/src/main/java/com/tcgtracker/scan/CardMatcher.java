package com.tcgtracker.scan;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

import com.tcgtracker.query.CatalogSearchService;
import com.tcgtracker.query.dto.CardDto;
import com.tcgtracker.scan.dto.ScanCandidate;

/**
 * Ranks catalog listings against a {@link ParsedCard}. The collector number is the
 * strong signal (it lives inside the catalog's card_name); the Pokémon name breaks
 * ties across sets and rescues scans where the number wasn't read.
 */
@Component
public class CardMatcher {

    private static final int POOL_LIMIT = 80;

    // Score weights: an exact collector-number hit dominates; a numerator-only hit
    // (set total garbled by OCR) is nearly as strong; name similarity refines.
    private static final double NUMBER_WEIGHT = 0.6;
    private static final double NUMBER_INDEX_WEIGHT = 0.5;
    private static final double NAME_WEIGHT = 0.4;

    // Pure "index/total" collector number, e.g. "024/086".
    private static final Pattern PURE_FRACTION = Pattern.compile("(\\d{1,3})/(\\d{1,3})");

    private final CatalogSearchService catalog;

    public CardMatcher(CatalogSearchService catalog) {
        this.catalog = catalog;
    }

    public List<ScanCandidate> match(ParsedCard parsed, int topK) {
        if (parsed == null) {
            return List.of();
        }
        // Gather a candidate pool by number and/or name, de-duplicated by id.
        Map<String, CardDto> pool = new LinkedHashMap<>();
        if (parsed.collectorNumber() != null) {
            for (CardDto c : catalog.findByCardNumber(parsed.collectorNumber(), POOL_LIMIT)) {
                pool.putIfAbsent(c.pokewalletId(), c);
            }
        }
        String token = primaryToken(parsed.name());
        if (token != null) {
            for (CardDto c : catalog.findByCardNameContains(token, POOL_LIMIT)) {
                pool.putIfAbsent(c.pokewalletId(), c);
            }
        }

        return pool.values().stream()
            .map(c -> new ScanCandidate(c, score(parsed, c)))
            .filter(sc -> sc.confidence() > 0)
            .sorted(Comparator.comparingDouble(ScanCandidate::confidence).reversed())
            .limit(topK)
            .toList();
    }

    /**
     * 0..1 confidence: collector-number match + name similarity. An exact, plausible
     * number match scores highest; failing that, a matching numerator (the index within
     * the set — reliably OCR'd even when the set total is garbled, e.g. "024/006" for
     * 024/086) scores nearly as high, with the name breaking ties across sets.
     */
    static double score(ParsedCard parsed, CardDto card) {
        double score = 0;

        String parsedNum = parsed.collectorNumber();
        String cardNum = card.cardNumber();
        if (parsedNum != null && cardNum != null) {
            if (isPlausible(parsedNum) && sameNumber(parsedNum, cardNum)) {
                score += NUMBER_WEIGHT;
            } else if (numerator(parsedNum) != null && numerator(parsedNum).equals(numerator(cardNum))) {
                score += NUMBER_INDEX_WEIGHT;
            }
        }
        if (parsed.name() != null && !parsed.name().isBlank()) {
            score += NAME_WEIGHT * nameSimilarity(parsed.name(), baseName(card.cardName()));
        }
        return Math.min(1.0, score);
    }

    /**
     * Collector-number equality that ignores leading-zero padding, so an OCR read of
     * "46/132" matches the catalog's "046/132" (many scans drop the leading zero). Pure
     * "index/total" numbers compare by integer index and total; other formats
     * (TG12/TG30, SWSH123) compare case-insensitively as printed.
     */
    static boolean sameNumber(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        Matcher ma = PURE_FRACTION.matcher(a);
        Matcher mb = PURE_FRACTION.matcher(b);
        if (ma.matches() && mb.matches()) {
            return Integer.parseInt(ma.group(1)) == Integer.parseInt(mb.group(1))
                && Integer.parseInt(ma.group(2)) == Integer.parseInt(mb.group(2));
        }
        return a.equalsIgnoreCase(b);
    }

    /**
     * The index (numerator) of a pure "index/total" number, normalized without leading
     * zeros ("24" from "024/086" or "24/086"); null for non-fraction formats.
     */
    static String numerator(String number) {
        if (number == null) {
            return null;
        }
        Matcher m = PURE_FRACTION.matcher(number);
        return m.matches() ? String.valueOf(Integer.parseInt(m.group(1))) : null;
    }

    /**
     * A pure "index/total" number is implausible when the index far exceeds the set
     * total (e.g. "099/006", a misread) — guarded so a garbled number can't win a full
     * exact-match bonus against a wrong catalog card. 2× slack admits secret rares
     * (199/197). Non-fraction formats (TG12/TG30, SWSH123) are always plausible.
     */
    static boolean isPlausible(String number) {
        Matcher m = PURE_FRACTION.matcher(number == null ? "" : number);
        if (!m.matches()) {
            return true;
        }
        int index = Integer.parseInt(m.group(1));
        int total = Integer.parseInt(m.group(2));
        return total > 0 && index <= 2 * total;
    }

    /** Catalog names embed the number ("Xerneas - 091/086"); strip it for name comparison. */
    static String baseName(String cardName) {
        if (cardName == null) {
            return "";
        }
        return cardName.replaceAll("\\s*-\\s*\\S+\\s*$", "").trim();
    }

    /** The most distinctive token of a parsed name (longest word) used to widen the DB query. */
    static String primaryToken(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        String best = null;
        for (String w : name.trim().split("\\s+")) {
            String t = w.replaceAll("[^A-Za-z]", "");
            if (t.length() >= 3 && (best == null || t.length() > best.length())) {
                best = t;
            }
        }
        return best;
    }

    /** Normalized Levenshtein similarity in [0,1], case-insensitive. */
    static double nameSimilarity(String a, String b) {
        String x = a == null ? "" : a.toLowerCase().trim();
        String y = b == null ? "" : b.toLowerCase().trim();
        if (x.isEmpty() && y.isEmpty()) {
            return 1.0;
        }
        int max = Math.max(x.length(), y.length());
        if (max == 0) {
            return 1.0;
        }
        return 1.0 - (double) levenshtein(x, y) / max;
    }

    private static int levenshtein(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) {
            prev[j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] tmp = prev; prev = cur; cur = tmp;
        }
        return prev[b.length()];
    }
}
