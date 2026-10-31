import { CardType } from "src/data/data-structures/card/questions/question";
import { CardFrontBackUtil } from "src/data/data-structures/card/questions/question-type";
import { SRSettings } from "src/data/settings";

/** Every handwritten side is stored as "pencard-<stem>-<front|back>.svg" (Pen Cards' scheme). */
export const INK_FILE_PREFIX = "pencard-";

const WIKI_EMBED_REGEX = /^!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/;
// ![alt](path), ![alt](<path with spaces>), optionally with a "title"
const MARKDOWN_EMBED_REGEX = /^!\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)$/;

/**
 * File name if the side is exactly one embed of an ink SVG
 * ("![[…/pencard-…svg]]" or "![](…/pencard-…svg)"), else null.
 */
export function inkEmbedFileName(sideText: string): string | null {
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

    const name = path.substring(path.lastIndexOf("/") + 1);
    if (!name.startsWith(INK_FILE_PREFIX) || !/\.svg$/i.test(name)) return null;
    return name;
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

/**
 * Front and back of a question (its actual question text, without topic path and schedule).
 * Splits exactly like the parser does, so a separator inside a side (e.g. "?") is kept.
 * The back is null for cloze cards, whose text is edited as a whole.
 */
export function splitCardText(
    cardType: CardType,
    text: string,
    settings: SRSettings,
): { front: string; back: string | null } {
    if (cardSeparator(cardType, settings) === null) return { front: text, back: null };

    const [{ front, back }] = CardFrontBackUtil.expand(cardType, text, settings);
    return { front, back };
}

/**
 * Inverse of splitCardText.
 * Multi-line cards get the separator on a line of its own, unless a side already provides
 * the line break (a trailing newline on the front, a leading one on the back).
 */
export function composeCardText(
    cardType: CardType,
    front: string,
    back: string | null,
    settings: SRSettings,
): string {
    const separator = cardSeparator(cardType, settings);
    if (separator === null) return front;

    const backText = back ?? "";
    let result = front;
    if (isMultiLine(cardType) && !front.endsWith("\n")) result += "\n";
    result += separator;
    if (isMultiLine(cardType) && !backText.startsWith("\n")) result += "\n";
    return result + backText;
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
