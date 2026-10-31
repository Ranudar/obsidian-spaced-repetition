import {
    cardInsertion,
    cardSeparator,
    composeCardText,
    inkEmbed,
    inkEmbedFileName,
    inkEmbedFileNames,
    newCardBody,
    splitCardText,
} from "src/card-editor/core/card-text";
import { CardType, Question } from "src/data/data-structures/card/questions/question";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { setupStaticDateProvider20230906 } from "src/utils/dates";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "../../helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "../../helpers/unit-test-setup";
import { createTestNoteQuestionParser } from "../../sample-items";

const END_MARKER_SETTINGS: SRSettings = { ...DEFAULT_SETTINGS, multilineCardEndMarker: "---" };

// Cards of every type whose sides contain separators, tables, LaTeX, lists and ink embeds
const noteText: string = `#flashcards

When plugged in, bad chargers spark 80% of the time. What's the probability that a sparking charger is bad?
?
**Prior odds:** $\\text{bad} : \\text{good} = 3 : 97$
**Probability:** $\\frac{48}{48 + 97} \\approx 33\\%$
<!--SR:!2026-10-27,0,250-->

What is the sensitivity of a test?
?
The true positive rate: $P(\\text{positive} \\mid \\text{sick})$<br>
|          | Test positive | Test negative |
| -------- | ------------- | ------------- |
| **Sick** | **TP**        | **FN**        |

Set up and solve:
- The test is negative, what's the probability of being pregnant nevertheless?
?
1. Posterior: is it "pregnant"?
2. Prior: pregnant : not pregnant $= 30 : 70$.

Is $P(E \\mid H) = P(H \\mid E)$?::No, it's conditioned the other way round?

Mitochondria:::Powerhouse of the cell::really

Capital of France
??
Paris

![[pencards/pencard-20261031-141502123-front.svg]]
?
![[pencards/pencard-20261031-141502123-back.svg]]

The odds form of Bayes' rule has these parts:
* ==prior odds==
* ==likelihood ratio==
`;

async function parseQuestions(text: string, settings: SRSettings): Promise<Question[]> {
    const parser = createTestNoteQuestionParser(settings);
    return parser.createQuestionList(
        new UnitTestSRFile(text),
        TextDirection.Ltr,
        TopicPath.emptyPath,
        true,
    );
}

function split(question: Question, settings: SRSettings = DEFAULT_SETTINGS) {
    return splitCardText(question.questionType, question.questionText.actualQuestion, settings);
}

beforeAll(() => {
    setupStaticDateProvider20230906();
    unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS);
});

describe("splitCardText", () => {
    test("Splits multi-line cards only at the separator line", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        expect(split(questions[0])).toEqual({
            front: "When plugged in, bad chargers spark 80% of the time. What's the probability that a sparking charger is bad?",
            back: "**Prior odds:** $\\text{bad} : \\text{good} = 3 : 97$\n**Probability:** $\\frac{48}{48 + 97} \\approx 33\\%$",
        });
        expect(split(questions[2])).toEqual({
            front: "Set up and solve:\n- The test is negative, what's the probability of being pregnant nevertheless?",
            back: '1. Posterior: is it "pregnant"?\n2. Prior: pregnant : not pregnant $= 30 : 70$.',
        });
    });

    test("Splits single-line cards at the first separator", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        expect(questions[3].questionType).toEqual(CardType.SingleLineBasic);
        expect(split(questions[3])).toEqual({
            front: "Is $P(E \\mid H) = P(H \\mid E)$?",
            back: "No, it's conditioned the other way round?",
        });
        expect(questions[4].questionType).toEqual(CardType.SingleLineReversed);
        expect(split(questions[4])).toEqual({
            front: "Mitochondria",
            back: "Powerhouse of the cell::really",
        });
    });

    test("Splits reversed multi-line cards", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        expect(questions[5].questionType).toEqual(CardType.MultiLineReversed);
        expect(split(questions[5])).toEqual({ front: "Capital of France", back: "Paris" });
    });

    test("Cloze cards have no back", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        const cloze = questions[7];
        expect(cloze.questionType).toEqual(CardType.Cloze);
        expect(split(cloze)).toEqual({
            front: cloze.questionText.actualQuestion,
            back: null,
        });
    });

    test("Ink sides are found in split sides", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        const { front, back } = split(questions[6]);
        expect(inkEmbedFileName(front)).toEqual("pencard-20261031-141502123-front.svg");
        expect(inkEmbedFileName(back)).toEqual("pencard-20261031-141502123-back.svg");
    });
});

describe("composeCardText", () => {
    test("Split and compose round trip for every card type", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        expect(questions.length).toEqual(8);
        const types = new Set(questions.map((q) => q.questionType));
        expect(types.size).toEqual(5);

        for (const question of questions) {
            const { front, back } = split(question);
            expect(
                composeCardText(question.questionType, front, back, DEFAULT_SETTINGS),
                `${CardType[question.questionType]}: ${front}`,
            ).toEqual(question.questionText.actualQuestion);
        }
    });

    test("Round trip with an end marker and blank lines inside the back", async () => {
        const text = `#flashcards

First line
second line
?
Answer

with a gap

---

Single::line

---
`;
        const questions = await parseQuestions(text, END_MARKER_SETTINGS);
        expect(questions.length).toEqual(2);
        expect(split(questions[0], END_MARKER_SETTINGS)).toEqual({
            front: "First line\nsecond line",
            back: "Answer\n\nwith a gap",
        });
        for (const question of questions) {
            const { front, back } = split(question, END_MARKER_SETTINGS);
            expect(
                composeCardText(question.questionType, front, back, END_MARKER_SETTINGS),
            ).toEqual(question.questionText.actualQuestion);
        }
    });

    test("Edited sides are composed with the card type's separator", () => {
        const s = DEFAULT_SETTINGS;
        expect(composeCardText(CardType.SingleLineBasic, "Q", "A", s)).toEqual("Q::A");
        expect(composeCardText(CardType.SingleLineReversed, "Q", "A", s)).toEqual("Q:::A");
        expect(composeCardText(CardType.MultiLineBasic, "Q", "A", s)).toEqual("Q\n?\nA");
        expect(composeCardText(CardType.MultiLineReversed, "Q", "A", s)).toEqual("Q\n??\nA");
        expect(composeCardText(CardType.Cloze, "a ==b==", null, s)).toEqual("a ==b==");
        expect(composeCardText(CardType.Cloze, "a ==b==", "ignored", s)).toEqual("a ==b==");
    });

    test("Line breaks around the multi-line separator are not doubled", () => {
        const s = DEFAULT_SETTINGS;
        expect(composeCardText(CardType.MultiLineBasic, "Q\n", "A", s)).toEqual("Q\n?\nA");
        expect(composeCardText(CardType.MultiLineBasic, "Q", "\nA", s)).toEqual("Q\n?\nA");
        expect(composeCardText(CardType.MultiLineBasic, "Q\n", "\nA", s)).toEqual("Q\n?\nA");
        expect(composeCardText(CardType.MultiLineBasic, "Q", null, s)).toEqual("Q\n?\n");
    });

    test("A changed ink side composes to a parsable card", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        const question = questions[0];
        const { front } = split(question);
        const changed = composeCardText(
            question.questionType,
            front,
            inkEmbed("pencards/pencard-x-back.svg"),
            DEFAULT_SETTINGS,
        );
        const [reparsed] = await parseQuestions(`#flashcards\n\n${changed}\n`, DEFAULT_SETTINGS);
        expect(split(reparsed)).toEqual({ front, back: "![[pencards/pencard-x-back.svg]]" });
    });
});

describe("cardSeparator", () => {
    test("Uses the separators from the settings", () => {
        const s: SRSettings = {
            ...DEFAULT_SETTINGS,
            singleLineCardSeparator: ";;",
            singleLineReversedCardSeparator: ";;;",
            multilineCardSeparator: "%%",
            multilineReversedCardSeparator: "%%%",
        };
        expect(cardSeparator(CardType.SingleLineBasic, s)).toEqual(";;");
        expect(cardSeparator(CardType.SingleLineReversed, s)).toEqual(";;;");
        expect(cardSeparator(CardType.MultiLineBasic, s)).toEqual("%%");
        expect(cardSeparator(CardType.MultiLineReversed, s)).toEqual("%%%");
        expect(cardSeparator(CardType.Cloze, s)).toBeNull();
    });
});

describe("inkEmbedFileName", () => {
    test("Wiki embeds", () => {
        expect(inkEmbedFileName("![[pencard-a-front.svg]]")).toEqual("pencard-a-front.svg");
        expect(inkEmbedFileName("![[pencards/pencard-a-back.svg]]")).toEqual("pencard-a-back.svg");
        expect(inkEmbedFileName("  ![[deep/folder name/pencard-a-back.svg]]\n")).toEqual(
            "pencard-a-back.svg",
        );
        expect(inkEmbedFileName("![[pencards/pencard-a-back.svg|300]]")).toEqual(
            "pencard-a-back.svg",
        );
        expect(inkEmbedFileName("![[pencard-a-back.SVG]]")).toEqual("pencard-a-back.SVG");
    });

    test("Markdown embeds incl. url-encoded and bracketed paths", () => {
        expect(inkEmbedFileName("![](pencards/pencard-a-front.svg)")).toEqual(
            "pencard-a-front.svg",
        );
        expect(inkEmbedFileName("![ink](my%20cards/pencard-a%20b-front.svg)")).toEqual(
            "pencard-a b-front.svg",
        );
        expect(inkEmbedFileName("![](<my cards/pencard-a-back.svg>)")).toEqual(
            "pencard-a-back.svg",
        );
        expect(inkEmbedFileName('![](pencards/pencard-a-back.svg "title")')).toEqual(
            "pencard-a-back.svg",
        );
        // Not valid url-encoding: used as is
        expect(inkEmbedFileName("![](pencard-100%-back.svg)")).toEqual("pencard-100%-back.svg");
    });

    test("Anything but exactly one ink embed is text", () => {
        expect(inkEmbedFileName("")).toBeNull();
        expect(inkEmbedFileName("pencard-a-front.svg")).toBeNull();
        expect(inkEmbedFileName("[[pencard-a-front.svg]]")).toBeNull();
        expect(inkEmbedFileName("[x](pencard-a-front.svg)")).toBeNull();
        expect(inkEmbedFileName("![[photo.svg]]")).toBeNull();
        expect(inkEmbedFileName("![[pencard-a-front.png]]")).toBeNull();
        expect(inkEmbedFileName("![[pencards/pencard-a-front.svg/other.svg]]")).toBeNull();
        expect(inkEmbedFileName("Look: ![[pencard-a-front.svg]]")).toBeNull();
        expect(inkEmbedFileName("![[pencard-a-front.svg]] and text")).toBeNull();
        expect(inkEmbedFileName("![[pencard-a-front.svg]]\n![[pencard-b-front.svg]]")).toBeNull();
        expect(inkEmbedFileName("![[pencard-a-front.svg]]![[pencard-b-front.svg]]")).toBeNull();
        expect(inkEmbedFileName("![](pencard-a-front.svg) ![](pencard-b-front.svg)")).toBeNull();
        expect(inkEmbedFileName("![](https://example.com/photo.svg)")).toBeNull();
    });

    test("inkEmbed creates a detectable wiki embed", () => {
        expect(inkEmbed("pencards/pencard-x-front.svg")).toEqual(
            "![[pencards/pencard-x-front.svg]]",
        );
        expect(inkEmbedFileName(inkEmbed("pencards/pencard-x-front.svg"))).toEqual(
            "pencard-x-front.svg",
        );
    });
});

describe("inkEmbedFileNames", () => {
    test("finds ink embeds anywhere in the text, in both embed forms", () => {
        const text = [
            "Label this: ![[pencards/pencard-a-front.svg|200]] and ![[diagram.png]]",
            "?",
            '![drawn](<my%20folder/pencard-b-back.svg>) or ![](pencard-c-back.svg "title")',
            "[[pencard-not-embedded-front.svg]]",
        ].join("\n");
        expect(inkEmbedFileNames(text)).toEqual([
            "pencard-a-front.svg",
            "pencard-b-back.svg",
            "pencard-c-back.svg",
        ]);
    });

    test("no ink embeds", () => {
        expect(inkEmbedFileNames("Q::A ![[photo.svg]]")).toEqual([]);
    });
});

describe("newCardBody", () => {
    const F = "![[f.svg]]";
    const B = "![[b.svg]]";

    test("Default format", () => {
        expect(newCardBody(F, B, DEFAULT_SETTINGS)).toEqual("![[f.svg]]\n?\n![[b.svg]]");
    });

    test("End marker keeps a blank line before it", () => {
        expect(newCardBody(F, B, END_MARKER_SETTINGS)).toEqual("![[f.svg]]\n?\n![[b.svg]]\n\n---");
    });

    test("Uses the multi-line separator from the settings", () => {
        const s: SRSettings = { ...DEFAULT_SETTINGS, multilineCardSeparator: "%%" };
        expect(newCardBody("Q", "A", s)).toEqual("Q\n%%\nA");
    });
});

describe("cardInsertion", () => {
    test("Separates the card from the text before it", () => {
        expect(cardInsertion("", "X")).toEqual("X\n");
        expect(cardInsertion("#flashcards", "X")).toEqual("\n\nX\n");
        expect(cardInsertion("#flashcards\n", "X")).toEqual("\nX\n");
        expect(cardInsertion("#flashcards\n\n", "X")).toEqual("X\n");
        expect(cardInsertion("\n", "X")).toEqual("X\n");
        expect(cardInsertion("  \n", "X")).toEqual("X\n");
    });

    test("Separates the card from the text after it", () => {
        expect(cardInsertion("A", "X", "\nB")).toEqual("\n\nX\n");
        expect(cardInsertion("A", "X", "\n\nB")).toEqual("\n\nX");
        expect(cardInsertion("A", "X", "B")).toEqual("\n\nX\n\n");
        expect(cardInsertion("A\n\n", "X", "B")).toEqual("X\n\n");
    });

    test("Inserting two cards in a row gives two valid cards", async () => {
        let doc = "#flashcards";
        for (let i = 0; i < 2; i++) {
            doc += cardInsertion(doc, newCardBody(`Q${i}`, `A${i}`, DEFAULT_SETTINGS));
        }
        expect(doc).toEqual("#flashcards\n\nQ0\n?\nA0\n\nQ1\n?\nA1\n");

        const questions = await parseQuestions(doc, DEFAULT_SETTINGS);
        expect(questions.map((q) => split(q))).toEqual([
            { front: "Q0", back: "A0" },
            { front: "Q1", back: "A1" },
        ]);
    });

    test("Inserting between paragraphs and with an end marker gives valid cards", async () => {
        const before = "#flashcards\n\nIntro text";
        const after = "\nOutro text\n";
        let insertAt = before;
        let doc = before + after;
        for (let i = 0; i < 2; i++) {
            const body = newCardBody(`Q${i}`, `A${i}`, END_MARKER_SETTINGS);
            const inserted = cardInsertion(insertAt, body, doc.substring(insertAt.length));
            doc = insertAt + inserted + doc.substring(insertAt.length);
            insertAt += inserted;
        }
        expect(doc).toEqual(
            "#flashcards\n\nIntro text\n\nQ0\n?\nA0\n\n---\n\nQ1\n?\nA1\n\n---\n\nOutro text\n",
        );

        const questions = await parseQuestions(doc, END_MARKER_SETTINGS);
        expect(questions.map((q) => split(q, END_MARKER_SETTINGS))).toEqual([
            { front: "Q0", back: "A0" },
            { front: "Q1", back: "A1" },
        ]);
    });
});
