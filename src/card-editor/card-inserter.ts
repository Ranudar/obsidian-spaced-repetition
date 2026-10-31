import { App, MarkdownView, TFile } from "obsidian";

import { cardInsertion } from "src/card-editor/core/card-text";

/**
 * Inserts new cards into a note: below the cursor when the note is open in an editor,
 * else at the end of the note. Consecutive cards go one after the other.
 */
export class CardInserter {
    private app: App;
    private file: TFile;
    private view: MarkdownView | null;
    /** Document offset where the next card goes, once the first card went into the editor */
    private offset: number | null = null;
    /** Set when a card was inserted through the editor, whose changes may not be on disk yet */
    private editorUsed = false;

    /** view: the editor the command was run from, if any */
    constructor(app: App, file: TFile, view: MarkdownView | null) {
        this.app = app;
        this.file = file;
        this.view = view;
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
            // First card: right after the line the cursor is on
            const cursor = editor.getCursor();
            this.offset = editor.posToOffset({
                line: cursor.line,
                ch: editor.getLine(cursor.line).length,
            });
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
