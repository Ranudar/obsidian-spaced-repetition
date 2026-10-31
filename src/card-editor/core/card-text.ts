import { CardType } from "src/data/data-structures/card/questions/question";
import { CardFrontBackUtil } from "src/data/data-structures/card/questions/question-type";
import { SRSettings } from "src/data/settings";
import { findLineIndexOfSearchStringIgnoringWs } from "src/utils/strings";

/** Every handwritten side is stored as "pencard-<stem>-<front|back>.svg" (Pen Cards' scheme). */
export const INK_FILE_PREFIX = "pencard-";

const WIKI_EMBED_REGEX = /^!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/;
// ![alt](path), ![alt](<path with spaces>), optionally with a "title"
const MARKDOWN_EMBED_REGEX = /^!\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)$/;

/** Whether a file name is that of an ink image ("pencard-….svg"), also one renamed by hand */
export function isInkFileName(name: string): boolean {
    return name.startsWith(INK_FILE_PREFIX) && /\.svg$/i.test(name);
}

/**
 * Link path if the side is exactly one embed of an ink SVG
 * ("![[…/pencard-…svg]]" or "![](…/pencard-…svg)"), else null.
 * Markdown links are url-decoded.
 */
export function inkEmbedPath(sideText: string): string | null {
    const text = sideText.trim();
    let path: string;
    const wiki = text.match(WIKI_EMBED_REGEX);
    if (wiki) {
        path = wiki[1].trim();
    } else {
        const markdown = text.match(MARKDOWN_EMBED_REGEX);
        if (!markdown) return null;
        path = markdown[1] ?? markdown[2];
        try {
            path = decodeURIComponent(path);
        } catch {
            // Not url-encoded after all (e.g. a literal "%"), use as is
        }
    }

    return isInkFileName(fileNameOf(path)) ? path : null;
}

/** File name if the side is exactly one embed of an ink SVG, else null (see inkEmbedPath) */
export function inkEmbedFileName(sideText: string): string | null {
    const path = inkEmbedPath(sideText);
    return path === null ? null : fileNameOf(path);
}

function fileNameOf(path: string): string {
    return path.substring(path.lastIndexOf("/") + 1);
}

// The embed regexes above, unanchored, to find embeds anywhere in a text
const ANY_EMBED_REGEX = /!\[\[[^\]]+\]\]|!\[[^\]]*\]\((?:<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;

/** File names of all ink SVGs embedded anywhere in the text. */
export function inkEmbedFileNames(text: string): string[] {
    const names: string[] = [];
    for (const match of text.matchAll(ANY_EMBED_REGEX)) {
        const name = inkEmbedFileName(match[0]);
        if (name !== null) names.push(name);
    }
    return names;
}

/** The embed stored in the note for a handwritten side, e.g. "![[pencards/x.svg]]". */
export function inkEmbed(linkPath: string): string {
    return `![[${linkPath}]]`;
}

/** The separator between front and back of a card type; null for cloze cards. */
export function cardSeparator(cardType: CardType, settings: SRSettings): string | null {
    switch (cardType) {
        case CardType.SingleLineBasic:
            return settings.singleLineCardSeparator;
        case CardType.SingleLineReversed:
            return settings.singleLineReversedCardSeparator;
        case CardType.MultiLineBasic:
            return settings.multilineCardSeparator;
        case CardType.MultiLineReversed:
            return settings.multilineReversedCardSeparator;
        case CardType.Cloze:
            return null;
    }
}

function isMultiLine(cardType: CardType): boolean {
    return cardType === CardType.MultiLineBasic || cardType === CardType.MultiLineReversed;
}

export interface SplitCard {
    front: string;
    /** null for cloze cards */
    back: string | null;
    /**
     * The separator as written in the note: for multi-line cards its whole line,
     * which may have extra whitespace (e.g. "? "). null for cloze cards.
     */
    separator: string | null;
}

/**
 * Front and back of a question (its actual question text, without topic path and schedule).
 * Splits exactly like the parser does, so a separator inside a side (e.g. "?") is kept.
 * The back is null for cloze cards, whose text is edited as a whole.
 */
export function splitCardText(cardType: CardType, text: string, settings: SRSettings): SplitCard {
    const separator = cardSeparator(cardType, settings);
    if (separator === null) return { front: text, back: null, separator: null };

    const [{ front, back }] = CardFrontBackUtil.expand(cardType, text, settings);
    if (!isMultiLine(cardType)) return { front, back, separator };
    const lines = text.split("\n");
    const line = lines[findLineIndexOfSearchStringIgnoringWs(lines, separator)];
    return { front, back, separator: line ?? separator };
}

/**
 * Exact inverse of splitCardText: multi-line cards get the separator on a line of its own.
 * separator: the one splitCardText returned, to keep its line as it was;
 * by default the card type's separator from the settings.
 */
export function composeCardText(
    cardType: CardType,
    front: string,
    back: string | null,
    settings: SRSettings,
    separator?: string | null,
): string {
    const typeSeparator = cardSeparator(cardType, settings);
    if (typeSeparator === null) return front;

    const sep = separator ?? typeSeparator;
    if (isMultiLine(cardType)) return `${front}\n${sep}\n${back ?? ""}`;
    return front + sep + (back ?? "");
}

/**
 * Without an end marker, a blank line ends a multi-line or cloze card. Blank lines typed in a side
 * are therefore kept as a "<br>" line, which shows as an empty line too.
 * Blank lines inside code blocks are left alone, the parser reads code blocks as a whole.
 */
export function protectBlankLines(text: string, settings: SRSettings): string {
    if (settings.multilineCardEndMarker) return text;
    let fence: string | null = null;
    return text
        .split("\n")
        .map((line) => {
            if (fence !== null) {
                if (line.startsWith(fence)) fence = null;
                return line;
            }
            const open = line.match(/^(`{3,}|~{3,})/);
            if (open) fence = open[1];
            return line.trim() === "" ? "<br>" : line;
        })
        .join("\n");
}

/**
 * The first line of a typed side that the parser would read as a card separator or as the end
 * marker (compared ignoring whitespace, like the parser), else null. Such a line would split or end
 * the card there. Lines inside code blocks are skipped, the parser reads code blocks as a whole.
 */
export function cardMarkerLine(text: string, settings: SRSettings): string | null {
    const markers = [
        settings.multilineCardSeparator,
        settings.multilineReversedCardSeparator,
        settings.multilineCardEndMarker,
    ].filter((marker) => marker);
    let fence: string | null = null;
    for (const line of text.split("\n")) {
        if (fence !== null) {
            if (line.startsWith(fence)) fence = null;
            continue;
        }
        const open = line.match(/^(`{3,}|~{3,})/);
        if (open) fence = open[1];
        else if (markers.includes(line.trim())) return line.trim();
    }
    return null;
}

/** New multi-line basic card body, without surrounding blank lines. */
export function newCardBody(front: string, back: string, settings: SRSettings): string {
    const lines = [front, settings.multilineCardSeparator, back];
    // A blank line before the end marker stops "---" from turning the previous line into a heading.
    // With an end marker set, the parser keeps that blank line inside the card and trims it,
    // so it is harmless.
    if (settings.multilineCardEndMarker) lines.push("", settings.multilineCardEndMarker);
    return lines.join("\n");
}

/**
 * Text to insert so the card is separated by a blank line from what comes before and after it.
 * `before` / `after` are the note text around the insertion point.
 * The insertion point should then move to the end of the returned text,
 * so consecutive cards are inserted one after the other.
 */
export function cardInsertion(before: string, body: string, after = ""): string {
    let prefix: string;
    if (before.length === 0 || before.endsWith("\n\n")) prefix = "";
    else if (before.endsWith("\n")) prefix = before.trim().length === 0 ? "" : "\n";
    else prefix = "\n\n";

    let suffix: string;
    if (after.startsWith("\n\n")) suffix = "";
    else if (after.startsWith("\n") || after.length === 0) suffix = "\n";
    else suffix = "\n\n";
    return prefix + body + suffix;
}
