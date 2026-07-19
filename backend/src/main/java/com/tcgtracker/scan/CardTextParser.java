package com.tcgtracker.scan;

import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;

import com.tcgtracker.external.OcrResult;
import com.tcgtracker.external.OcrWord;

/**
 * Turns raw OCR ({@link OcrResult}) into a {@link ParsedCard}: the Pokémon name
 * and the collector number ("091/086") that together pin down a catalog listing.
 *
 * Pure logic (no Spring/IO deps) so it can be unit-tested directly.
 */
@Component
public class CardTextParser {

    // Collector-number formats, most-specific first. The matched text (whitespace
    // stripped) is the normalized number, e.g. "091/086", "TG12/TG30", "SWSH123".
    private static final List<Pattern> NUMBER_PATTERNS = List.of(
        Pattern.compile("\\b[A-Z]{2}\\d{1,3}\\s*/\\s*[A-Z]{2}\\d{1,3}\\b"),       // TG12/TG30, GG01/GG70
        Pattern.compile("\\b\\d{1,3}\\s*/\\s*\\d{1,3}\\b"),                        // 091/086
        Pattern.compile("\\b(?:SWSH|SVP|SV|SM|XY|BW|HGSS|DP)\\s?\\d{1,3}\\b")      // promos
    );

    // Top fraction of the card image where the title sits.
    private static final double TOP_REGION = 0.35;
    // A word counts as "title-sized" if its height is at least this fraction of the tallest.
    private static final double TITLE_HEIGHT_RATIO = 0.6;

    public ParsedCard parse(OcrResult ocr) {
        if (ocr == null) {
            return ParsedCard.empty();
        }
        String fullText = ocr.fullText() == null ? "" : ocr.fullText();
        String number = extractCollectorNumber(fullText);
        String name = extractName(ocr, fullText);
        return new ParsedCard(name, number, null);
    }

    static String extractCollectorNumber(String fullText) {
        if (fullText == null || fullText.isBlank()) {
            return null;
        }
        for (Pattern p : NUMBER_PATTERNS) {
            Matcher m = p.matcher(fullText);
            if (m.find()) {
                // Report the raw read (e.g. "024/006"); the matcher decides how to use
                // it — the numerator is reliable even when OCR garbles the set total.
                return m.group().replaceAll("\\s+", "");
            }
        }
        return null;
    }

    /** Name = the largest text line near the top; falls back to the first sensible line. */
    private String extractName(OcrResult ocr, String fullText) {
        String fromWords = nameFromWords(ocr.words());
        if (fromWords != null && !fromWords.isBlank()) {
            return fromWords;
        }
        for (String line : fullText.split("\\R")) {
            String t = line.trim();
            if (t.length() >= 2 && hasLetter(t) && isNameToken(t)) {
                return cleanName(t);
            }
        }
        return null;
    }

    private String nameFromWords(List<OcrWord> words) {
        if (words == null || words.isEmpty()) {
            return null;
        }
        double imageBottom = words.stream().mapToDouble(w -> w.top() + w.height()).max().orElse(0);
        double topCutoff = imageBottom * TOP_REGION;

        List<OcrWord> topWords = words.stream()
            .filter(w -> w.top() <= topCutoff)
            .filter(w -> isNameToken(w.text()))
            .toList();
        if (topWords.isEmpty()) {
            return null;
        }

        double maxHeight = topWords.stream().mapToDouble(OcrWord::height).max().orElse(0);
        List<OcrWord> titleWords = topWords.stream()
            .filter(w -> w.height() >= TITLE_HEIGHT_RATIO * maxHeight)
            .toList();

        OcrWord tallest = titleWords.stream().max(Comparator.comparingDouble(OcrWord::height)).orElseThrow();
        double baseline = tallest.top();
        double lineTolerance = 0.6 * maxHeight;

        String name = titleWords.stream()
            .filter(w -> Math.abs(w.top() - baseline) <= lineTolerance)
            .sorted(Comparator.comparingDouble(OcrWord::left))
            .map(OcrWord::text)
            .collect(Collectors.joining(" "));
        return cleanName(name);
    }

    /** Reject non-name tokens: HP, stage labels, pure numbers, and collector numbers. */
    private static boolean isNameToken(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.length() < 2 || !hasLetter(s)) {
            return false;
        }
        String up = s.toUpperCase();
        if (up.equals("HP") || up.matches("BASIC|STAGE|STAGE1|STAGE2|EVOLVES")) {
            return false;
        }
        // The HP stat sits top-right, level with the name, so OCR often glues it into a
        // single token on the title baseline — "HP190", or "HD190"/"HN190" when the P is
        // misread. No real card name looks like this, so drop it before it corrupts the
        // name (which otherwise pulls the match to the wrong card, e.g. Mewtwo GX → EX).
        if (up.matches("H[A-Z]\\d{2,3}")) {
            return false;
        }
        return !s.matches(".*\\d{1,3}\\s*/\\s*\\d{1,3}.*"); // contains a collector number
    }

    private static boolean hasLetter(String s) {
        return s.chars().anyMatch(Character::isLetter);
    }

    private static String cleanName(String s) {
        return s.replaceAll("\\s+", " ").trim();
    }
}
