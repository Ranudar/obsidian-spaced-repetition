import { removeQuestionText } from "src/data/data-store/notes-data-store/notes-data-store";
import { CardType } from "src/data/data-structures/card/questions/question";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";

const withMarker: SRSettings = { ...DEFAULT_SETTINGS, multilineCardEndMarker: "---" };
const first = "![[a.svg]]\n?\n![[b.svg]]\n<!--SR:!2026-11-02,1,230-->";
const note = `#flashcards\n\n${first}\n\n---\n\nQ2\n?\nA2\n\n---\n`;

describe("removeQuestionText", () => {
    test("a multi-line card goes with its end marker and one of the blank lines around it", () => {
        expect(removeQuestionText(note, first, CardType.MultiLineBasic, withMarker)).toBe(
            "#flashcards\n\nQ2\n?\nA2\n\n---\n",
        );
        expect(removeQuestionText(note, "Q2\n?\nA2", CardType.MultiLineBasic, withMarker)).toBe(
            `#flashcards\n\n${first}\n\n---\n`,
        );
        expect(
            removeQuestionText("Q\n?\nA\n\n---\n\nnext", "Q\n?\nA", CardType.MultiLineBasic, withMarker),
        ).toBe("next");
    });

    test("without an end marker set, a --- after the card is a horizontal rule and stays", () => {
        expect(
            removeQuestionText("a\n\nQ\n?\nA\n\n---\n\nb", "Q\n?\nA", CardType.MultiLineBasic, DEFAULT_SETTINGS),
        ).toBe("a\n\n---\n\nb");
    });

    test("a single-line card leaves the end marker of the card before it", () => {
        expect(
            removeQuestionText("Q\n?\nA\n\n---\nX::Y\nb", "X::Y", CardType.SingleLineBasic, withMarker),
        ).toBe("Q\n?\nA\n\n---\nb");
    });

    test("null when the card is not in the note", () => {
        expect(removeQuestionText(note, "gone", CardType.MultiLineBasic, withMarker)).toBeNull();
    });
});
