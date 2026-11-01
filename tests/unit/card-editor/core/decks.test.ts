import { deckNames, noteDecks } from "src/card-editor/core/decks";
import { ISRNoteTFile } from "src/data/data-structures/file/note-file";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";

import { unitTestGetAllTagsFromTextEx } from "../../helpers/unit-test-helper";

/** A note whose text is its tags, on one line */
const note = (path: string, tags: string[], text = tags.join(" ")) => {
    const n = { path, text, getAllTagsFromText: () => unitTestGetAllTagsFromTextEx(text) };
    return n as unknown as ISRNoteTFile & { text: string };
};

/** For a card added at the end of the note */
const decksOf = (n: ISRNoteTFile & { text: string }, settings: SRSettings = DEFAULT_SETTINGS) =>
    deckNames(noteDecks(n, n.text, n.text.split("\n").length, settings), settings);

describe("deck line", () => {
    test("flashcard tags: the deck below the tag, the tag itself by its name", () => {
        expect(decksOf(note("bio.md", ["#flashcards/medicine", "#todo"]))).toEqual(["medicine"]);
        expect(decksOf(note("bio.md", ["#flashcards"]))).toEqual(["flashcards"]);
        expect(
            decksOf(note("bio.md", ["#flashcards/a/b", "#flashcards/c", "#flashcards/c"])),
        ).toEqual(["a/b", "c"]);
    });

    test("the tags that apply where the card goes, by SR's parser", () => {
        const text =
            "---\ntags:\n  - flashcards/top\n---\nIntro\n\n#flashcards/a\nQ::A\n\n#flashcards/b\n";
        const n = note("bio.md", [], text);
        const at = (line: number) =>
            deckNames(noteDecks(n, text, line, DEFAULT_SETTINGS), DEFAULT_SETTINGS);
        expect(at(5)).toEqual(["top"]);
        expect(at(7)).toEqual(["a"]);
        expect(at(11)).toEqual(["b"]);
        // A tag in a card is that card's own, not the note's
        const own = "#flashcards/a\n\n#flashcards/x Q::A\n";
        expect(
            deckNames(
                noteDecks(note("bio.md", [], own), own, 4, DEFAULT_SETTINGS),
                DEFAULT_SETTINGS,
            ),
        ).toEqual(["a"]);
    });

    test("folders as decks: the note's folder path", () => {
        const settings = { ...DEFAULT_SETTINGS, convertFoldersToDecks: true };
        expect(decksOf(note("Biology/Cells/bio.md", ["#flashcards/x"]), settings)).toEqual([
            "Biology/Cells",
        ]);
    });

    test("none: no flashcard tag, or a note at the top with folders as decks", () => {
        expect(decksOf(note("bio.md", ["#todo"]))).toEqual([]);
        const settings = { ...DEFAULT_SETTINGS, convertFoldersToDecks: true };
        expect(decksOf(note("bio.md", []), settings)).toEqual([]);
    });
});
