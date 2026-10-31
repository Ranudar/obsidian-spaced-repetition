import {
    cardInsertion,
    cardMarkerLine,
    cardSeparator,
    composeCardText,
    inkEmbed,
    inkEmbedFileName,
    inkEmbedFileNames,
    inkEmbedPath,
    inkEmbedPaths,
    isInkFileName,
    joinSide,
    linksIn,
    misreadSide,
    newCardBody,
    parsesAsCard,
    protectBlankLines,
    splitCardText,
    splitSide,
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

![[sr-ink/sr-ink-20261031-141502123-front.svg]]
?
![[sr-ink/sr-ink-20261031-141502123-back.svg]]

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

function sides(question: Question, settings: SRSettings = DEFAULT_SETTINGS) {
    const { front, back } = split(question, settings);
    return { front, back };
}

/** split, then compose: the text the editor saves for a card that wasn't changed */
function roundTrip(question: Question, settings: SRSettings = DEFAULT_SETTINGS): string {
    const { front, back, separator } = split(question, settings);
    return composeCardText(question.questionType, front, back, settings, separator);
}

beforeAll(() => {
    setupStaticDateProvider20230906();
    unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS);
});

describe("splitCardText", () => {
    test("Splits multi-line cards only at the separator line", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        expect(sides(questions[0])).toEqual({
            front: "When plugged in, bad chargers spark 80% of the time. What's the probability that a sparking charger is bad?",
            back: "**Prior odds:** $\\text{bad} : \\text{good} = 3 : 97$\n**Probability:** $\\frac{48}{48 + 97} \\approx 33\\%$",
        });
        expect(sides(questions[2])).toEqual({
            front: "Set up and solve:\n- The test is negative, what's the probability of being pregnant nevertheless?",
            back: '1. Posterior: is it "pregnant"?\n2. Prior: pregnant : not pregnant $= 30 : 70$.',
        });
    });

    test("Splits single-line cards at the first separator", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        expect(questions[3].questionType).toEqual(CardType.SingleLineBasic);
        expect(sides(questions[3])).toEqual({
            front: "Is $P(E \\mid H) = P(H \\mid E)$?",
            back: "No, it's conditioned the other way round?",
        });
        expect(questions[4].questionType).toEqual(CardType.SingleLineReversed);
        expect(sides(questions[4])).toEqual({
            front: "Mitochondria",
            back: "Powerhouse of the cell::really",
        });
    });

    test("Splits reversed multi-line cards", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        expect(questions[5].questionType).toEqual(CardType.MultiLineReversed);
        expect(sides(questions[5])).toEqual({ front: "Capital of France", back: "Paris" });
    });

    test("Cloze cards have no back", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        const cloze = questions[7];
        expect(cloze.questionType).toEqual(CardType.Cloze);
        expect(sides(cloze)).toEqual({
            front: cloze.questionText.actualQuestion,
            back: null,
        });
    });

    test("Ink sides are found in split sides", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        const { front, back } = split(questions[6]);
        expect(inkEmbedFileName(front)).toEqual("sr-ink-20261031-141502123-front.svg");
        expect(inkEmbedFileName(back)).toEqual("sr-ink-20261031-141502123-back.svg");
    });
});

describe("composeCardText", () => {
    test("Split and compose round trip for every card type", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        expect(questions.length).toEqual(8);
        const types = new Set(questions.map((q) => q.questionType));
        expect(types.size).toEqual(5);

        for (const question of questions) {
            expect(roundTrip(question), CardType[question.questionType]).toEqual(
                question.questionText.actualQuestion,
            );
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
        expect(sides(questions[0], END_MARKER_SETTINGS)).toEqual({
            front: "First line\nsecond line",
            back: "Answer\n\nwith a gap",
        });
        for (const question of questions) {
            expect(roundTrip(question, END_MARKER_SETTINGS)).toEqual(
                question.questionText.actualQuestion,
            );
        }
    });

    test("Round trip keeps a blank line after the separator and whitespace around it", async () => {
        const text = `#flashcards

Q
?

A

---

Q2
  ?
A2
---
`;
        const questions = await parseQuestions(text, END_MARKER_SETTINGS);
        expect(questions.length).toEqual(2);
        expect(split(questions[0], END_MARKER_SETTINGS)).toEqual({
            front: "Q",
            back: "\nA",
            separator: "?",
        });
        expect(split(questions[1], END_MARKER_SETTINGS).separator).toEqual("  ?");
        for (const question of questions) {
            expect(roundTrip(question, END_MARKER_SETTINGS)).toEqual(
                question.questionText.actualQuestion,
            );
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

    test("Compose is the exact inverse of the line-based split", () => {
        const s = DEFAULT_SETTINGS;
        expect(composeCardText(CardType.MultiLineBasic, "Q\n", "A", s)).toEqual("Q\n\n?\nA");
        expect(composeCardText(CardType.MultiLineBasic, "Q", "\nA", s)).toEqual("Q\n?\n\nA");
        expect(composeCardText(CardType.MultiLineBasic, "Q", null, s)).toEqual("Q\n?\n");
        expect(composeCardText(CardType.MultiLineBasic, "Q", "A", s, "? ")).toEqual("Q\n? \nA");
        expect(composeCardText(CardType.SingleLineBasic, "Q", "A", s, "::")).toEqual("Q::A");
    });

    test("A changed ink side composes to a parsable card", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        const question = questions[0];
        const { front } = split(question);
        const changed = composeCardText(
            question.questionType,
            front,
            inkEmbed("sr-ink/sr-ink-x-back.svg"),
            DEFAULT_SETTINGS,
        );
        const [reparsed] = await parseQuestions(`#flashcards\n\n${changed}\n`, DEFAULT_SETTINGS);
        expect(sides(reparsed)).toEqual({ front, back: "![[sr-ink/sr-ink-x-back.svg]]" });
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
        expect(inkEmbedFileName("![[sr-ink-a-front.svg]]")).toEqual("sr-ink-a-front.svg");
        expect(inkEmbedFileName("![[sr-ink/sr-ink-a-back.svg]]")).toEqual("sr-ink-a-back.svg");
        expect(inkEmbedFileName("  ![[deep/folder name/sr-ink-a-back.svg]]\n")).toEqual(
            "sr-ink-a-back.svg",
        );
        expect(inkEmbedFileName("![[sr-ink/sr-ink-a-back.svg|300]]")).toEqual("sr-ink-a-back.svg");
        expect(inkEmbedFileName("![[sr-ink-a-back.SVG]]")).toEqual("sr-ink-a-back.SVG");
    });

    test("Markdown embeds incl. url-encoded and bracketed paths", () => {
        expect(inkEmbedFileName("![](sr-ink/sr-ink-a-front.svg)")).toEqual("sr-ink-a-front.svg");
        expect(inkEmbedFileName("![ink](my%20cards/sr-ink-a%20b-front.svg)")).toEqual(
            "sr-ink-a b-front.svg",
        );
        expect(inkEmbedFileName("![](<my cards/sr-ink-a-back.svg>)")).toEqual("sr-ink-a-back.svg");
        expect(inkEmbedFileName('![](sr-ink/sr-ink-a-back.svg "title")')).toEqual(
            "sr-ink-a-back.svg",
        );
        // Not valid url-encoding: used as is
        expect(inkEmbedFileName("![](sr-ink-100%-back.svg)")).toEqual("sr-ink-100%-back.svg");
    });

    test("Anything but exactly one ink embed is text", () => {
        expect(inkEmbedFileName("")).toBeNull();
        expect(inkEmbedFileName("sr-ink-a-front.svg")).toBeNull();
        expect(inkEmbedFileName("[[sr-ink-a-front.svg]]")).toBeNull();
        expect(inkEmbedFileName("[x](sr-ink-a-front.svg)")).toBeNull();
        expect(inkEmbedFileName("![[photo.svg]]")).toBeNull();
        expect(inkEmbedFileName("![[sr-ink-a-front.png]]")).toBeNull();
        expect(inkEmbedFileName("![[sr-ink/sr-ink-a-front.svg/other.svg]]")).toBeNull();
        expect(inkEmbedFileName("Look: ![[sr-ink-a-front.svg]]")).toBeNull();
        expect(inkEmbedFileName("![[sr-ink-a-front.svg]] and text")).toBeNull();
        expect(inkEmbedFileName("![[sr-ink-a-front.svg]]\n![[sr-ink-b-front.svg]]")).toBeNull();
        expect(inkEmbedFileName("![[sr-ink-a-front.svg]]![[sr-ink-b-front.svg]]")).toBeNull();
        expect(inkEmbedFileName("![](sr-ink-a-front.svg) ![](sr-ink-b-front.svg)")).toBeNull();
        expect(inkEmbedFileName("![](https://example.com/photo.svg)")).toBeNull();
    });

    test("inkEmbed creates a detectable wiki embed", () => {
        expect(inkEmbed("sr-ink/sr-ink-x-front.svg")).toEqual("![[sr-ink/sr-ink-x-front.svg]]");
        expect(inkEmbedFileName(inkEmbed("sr-ink/sr-ink-x-front.svg"))).toEqual(
            "sr-ink-x-front.svg",
        );
    });
});

describe("inkEmbedFileNames", () => {
    test("finds ink embeds anywhere in the text, in both embed forms", () => {
        const text = [
            "Label this: ![[sr-ink/sr-ink-a-front.svg|200]] and ![[diagram.png]]",
            "?",
            '![drawn](<my%20folder/sr-ink-b-back.svg>) or ![](sr-ink-c-back.svg "title")',
            "[[sr-ink-not-embedded-front.svg]]",
        ].join("\n");
        expect(inkEmbedFileNames(text)).toEqual([
            "sr-ink-a-front.svg",
            "sr-ink-b-back.svg",
            "sr-ink-c-back.svg",
        ]);
    });

    test("no ink embeds", () => {
        expect(inkEmbedFileNames("Q::A ![[photo.svg]]")).toEqual([]);
    });
});

describe("inkEmbedPaths", () => {
    test("finds the link paths of ink embeds, folder included", () => {
        const text =
            "![[sr-ink/sr-ink-a-front.svg|200]]\n?\n![](archive/sr-ink-a-front.svg) ![[x.png]]";
        expect(inkEmbedPaths(text)).toEqual([
            "sr-ink/sr-ink-a-front.svg",
            "archive/sr-ink-a-front.svg",
        ]);
    });
});

describe("linksIn", () => {
    test("finds links and embeds of any file, in both forms", () => {
        const text = [
            "![[sr-ink/a.svg|200]] [[Note#Heading|alias]]",
            '![drawn](<my%20folder/b.svg>) [x](c.svg "title") [y](d%20e.md#h)',
        ].join("\n");
        expect(linksIn(text).map((link) => link.path)).toEqual([
            "sr-ink/a.svg",
            "Note",
            "my folder/b.svg",
            "c.svg",
            "d e.md",
        ]);
        expect(linksIn(text)[0].match).toEqual("![[sr-ink/a.svg|200]]");
    });
});

describe("misreadSide", () => {
    beforeAll(() => unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS));

    const added = (front: string, back: string, settings = DEFAULT_SETTINGS) =>
        misreadSide(CardType.MultiLineBasic, front, back, settings, (f, b) =>
            newCardBody(f, b, settings),
        );
    const edited = (cardType: CardType, front: string, back: string | null) =>
        misreadSide(cardType, front, back, DEFAULT_SETTINGS, (f, b) =>
            composeCardText(cardType, f, b, DEFAULT_SETTINGS),
        );

    test("a card that parses as typed", () => {
        expect(added("What is a vector?", "A dynamic array\n<br>\n- with `a::b`")).toBeNull();
        expect(added("Q", "A", END_MARKER_SETTINGS)).toBeNull();
        expect(added("Q  \nmore", "line with a break  \nnext")).toBeNull();
        expect(added("```\na::b\n```", "A")).toBeNull();
        expect(edited(CardType.SingleLineBasic, "    - Q", "A")).toBeNull();
        expect(edited(CardType.SingleLineReversed, "Q", "A")).toBeNull();
        expect(edited(CardType.Cloze, "The ==mitochondria== powers the cell", null)).toBeNull();
    });

    test("an inline separator in a multi-line card makes it a single-line card", () => {
        expect(added("What does std::vector do?", "A dynamic array")).toEqual("front");
        expect(added("What is a vector?", "Like std::vector")).toEqual("back");
        expect(edited(CardType.MultiLineReversed, "Q", "a:::b")).toEqual("back");
    });

    test("other text the parser would misread", () => {
        // A deck tag, a block id, a reversed separator in a single-line basic card
        expect(added("#biology Cells", "A")).toEqual("front");
        expect(added("Q", "A ^block-1")).toEqual("back");
        expect(edited(CardType.SingleLineBasic, "Q", "A:::B")).toEqual("back");
        expect(edited(CardType.SingleLineBasic, "Line 1\nLine 2", "A")).toEqual("front");
        // A blank line ends the card without an end marker
        expect(added("Q", "A\n\nB")).toEqual("back");
        expect(edited(CardType.Cloze, "No cloze here", null)).toEqual("front");
    });
});

describe("cardMarkerLine", () => {
    const settings = { ...DEFAULT_SETTINGS, multilineCardEndMarker: "---" };

    test("finds a line the parser would read as a separator or the end marker", () => {
        expect(cardMarkerLine("Answer\n---\nMore detail", settings)).toEqual("---");
        expect(cardMarkerLine("Line\n  ?  ", settings)).toEqual("?");
        expect(cardMarkerLine("Line\n??", settings)).toEqual("??");
    });

    test("ignores markers inside a line or a code block, and an unset end marker", () => {
        expect(cardMarkerLine("Is it? Yes\n--- not a rule", settings)).toBeNull();
        expect(cardMarkerLine("```\n?\n---\n```", settings)).toBeNull();
        expect(cardMarkerLine("a\n\nb", DEFAULT_SETTINGS)).toBeNull();
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
        expect(questions.map((q) => sides(q))).toEqual([
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
        expect(questions.map((q) => sides(q, END_MARKER_SETTINGS))).toEqual([
            { front: "Q0", back: "A0" },
            { front: "Q1", back: "A1" },
        ]);
    });
});

describe("inkEmbedPath", () => {
    test("Keeps the embed's folder, decoded", () => {
        expect(inkEmbedPath("![[A/attachments/sr-ink-x-back.svg|300]]")).toEqual(
            "A/attachments/sr-ink-x-back.svg",
        );
        expect(inkEmbedPath("![](my%20cards/sr-ink-x-back.svg)")).toEqual(
            "my cards/sr-ink-x-back.svg",
        );
        expect(inkEmbedPath("![[sr-ink-x-back.svg]]")).toEqual("sr-ink-x-back.svg");
        expect(inkEmbedPath("![[A/photo.svg]]")).toBeNull();
    });
});

describe("isInkFileName", () => {
    test("Any sr-ink-….svg, also one not following the naming scheme", () => {
        expect(isInkFileName("sr-ink-20261031-1-front.svg")).toBe(true);
        expect(isInkFileName("sr-ink-20261031-1-front 1.svg")).toBe(true);
        expect(isInkFileName("sr-ink-sketch.SVG")).toBe(true);
        expect(isInkFileName("sr-ink-sketch.png")).toBe(false);
        expect(isInkFileName("photo.svg")).toBe(false);
    });
});

describe("protectBlankLines", () => {
    test("Without an end marker, blank lines become <br> lines, except in code blocks", () => {
        const s = DEFAULT_SETTINGS;
        expect(protectBlankLines("line 1\n\nline 2", s)).toEqual("line 1\n<br>\nline 2");
        expect(protectBlankLines("a\n  \n\nb", s)).toEqual("a\n<br>\n<br>\nb");
        expect(protectBlankLines("```\ncode\n\nmore\n```\n\nx", s)).toEqual(
            "```\ncode\n\nmore\n```\n<br>\nx",
        );
        expect(protectBlankLines("no gaps", s)).toEqual("no gaps");
    });

    test("With an end marker, blank lines stay", () => {
        expect(protectBlankLines("a\n\nb", END_MARKER_SETTINGS)).toEqual("a\n\nb");
    });

    test("A card with a protected blank line parses as one card", async () => {
        const back = protectBlankLines("line 1\n\nline 2", DEFAULT_SETTINGS);
        const card = newCardBody("Q\n\nmore Q", back, DEFAULT_SETTINGS).replace(
            "Q\n\nmore Q",
            protectBlankLines("Q\n\nmore Q", DEFAULT_SETTINGS),
        );
        const questions = await parseQuestions(`#flashcards\n\n${card}\n`, DEFAULT_SETTINGS);
        expect(questions.length).toEqual(1);
        expect(sides(questions[0])).toEqual({
            front: "Q\n<br>\nmore Q",
            back: "line 1\n<br>\nline 2",
        });
    });
});

describe("splitSide", () => {
    const ink = "![[sr-ink/sr-ink-20261031-141502123-front.svg]]";

    test("A side without a trailing ink embed is all text, kept as is", () => {
        expect(splitSide("Capital of France")).toEqual({
            text: "Capital of France",
            inkEmbed: null,
        });
        expect(splitSide("Line 1\nLine 2  \n")).toEqual({
            text: "Line 1\nLine 2  \n",
            inkEmbed: null,
        });
        expect(splitSide("")).toEqual({ text: "", inkEmbed: null });
        // Embeds of other files
        expect(splitSide("See ![[diagram.png]]")).toEqual({
            text: "See ![[diagram.png]]",
            inkEmbed: null,
        });
        expect(splitSide("![[notes/sr-ink-x.png]]")).toEqual({
            text: "![[notes/sr-ink-x.png]]",
            inkEmbed: null,
        });
    });

    test("An ink-only side, in both embed forms", () => {
        expect(splitSide(ink)).toEqual({ text: "", inkEmbed: ink });
        expect(splitSide(`  ${ink}  \n`)).toEqual({ text: "", inkEmbed: ink });
        expect(splitSide("![[sr-ink/sr-ink-a.svg|200]]")).toEqual({
            text: "",
            inkEmbed: "![[sr-ink/sr-ink-a.svg|200]]",
        });
        expect(splitSide("![](sr-ink/sr-ink-a-back.svg)")).toEqual({
            text: "",
            inkEmbed: "![](sr-ink/sr-ink-a-back.svg)",
        });
        expect(splitSide('![ink](<my ink/sr-ink-a.svg> "title")')).toEqual({
            text: "",
            inkEmbed: '![ink](<my ink/sr-ink-a.svg> "title")',
        });
    });

    test("Text followed by ink, on the same line or on a line of its own", () => {
        expect(splitSide(`Sketch the cell ${ink}`)).toEqual({
            text: "Sketch the cell",
            inkEmbed: ink,
        });
        expect(splitSide(`Sketch the cell\n${ink}`)).toEqual({
            text: "Sketch the cell",
            inkEmbed: ink,
        });
        expect(splitSide(`Line 1\n- item\n\n${ink}\n`)).toEqual({
            text: "Line 1\n- item",
            inkEmbed: ink,
        });
        expect(splitSide("Q\t![](sr-ink/sr-ink-a.svg)")).toEqual({
            text: "Q",
            inkEmbed: "![](sr-ink/sr-ink-a.svg)",
        });
        // Only the last embed is the ink, an earlier one is part of the text
        expect(splitSide(`![[sr-ink/old.svg]]\n${ink}`)).toEqual({
            text: "![[sr-ink/old.svg]]",
            inkEmbed: ink,
        });
    });

    test("An ink embed that isn't at the very end is text", () => {
        expect(splitSide(`Before ${ink} after`)).toEqual({
            text: `Before ${ink} after`,
            inkEmbed: null,
        });
        expect(splitSide(`${ink}\nmore text`)).toEqual({
            text: `${ink}\nmore text`,
            inkEmbed: null,
        });
        // Not separated by whitespace from the text before it
        expect(splitSide(`word${ink}`)).toEqual({ text: `word${ink}`, inkEmbed: null });
    });

    test("Uses the same embed rules as inkEmbedFileName", () => {
        for (const side of [
            ink,
            "![](sr-ink/sr-ink-%C3%A4.svg)",
            "![[sr-ink/x.png]]",
            "![[a.svg]]",
        ]) {
            const { inkEmbed } = splitSide(`Text ${side}`);
            expect(inkEmbed === null ? null : inkEmbedFileName(inkEmbed)).toEqual(
                inkEmbedFileName(side),
            );
        }
    });
});

describe("joinSide", () => {
    const ink = "![[sr-ink/sr-ink-x-back.svg]]";

    test("Multi-line and cloze cards put the ink on a line of its own", () => {
        for (const cardType of [
            CardType.MultiLineBasic,
            CardType.MultiLineReversed,
            CardType.Cloze,
        ]) {
            expect(joinSide(cardType, "Q", ink)).toEqual(`Q\n${ink}`);
            expect(joinSide(cardType, "Line 1\nLine 2  ", ink)).toEqual(`Line 1\nLine 2\n${ink}`);
        }
    });

    test("Single-line cards keep the ink on the same line", () => {
        expect(joinSide(CardType.SingleLineBasic, "Q", ink)).toEqual(`Q ${ink}`);
        expect(joinSide(CardType.SingleLineReversed, "Q ", ink)).toEqual(`Q ${ink}`);
    });

    test("A code block left open is closed before the ink", () => {
        for (const cardType of [CardType.MultiLineBasic, CardType.Cloze]) {
            expect(joinSide(cardType, "```js\nconst a = 1", ink)).toEqual(
                "```js\nconst a = 1\n```\n" + ink,
            );
            expect(joinSide(cardType, "~~~~\ncode\n```", ink)).toEqual(
                "~~~~\ncode\n```\n~~~~\n" + ink,
            );
            // Closed blocks stay as they are
            expect(joinSide(cardType, "```\ncode\n```", ink)).toEqual("```\ncode\n```\n" + ink);
            expect(joinSide(cardType, "```js\nconst a = 1", null)).toEqual("```js\nconst a = 1");
        }
    });

    test("Only the ink without text, only the text without ink", () => {
        for (const cardType of [CardType.MultiLineBasic, CardType.SingleLineBasic]) {
            expect(joinSide(cardType, "", ink)).toEqual(ink);
            expect(joinSide(cardType, " \n ", ink)).toEqual(ink);
            expect(joinSide(cardType, "Q  ", null)).toEqual("Q  ");
            expect(joinSide(cardType, "", null)).toEqual("");
        }
    });

    test("Join and split round trip", () => {
        const types = [
            CardType.SingleLineBasic,
            CardType.SingleLineReversed,
            CardType.MultiLineBasic,
            CardType.MultiLineReversed,
        ];
        for (const cardType of types) {
            for (const text of ["", "Q", "Line 1\n- Line 2"]) {
                if (text.includes("\n") && !types.slice(2).includes(cardType)) continue;
                for (const embed of [ink, "![](sr-ink/sr-ink-y.svg)", null]) {
                    expect(splitSide(joinSide(cardType, text, embed))).toEqual({
                        text,
                        inkEmbed: embed,
                    });
                }
            }
        }
    });
});

describe("Sides with text and ink", () => {
    const frontInk = "![[sr-ink/sr-ink-x-front.svg]]";
    const backInk = "![[sr-ink/sr-ink-x-back.svg]]";

    async function reparse(cardType: CardType, front: string, back: string) {
        const cardText = composeCardText(cardType, front, back, DEFAULT_SETTINGS);
        const questions = await parseQuestions(`#flashcards\n\n${cardText}\n`, DEFAULT_SETTINGS);
        return { cardText, questions };
    }

    test("Mixed sides of every card type are read back by SR's parser", async () => {
        const cases: [CardType, string, string][] = [
            [CardType.SingleLineBasic, "Sketch a cell", "Nucleus"],
            [CardType.SingleLineReversed, "Mitochondria", "Powerhouse"],
            [CardType.MultiLineBasic, "Sketch a cell\nwith its parts", "- Nucleus\n- Membrane"],
            [CardType.MultiLineReversed, "Capital of France", "Paris"],
        ];
        for (const [cardType, frontText, backText] of cases) {
            for (const [fInk, bInk] of [
                [frontInk, backInk],
                [frontInk, null],
                [null, backInk],
            ]) {
                const front = joinSide(cardType, frontText, fInk);
                const back = joinSide(cardType, backText, bInk);
                const { cardText, questions } = await reparse(cardType, front, back);
                expect(questions.length).toEqual(1);
                expect(questions[0].questionType).toEqual(cardType);
                const reread = sides(questions[0]);
                expect(splitSide(reread.front)).toEqual({ text: frontText, inkEmbed: fInk });
                expect(splitSide(reread.back)).toEqual({ text: backText, inkEmbed: bInk });
                expect(
                    parsesAsCard(cardText, cardType, front, back, DEFAULT_SETTINGS),
                    `${CardType[cardType]} ${cardText}`,
                ).toBe(true);
            }
        }
    });

    test("Ink-only sides still read back as before", async () => {
        const { questions } = await reparse(CardType.MultiLineBasic, frontInk, backInk);
        const { front, back } = sides(questions[0]);
        expect(front).toEqual(frontInk);
        expect(splitSide(front)).toEqual({ text: "", inkEmbed: frontInk });
        expect(inkEmbedFileName(back)).toEqual("sr-ink-x-back.svg");
    });

    test("A mixed side in a new card body", async () => {
        const front = joinSide(CardType.MultiLineBasic, "Sketch a cell", frontInk);
        const back = joinSide(CardType.MultiLineBasic, "", backInk);
        for (const settings of [DEFAULT_SETTINGS, END_MARKER_SETTINGS]) {
            const questions = await parseQuestions(
                `#flashcards\n\n${newCardBody(front, back, settings)}\n`,
                settings,
            );
            expect(questions.length).toEqual(1);
            expect(splitSide(sides(questions[0], settings).front)).toEqual({
                text: "Sketch a cell",
                inkEmbed: frontInk,
            });
        }
    });

    test("misreadSide on mixed sides", () => {
        const added = (front: string, back: string) =>
            misreadSide(CardType.MultiLineBasic, front, back, DEFAULT_SETTINGS, (f, b) =>
                newCardBody(f, b, DEFAULT_SETTINGS),
            );
        const edited = (cardType: CardType, front: string, back: string) =>
            misreadSide(cardType, front, back, DEFAULT_SETTINGS, (f, b) =>
                composeCardText(cardType, f, b, DEFAULT_SETTINGS),
            );
        const multi = (text: string, embed: string) =>
            joinSide(CardType.MultiLineBasic, text, embed);
        const single = (text: string, embed: string) =>
            joinSide(CardType.SingleLineBasic, text, embed);

        expect(added(multi("Sketch a cell", frontInk), multi("Nucleus", backInk))).toBeNull();
        expect(added(multi("", frontInk), multi("Nucleus", backInk))).toBeNull();
        expect(
            edited(CardType.SingleLineBasic, single("Q", frontInk), single("A", backInk)),
        ).toBeNull();
        expect(
            edited(CardType.MultiLineReversed, multi("Q", frontInk), multi("A", backInk)),
        ).toBeNull();
        // The typed text is still checked
        expect(added(multi("What does std::vector do?", frontInk), multi("A", backInk))).toEqual(
            "front",
        );
        expect(added(multi("Q", frontInk), multi("Like std::vector", backInk))).toEqual("back");
        expect(added(multi("#biology Cells", frontInk), multi("A", backInk))).toEqual("front");
        expect(added(multi("Q", frontInk), multi("A\n\nB", backInk))).toEqual("back");
        expect(
            edited(CardType.SingleLineBasic, single("Q", frontInk), single("A:::B", backInk)),
        ).toEqual("back");
    });
});
