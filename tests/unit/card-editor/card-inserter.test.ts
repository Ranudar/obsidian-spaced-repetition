import { App, EditorPosition, MarkdownView, TFile } from "obsidian";

import { CardInserter, endOfCard, insertionLine } from "src/card-editor/card-inserter";
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

    test("at the end of the document", async () => {
        const editor = new FakeEditor("#flashcards", { line: 0, ch: 0 });
        const inserter = inserterFor(viewOf(editor));

        await inserter.insert("Q1\n?\nA1");
        await inserter.insert("Q2\n?\nA2");

        expect(editor.value).toEqual("#flashcards\n\nQ1\n?\nA1\n\nQ2\n?\nA2\n");
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

    test("if the last card is gone, the next one goes to the end of the note", async () => {
        const editor = new FakeEditor("#flashcards\nIntro\n\nMore text", { line: 1, ch: 0 });
        const inserter = inserterFor(viewOf(editor));
        await inserter.insert("Q1\n?\nA1");

        editor.value = "#flashcards\nIntro\n\nMore text";
        await inserter.insert("Q2\n?\nA2");

        expect(editor.value).toEqual("#flashcards\nIntro\n\nMore text\n\nQ2\n?\nA2\n");
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

describe("where the first card goes", () => {
    const at = (text: string, cursorLine: number, settings: Partial<SRSettings> = {}) =>
        insertionLine(text, cursorLine, { ...DEFAULT_SETTINGS, ...settings });

    test("not inside the frontmatter", () => {
        const text = "---\ntags: flashcards\n---\nIntro\n\nMore";
        expect(at(text, 0)).toEqual(2);
        expect(at(text, 1)).toEqual(2);
        expect(at(text, 2)).toEqual(2);
        expect(at(text, 3)).toEqual(3);
    });

    test("not between a card and its schedule comment", () => {
        const text =
            "#flashcards\n\nQ\n?\nA\n<!--SR:!2026-11-05,3,250-->\n\nQ2::A2\n<!--SR:!2026-11-05,3,250-->";
        for (const line of [2, 3, 4, 5]) expect(at(text, line)).toEqual(5);
        expect(at(text, 7)).toEqual(8);
    });

    test("not inside a card with an end marker, which may have blank lines", () => {
        const text = "Q\n?\nA\n\nmore A\n+++\nText";
        for (const line of [0, 2, 3, 4, 5])
            expect(at(text, line, { multilineCardEndMarker: "+++" })).toEqual(6);
    });

    test("not inside a code block or a paragraph", () => {
        const text = "Intro\n\n```\ncode\n\nmore code\n```\n\nline 1\nline 2\n\nEnd";
        expect(at(text, 3)).toEqual(6);
        expect(at(text, 4)).toEqual(6);
        expect(at(text, 8)).toEqual(9);
    });

    test("below the cursor's line on a blank line or a heading", () => {
        const text = "# Heading\nText\n\n## Next\nMore";
        expect(at(text, 0)).toEqual(0);
        expect(at(text, 1)).toEqual(1);
        expect(at(text, 2)).toEqual(2);
    });

    test("in the editor: the card goes after the frontmatter, keeping it intact", async () => {
        const editor = new FakeEditor("---\ntags: flashcards\n---\n\nText", { line: 0, ch: 0 });
        await inserterFor(viewOf(editor)).insert("Q\n?\nA");
        expect(editor.value).toEqual("---\ntags: flashcards\n---\n\nQ\n?\nA\n\nText");
    });
});

describe("appending to the note", () => {
    test.each([
        ["no editor", null],
        ["reading view", viewOf(new FakeEditor("", { line: 0, ch: 0 }), "preview")],
        [
            "an editor showing another note",
            viewOf(new FakeEditor("", { line: 0, ch: 0 }), "source", {
                path: "other.md",
            } as TFile),
        ],
    ])("with %s, cards go to the end of the note", async (_name, view) => {
        disk = "#flashcards\n";
        const inserter = inserterFor(view);

        await inserter.insert("Q1\n?\nA1");
        await inserter.insert("Q2\n?\nA2");

        expect(disk).toEqual("#flashcards\n\nQ1\n?\nA1\n\nQ2\n?\nA2\n");
        expect(vaultProcess).toHaveBeenCalledWith(file, expect.any(Function));
        if (view) expect(view.editor.replaceRange).not.toHaveBeenCalled();

        await inserter.flush();
        if (view) expect(view.save).not.toHaveBeenCalled();
    });
});

describe("closing a card left open at the insertion point", () => {
    const settings = { ...DEFAULT_SETTINGS, multilineCardEndMarker: "+++" };
    const inserter = (view: FakeView | null) =>
        new CardInserter(app, file, view as unknown as MarkdownView | null, settings);
    const body = "Q2\n?\nA2\n\n+++";

    test("appending after a last card without its end marker adds the marker first", async () => {
        disk = "#flashcards\n\nQ1\n?\nA1\n";
        await inserter(null).insert(body);

        expect(disk).toEqual("#flashcards\n\nQ1\n?\nA1\n\n+++\n\nQ2\n?\nA2\n\n+++\n");
        const questions = parse(disk, parserOptions(settings));
        expect(questions.map((q) => q.text)).toEqual(["Q1\n?\nA1", "Q2\n?\nA2"]);
    });

    test("inserting in the editor after a last card without its end marker", async () => {
        const editor = new FakeEditor("#flashcards\n\nQ1\n?\nA1", { line: 2, ch: 0 });
        await inserter(viewOf(editor)).insert(body);
        await inserter(viewOf(editor)).insert(body.replaceAll("2", "3"));

        expect(editor.value).toEqual(
            "#flashcards\n\nQ1\n?\nA1\n\n+++\n\nQ2\n?\nA2\n\n+++\n\nQ3\n?\nA3\n\n+++\n",
        );
    });

    test("no marker after a closed card, a single-line card or text", async () => {
        for (const note of ["Q1\n?\nA1\n+++\n", "Q1::A1\n", "Some text\n"]) {
            disk = note;
            await inserter(null).insert(body);
            expect(disk).toEqual(note + "\n" + body + "\n");
        }
    });
});

describe("finding the card inserted last", () => {
    test("a partial match isn't the card: after a changed answer the next card goes to the end", async () => {
        const editor = new FakeEditor("#flashcards", { line: 0, ch: 0 });
        const inserter = inserterFor(viewOf(editor));
        await inserter.insert("Q\n?\nA");

        editor.value = editor.value.replace("\nA\n", "\nAnswer\n");
        await inserter.insert("Q2\n?\nA2");

        expect(editor.value).toEqual("#flashcards\n\nQ\n?\nAnswer\n\nQ2\n?\nA2\n");
    });

    test("the card's text inside a longer card isn't the card", () => {
        const card = { body: "Q\n?\nA", suffix: "\n", end: 19 };
        for (const doc of [
            "#flashcards\n\nQ\n?\nA\nmore answer\n\nEnd",
            "#flashcards\n\nXQ\n?\nA\n\nEnd",
        ])
            expect(endOfCard(doc, card)).toEqual(doc.length);
        expect(endOfCard("#flashcards\n\nQ\n?\nA\n\nEnd", card)).toEqual(19);
    });
});
