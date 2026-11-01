import { App, EditorPosition, MarkdownView, TFile } from "obsidian";

import { CardInserter, insertionLine } from "src/card-editor/card-inserter";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { parse, ParserOptions } from "src/parser";

const parserOptions = (settings: SRSettings): ParserOptions => ({
    singleLineCardSeparator: settings.singleLineCardSeparator,
    singleLineReversedCardSeparator: settings.singleLineReversedCardSeparator,
    multilineCardSeparator: settings.multilineCardSeparator,
    multilineReversedCardSeparator: settings.multilineReversedCardSeparator,
    multilineCardEndMarker: settings.multilineCardEndMarker,
    clozePatterns: settings.clozePatterns,
});

/** A text editor over a string, with the part of Obsidian's Editor API the inserter uses */
class FakeEditor {
    value: string;
    cursor: EditorPosition;

    constructor(value: string, cursor: EditorPosition) {
        this.value = value;
        this.cursor = cursor;
    }

    getValue = () => this.value;
    getCursor = () => this.cursor;
    getLine = (line: number) => this.value.split("\n")[line];
    setCursor = jest.fn((pos: EditorPosition) => (this.cursor = pos));

    posToOffset(pos: EditorPosition): number {
        const lines = this.value.split("\n").slice(0, pos.line);
        return lines.reduce((sum, l) => sum + l.length + 1, 0) + pos.ch;
    }

    offsetToPos(offset: number): EditorPosition {
        const lines = this.value.slice(0, offset).split("\n");
        return { line: lines.length - 1, ch: lines[lines.length - 1].length };
    }

    replaceRange = jest.fn((text: string, from: EditorPosition) => {
        const offset = this.posToOffset(from);
        this.value = this.value.slice(0, offset) + text + this.value.slice(offset);
    });
}

const file = { path: "notes/bio.md", basename: "bio", extension: "md" } as TFile;

let disk: string;
let app: App;
const vaultProcess = jest.fn((_f: TFile, fn: (data: string) => string) => {
    disk = fn(disk);
    return Promise.resolve(disk);
});

interface FakeView {
    file: TFile;
    editor: FakeEditor;
    getMode: () => string;
    save: jest.Mock;
}

function viewOf(editor: FakeEditor, mode = "source", viewFile: TFile = file): FakeView {
    return {
        file: viewFile,
        editor,
        getMode: () => mode,
        save: jest.fn(() => Promise.resolve()),
    };
}

const inserterFor = (view: FakeView | null) =>
    new CardInserter(app, file, view as unknown as MarkdownView | null, DEFAULT_SETTINGS);

beforeEach(() => {
    disk = "";
    vaultProcess.mockClear();
    app = { vault: { process: vaultProcess } } as unknown as App;
});

describe("inserting into the editor", () => {
    test("the first card goes below the cursor line, the next ones after it", async () => {
        const editor = new FakeEditor("#flashcards\nSome text here\n\nMore text", {
            line: 1,
            ch: 4,
        });
        const inserter = inserterFor(viewOf(editor));

        await inserter.insert("Q1\n?\nA1");
        await inserter.insert("Q2\n?\nA2");

        expect(editor.value).toEqual(
            "#flashcards\nSome text here\n\nQ1\n?\nA1\n\nQ2\n?\nA2\n\nMore text",
        );
        expect(editor.cursor).toEqual(editor.offsetToPos(editor.value.indexOf("\n\nMore")));
        expect(vaultProcess).not.toHaveBeenCalled();
    });

    test("the next card follows the last one, even if the note changed above it meanwhile", async () => {
        const editor = new FakeEditor("#flashcards\nIntro\n\nMore text", { line: 1, ch: 0 });
        const inserter = inserterFor(viewOf(editor));
        await inserter.insert("Q1\n?\nA1");

        // E.g. sync pulls in a change near the top of the open note
        editor.value = editor.value.replace("Intro", "Intro, now with forty more characters in it");
        await inserter.insert("Q2\n?\nA2");

        expect(editor.value).toEqual(
            "#flashcards\nIntro, now with forty more characters in it\n\nQ1\n?\nA1\n\nQ2\n?\nA2\n\nMore text",
        );
    });

    test("if the last card is gone or changed, the next one goes to the end of the note", async () => {
        const editor = new FakeEditor("#flashcards\nIntro\n\nMore text", { line: 1, ch: 0 });
        const inserter = inserterFor(viewOf(editor));
        await inserter.insert("Q\n?\nA");

        // Only a partial match left: the answer was changed
        editor.value = editor.value.replace("\nA\n", "\nAnswer\n");
        await inserter.insert("Q2\n?\nA2");

        expect(editor.value).toEqual(
            "#flashcards\nIntro\n\nQ\n?\nAnswer\n\nMore text\n\nQ2\n?\nA2\n",
        );
    });

    test("flush saves the editor once a card went into it", async () => {
        const view = viewOf(new FakeEditor("#flashcards", { line: 0, ch: 0 }));
        const inserter = inserterFor(view);

        await inserter.flush();
        expect(view.save).not.toHaveBeenCalled();

        await inserter.insert("Q\n?\nA");
        await inserter.flush();
        expect(view.save).toHaveBeenCalledTimes(1);
    });
});

test("the first card doesn't go inside frontmatter, a card, a code block or a paragraph", () => {
    const at = (text: string, cursorLine: number, settings: Partial<SRSettings> = {}) =>
        insertionLine(text, cursorLine, { ...DEFAULT_SETTINGS, ...settings });

    expect(at("---\ntags: flashcards\n---\nIntro", 1)).toEqual(2);
    // Between a card and its schedule comment
    expect(at("Q\n?\nA\n<!--SR:!2026-11-05,3,250-->\n\nText", 2)).toEqual(3);
    // A card with an end marker may have blank lines
    expect(at("Q\n?\nA\n\nmore A\n+++\nText", 3, { multilineCardEndMarker: "+++" })).toEqual(6);
    expect(at("Intro\n\n```\ncode\n\nmore code\n```\n\nline 1\nline 2\n\nEnd", 4)).toEqual(6);
    expect(at("Intro\n\nline 1\nline 2\n\nEnd", 2)).toEqual(3);
});

test("without an editor on the note, cards are appended to the note", async () => {
    disk = "#flashcards\n";
    const view = viewOf(new FakeEditor("", { line: 0, ch: 0 }), "preview");
    const inserter = inserterFor(view);

    await inserter.insert("Q1\n?\nA1");
    await inserter.insert("Q2\n?\nA2");

    expect(disk).toEqual("#flashcards\n\nQ1\n?\nA1\n\nQ2\n?\nA2\n");
    expect(view.editor.replaceRange).not.toHaveBeenCalled();
});

test("appending after a last card without its end marker adds the marker first", async () => {
    const settings = { ...DEFAULT_SETTINGS, multilineCardEndMarker: "+++" };
    disk = "#flashcards\n\nQ1\n?\nA1\n";
    await new CardInserter(app, file, null, settings).insert("Q2\n?\nA2\n\n+++");

    expect(disk).toEqual("#flashcards\n\nQ1\n?\nA1\n\n+++\n\nQ2\n?\nA2\n\n+++\n");
    const questions = parse(disk, parserOptions(settings));
    expect(questions.map((q) => q.text)).toEqual(["Q1\n?\nA1", "Q2\n?\nA2"]);
});
