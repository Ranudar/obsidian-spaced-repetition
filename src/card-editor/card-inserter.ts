import { App, MarkdownView, TFile } from "obsidian";

import { cardInsertion } from "src/card-editor/core/card-text";
import { isSingleLine } from "src/data/data-structures/card/questions/question";
import { SRSettings } from "src/data/settings";
import { parse } from "src/parser";
import { splitNoteIntoFrontmatterAndContent, splitTextIntoLineArray } from "src/utils/strings";

/**
 * Inserts new cards into a note: below the cursor when the note is open in an editor,
 * else at the end of the note. Consecutive cards go one after the other.
 */
export class CardInserter {
    private app: App;
    private file: TFile;
    private view: MarkdownView | null;
    private settings: SRSettings;
    /**
     * The last card inserted through the editor: its body, the line breaks inserted after it, and
     * the document offset after those. The next card goes there.
     */
    private last: { body: string; suffix: string; end: number } | null = null;
    /** Set when a card was inserted through the editor, whose changes may not be on disk yet */
    private editorUsed = false;

    /** view: the editor the command was run from, if any */
    constructor(app: App, file: TFile, view: MarkdownView | null, settings: SRSettings) {
        this.app = app;
        this.file = file;
        this.view = view;
        this.settings = settings;
    }

    async insert(body: string): Promise<void> {
        const view = this.usableView();
        if (view === null) {
            await this.app.vault.process(
                this.file,
                (data) => data + insertion(data, body, "", this.settings).text,
            );
            return;
        }

        const editor = view.editor;
        const doc = editor.getValue();
        let offset: number;
        if (this.last === null) {
            // First card: below the cursor, after the block the cursor is in
            const line = insertionLine(doc, editor.getCursor().line, this.settings);
            offset = editor.posToOffset({ line, ch: editor.getLine(line).length });
        } else {
            offset = endOfCard(doc, this.last);
        }
        const { text, suffix } = insertion(
            doc.slice(0, offset),
            body,
            doc.slice(offset),
            this.settings,
        );
        editor.replaceRange(text, editor.offsetToPos(offset));
        const end = offset + text.length;
        this.last = { body, suffix, end };
        editor.setCursor(editor.offsetToPos(end));
        this.editorUsed = true;
    }

    /** Writes the editor's pending changes to disk, so a rescan sees the new cards */
    async flush(): Promise<void> {
        const view = this.view;
        if (this.editorUsed && view !== null && view.file?.path === this.file.path) {
            await view.save();
        }
    }

    /** The editor, if it still shows the note in editing mode (not reading view) */
    private usableView(): MarkdownView | null {
        const view = this.view;
        if (view === null || view.file?.path !== this.file.path || view.getMode() !== "source")
            return null;
        return view;
    }
}

/**
 * Text to insert between before and after for a new card, and the line breaks after the card.
 * If before ends inside a card that only the end marker would close (e.g. a last card left
 * without it), the end marker goes first, else the new card would join that card.
 */
function insertion(
    before: string,
    body: string,
    after: string,
    settings: SRSettings,
): { text: string; suffix: string } {
    let closing = "";
    if (endsInsideCard(before, settings))
        closing = cardInsertion(before, settings.multilineCardEndMarker);
    const card = cardInsertion(before + closing, body, after);
    return { text: closing + card, suffix: card.slice(card.lastIndexOf(body) + body.length) };
}

/** Whether text ends inside a card that isn't closed yet, with an end marker set */
function endsInsideCard(text: string, settings: SRSettings): boolean {
    if (!settings.multilineCardEndMarker) return false;
    const content = splitNoteIntoFrontmatterAndContent(text)[1];
    const questions = parse(content, settings);
    const last = questions[questions.length - 1];
    return (
        last !== undefined &&
        !isSingleLine(last.cardType) &&
        last.lastLineNum === splitTextIntoLineArray(content).length - 1
    );
}

/**
 * Where the card inserted last ends, with the line breaks inserted after it; `end` was that offset
 * right after inserting it. The note may have changed since (e.g. by sync or another plugin), so
 * the card is looked up by its text: the occurrence nearest to `end` that is the whole card, i.e.
 * with a blank line (or the start/end of the note) before and after it. If it is gone or changed,
 * the end of the note.
 */
export function endOfCard(
    doc: string,
    card: { body: string; suffix: string; end: number },
): number {
    const { body, suffix, end } = card;
    const isCard = (i: number) => wholeCardAt(doc, i, body);
    const start = end - suffix.length - body.length;
    if (doc.slice(start, end) === body + suffix && isCard(start)) return end;
    let best = -1;
    for (let i = doc.indexOf(body); i !== -1; i = doc.indexOf(body, i + 1)) {
        if (!isCard(i)) continue;
        if (best === -1 || Math.abs(i + body.length - end) < Math.abs(best - end))
            best = i + body.length;
    }
    if (best === -1) return doc.length;
    return doc.startsWith(suffix, best) ? best + suffix.length : best;
}

/** Whether body at offset i in doc is a block of its own: whole lines, blank lines around it */
function wholeCardAt(doc: string, i: number, body: string): boolean {
    const end = i + body.length;
    if (i > 0 && doc[i - 1] !== "\n") return false;
    if (end < doc.length && doc[end] !== "\n") return false;
    const lineBefore = doc.slice(doc.lastIndexOf("\n", i - 2) + 1, Math.max(i - 1, 0));
    const lineAfter = doc.slice(end + 1).split("\n", 1)[0];
    return lineBefore.trim() === "" && lineAfter.trim() === "";
}

/**
 * The line after which a card is inserted, for the cursor on cursorLine (0-based):
 * the cursor's line, or the end of the block it is in, so that the new card doesn't go into
 * the frontmatter, a card (or between a card and its schedule comment), a code block or
 * the middle of a paragraph.
 */
export function insertionLine(text: string, cursorLine: number, settings: SRSettings): number {
    const lines = splitTextIntoLineArray(text);
    let line = Math.min(Math.max(cursorLine, 0), lines.length - 1);

    // The frontmatter: right after it
    const [frontmatter, content] = splitNoteIntoFrontmatterAndContent(text);
    const frontmatterLines = frontmatter === "" ? 0 : splitTextIntoLineArray(frontmatter).length;
    if (line < frontmatterLines) return frontmatterLines - 1;

    const blocks: { first: number; last: number }[] = [];
    const endMarker = settings.multilineCardEndMarker;
    const questions = parse(content, settings);
    for (const question of questions) {
        let last = question.lastLineNum;
        // The end marker's line belongs to the card
        if (endMarker && lines[last + 1]?.trim() === endMarker) last++;
        blocks.push({ first: question.firstLineNum, last });
    }
    for (let i = frontmatterLines; i < lines.length; i++) {
        const fence = lines[i].match(/^(`{3,}|~{3,})/);
        if (!fence) continue;
        let close = i + 1;
        while (close < lines.length && !lines[close].startsWith(fence[1])) close++;
        blocks.push({ first: i, last: Math.min(close, lines.length - 1) });
        i = close;
    }

    for (;;) {
        const block = blocks.find((b) => b.first <= line && line < b.last);
        if (block) {
            line = block.last;
            continue;
        }
        // Lines without a blank line between them belong together, e.g. a card and its
        // schedule comment. A heading is a block of its own.
        const current = lines[line];
        const next = lines[line + 1];
        if (
            current.trim() !== "" &&
            !isHeading(current) &&
            next !== undefined &&
            next.trim() !== "" &&
            !isHeading(next)
        ) {
            line++;
            continue;
        }
        return line;
    }
}

function isHeading(line: string): boolean {
    return /^#{1,6}\s/.test(line);
}
