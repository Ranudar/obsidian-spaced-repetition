import { App, MarkdownView, TFile } from "obsidian";

import { cardInsertion } from "src/card-editor/core/card-text";
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
    /** Document offset where the next card goes, once the first card went into the editor */
    private offset: number | null = null;
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
            await this.app.vault.process(this.file, (data) => data + cardInsertion(data, body));
            return;
        }

        const editor = view.editor;
        const doc = editor.getValue();
        if (this.offset === null) {
            // First card: below the cursor, after the block the cursor is in
            const line = insertionLine(doc, editor.getCursor().line, this.settings);
            this.offset = editor.posToOffset({ line, ch: editor.getLine(line).length });
        }
        const offset = Math.min(this.offset, doc.length);
        const text = cardInsertion(doc.slice(0, offset), body, doc.slice(offset));
        editor.replaceRange(text, editor.offsetToPos(offset));
        this.offset = offset + text.length;
        editor.setCursor(editor.offsetToPos(this.offset));
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
    const questions = parse(content, {
        singleLineCardSeparator: settings.singleLineCardSeparator,
        singleLineReversedCardSeparator: settings.singleLineReversedCardSeparator,
        multilineCardSeparator: settings.multilineCardSeparator,
        multilineReversedCardSeparator: settings.multilineReversedCardSeparator,
        multilineCardEndMarker: endMarker,
        clozePatterns: settings.clozePatterns,
    });
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
