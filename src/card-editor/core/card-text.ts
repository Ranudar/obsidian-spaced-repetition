import {
    CardType,
    isMultiLine,
    QuestionText,
} from "src/data/data-structures/card/questions/question";
import { CardFrontBackUtil } from "src/data/data-structures/card/questions/question-type";
import { SRSettings } from "src/data/settings";
import { parse } from "src/parser";
import { findLineIndexOfSearchStringIgnoringWs } from "src/utils/strings";

/** Every handwritten side is stored as "sr-ink-<stem>-<front|back>.svg". */
export const INK_FILE_PREFIX = "sr-ink-";

const WIKI_EMBED_REGEX = /^!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/;
// ![alt](path), ![alt](<path with spaces>), optionally with a "title"
const MARKDOWN_EMBED_REGEX = /^!\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)$/;

/** Whether a file name is that of an ink image ("sr-ink-….svg"), also one renamed by hand */
export function isInkFileName(name: string): boolean {
    return name.startsWith(INK_FILE_PREFIX) && /\.svg$/i.test(name);
}

/**
 * Link path if the side is exactly one embed of an ink SVG
 * ("![[…/sr-ink-…svg]]" or "![](…/sr-ink-…svg)"), else null.
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
        path = safeDecodeURIComponent(markdown[1] ?? markdown[2]);
    }

    return isInkFileName(fileNameOf(path)) ? path : null;
}

export function fileNameOf(path: string): string {
    return path.substring(path.lastIndexOf("/") + 1);
}

/** The url-decoded text; as is if it isn't url-encoded after all (e.g. a literal "%") */
export function safeDecodeURIComponent(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

// The embed regexes above, unanchored, to find embeds anywhere in a text
const ANY_EMBED_REGEX = /!\[\[[^\]]+\]\]|!\[[^\]]*\]\((?:<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Link paths of all ink SVGs embedded anywhere in the text (see inkEmbedPath). */
export function inkEmbedPaths(text: string): string[] {
    const paths: string[] = [];
    for (const match of text.matchAll(ANY_EMBED_REGEX)) {
        const path = inkEmbedPath(match[0]);
        if (path !== null) paths.push(path);
    }
    return paths;
}

// Links and embeds of any file: [[…]], ![[…]], [text](…), ![alt](…)
const ANY_LINK_REGEX = /!?\[\[([^\]]+)\]\]|!?\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g;

export interface LinkInText {
    /** The link as written, e.g. "![[x.svg|200]]" */
    match: string;
    /** Its link path, without alias, heading or block; markdown links url-decoded */
    path: string;
}

/** All links and embeds in the text, of any file */
export function linksIn(text: string): LinkInText[] {
    const links: LinkInText[] = [];
    for (const match of text.matchAll(ANY_LINK_REGEX)) {
        let path: string;
        if (match[1] !== undefined) {
            path = match[1].split(/[|#]/)[0];
        } else {
            path = safeDecodeURIComponent((match[2] ?? match[3]).split("#")[0]);
        }
        links.push({ match: match[0], path: path.trim() });
    }
    return links;
}

/** The embed stored in the note for a handwritten side, e.g. "![[sr-ink/x.svg]]". */
export function inkEmbed(linkPath: string): string {
    return `![[${linkPath}]]`;
}

// An embed (in either form, see above) at the very end of a side, after its start or whitespace
const TRAILING_EMBED_REGEX =
    /(?:^|\s)(!\[\[[^\]]+\]\]|!\[[^\]]*\]\((?:<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\))$/;

/** A side as stored in the note: typed text, optionally followed by one ink embed */
export interface SideParts {
    /** The typed text; "" for a side with only ink */
    text: string;
    /** The full trailing embed markup, e.g. "![[sr-ink/x.svg]]"; null without ink */
    inkEmbed: string | null;
}

/**
 * Typed text and ink of a side: its ink is an ink embed (see inkEmbedPath) at the very end, after
 * the start of the side, whitespace or a newline; the text is everything before it, without
 * trailing whitespace. A side without such an embed is all text, kept as is.
 */
export function splitSide(sideText: string): SideParts {
    const trimmed = sideText.trimEnd();
    const match = trimmed.match(TRAILING_EMBED_REGEX);
    if (!match || inkEmbedPath(match[1]) === null) return { text: sideText, inkEmbed: null };
    const embedStart = trimmed.length - match[1].length;
    return { text: trimmed.substring(0, embedStart).trimEnd(), inkEmbed: match[1] };
}

/**
 * Inverse of splitSide: the text, then the ink embed on a line of its own (multi-line and cloze
 * cards) or after a space (single-line cards, which must stay on one line).
 * Only the embed when the text is blank, only the text without ink.
 * A code block the text leaves open is closed first, else the embed would show as code.
 */
export function joinSide(cardType: CardType, text: string, inkEmbed: string | null): string {
    if (inkEmbed === null) return text;
    if (text.trim() === "") return inkEmbed;
    if (!isMultiLine(cardType) && cardType !== CardType.Cloze)
        return text.trimEnd() + " " + inkEmbed;
    const fence = openFence(text.trimEnd());
    return text.trimEnd() + (fence !== null ? "\n" + fence : "") + "\n" + inkEmbed;
}

/** The fence of a code block still open at the end of the text, else null */
function openFence(text: string): string | null {
    let fence: string | null = null;
    for (const line of text.split("\n")) fence = parserFenceAfter(fence, line);
    return fence;
}

/**
 * The fence of the code block open after a line, given the one open before it (null: none),
 * by the simple rule SR's parser uses: a line starting with the fence opens or closes it
 */
function parserFenceAfter(fence: string | null, line: string): string | null {
    if (fence !== null) return line.startsWith(fence) ? null : fence;
    return line.match(/^(`{3,}|~{3,})/)?.[1] ?? null;
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
            const inCode = fence !== null;
            fence = parserFenceAfter(fence, line);
            return !inCode && line.trim() === "" ? "<br>" : line;
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
        const inCode = fence !== null;
        fence = parserFenceAfter(fence, line);
        // Not inside a code block, nor its opening fence
        if (!inCode && fence === null && markers.includes(line.trim())) return line.trim();
    }
    return null;
}

/** Lines without trailing whitespace, which the parser drops from most lines */
function withoutTrailingWs(text: string): string {
    return text
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trimEnd();
}

/**
 * Whether SR's parser reads the card text as exactly one card of the type, with exactly that front
 * and back (ignoring trailing whitespace, which the parser drops). cardText is the card as written
 * to the note, without topic path and schedule.
 */
export function parsesAsCard(
    cardText: string,
    cardType: CardType,
    front: string,
    back: string | null,
    settings: SRSettings,
): boolean {
    const parsed = parse(cardText, settings);
    if (parsed.length !== 1 || parsed[0].cardType !== cardType) return false;
    // E.g. a tag at the start would be read as the card's deck, "^id" at the end as a block id
    const [topicPath, actualQuestion] = QuestionText.splitText(parsed[0].text, settings);
    if (topicPath !== null) return false;
    const split = splitCardText(cardType, actualQuestion, settings);
    return (
        withoutTrailingWs(split.front) === withoutTrailingWs(front) &&
        (back === null
            ? split.back === null
            : split.back !== null && withoutTrailingWs(split.back) === withoutTrailingWs(back))
    );
}

/** A side text the parser reads as nothing but text */
const PLAIN_SIDE = "x";

/**
 * The side whose text SR's parser would read as card syntax (e.g. "::" in a multi-line card, which
 * makes it a single-line card), so the card would not be read back with these sides; null if the
 * card parses as intended. compose: writes the card text from the sides, as it goes into the note.
 */
export function misreadSide(
    cardType: CardType,
    front: string,
    back: string | null,
    settings: SRSettings,
    compose: (front: string, back: string | null) => string,
): "front" | "back" | null {
    const parses = (f: string, b: string | null) =>
        parsesAsCard(compose(f, b), cardType, f, b, settings);
    if (parses(front, back)) return null;
    if (back === null) return "front";
    // The front alone, with a back that can't be misread
    return parses(front, PLAIN_SIDE) ? "back" : "front";
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
