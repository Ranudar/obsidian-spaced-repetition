import { deckNames, noteDecks } from "src/card-editor/core/decks";
import { ISRNoteTFile } from "src/data/data-structures/file/note-file";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";

const note = (path: string, tags: string[]) =>
    ({ path, getAllTagsFromCache: () => tags }) as unknown as ISRNoteTFile;

const decksOf = (n: ISRNoteTFile, settings: SRSettings = DEFAULT_SETTINGS) =>
    deckNames(noteDecks(n, settings), settings);

describe("deck line", () => {
    test("flashcard tags: the deck below the tag, the tag itself by its name", () => {
        expect(decksOf(note("bio.md", ["#flashcards/medicine", "#todo"]))).toEqual(["medicine"]);
        expect(decksOf(note("bio.md", ["#flashcards"]))).toEqual(["flashcards"]);
        expect(
            decksOf(note("bio.md", ["#flashcards/a/b", "#flashcards/c", "#flashcards/c"])),
        ).toEqual(["a/b", "c"]);
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
