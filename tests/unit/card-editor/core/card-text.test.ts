import {
    cardInsertion,
    cardMarkerLine,
    composeCardText,
    inkEmbedPath,
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
    test("Splits each card type at its separator", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        expect(sides(questions[2])).toEqual({
            front: "Set up and solve:\n- The test is negative, what's the probability of being pregnant nevertheless?",
            back: '1. Posterior: is it "pregnant"?\n2. Prior: pregnant : not pregnant $= 30 : 70$.',
        });
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
        expect(questions[5].questionType).toEqual(CardType.MultiLineReversed);
        expect(sides(questions[5])).toEqual({ front: "Capital of France", back: "Paris" });
        expect(sides(questions[6])).toEqual({
            front: "![[sr-ink/sr-ink-20261031-141502123-front.svg]]",
            back: "![[sr-ink/sr-ink-20261031-141502123-back.svg]]",
        });
        const cloze = questions[7];
        expect(cloze.questionType).toEqual(CardType.Cloze);
        expect(sides(cloze)).toEqual({ front: cloze.questionText.actualQuestion, back: null });
    });
});

describe("composeCardText", () => {
    test("Split and compose round trip for every card type", async () => {
        const questions = await parseQuestions(noteText, DEFAULT_SETTINGS);
        expect(questions.length).toEqual(8);
        expect(new Set(questions.map((q) => q.questionType)).size).toEqual(5);

        for (const question of questions) {
            expect(roundTrip(question), CardType[question.questionType]).toEqual(
                question.questionText.actualQuestion,
            );
        }
    });

    test("Round trip with an end marker, blank lines and whitespace around the separator", async () => {
        const text = `#flashcards

First line
second line
?

Answer

with a gap

---

Q2
  ?
A2
---

Single::line

---
`;
        const questions = await parseQuestions(text, END_MARKER_SETTINGS);
        expect(questions.length).toEqual(3);
        expect(split(questions[0], END_MARKER_SETTINGS)).toEqual({
            front: "First line\nsecond line",
            back: "\nAnswer\n\nwith a gap",
            separator: "?",
        });
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
    });
});

describe("inkEmbedPath", () => {
    test("Link path of a side that is exactly one ink embed, in both forms", () => {
        expect(inkEmbedPath("  ![[A/attachments/sr-ink-x-back.svg|300]]\n")).toEqual(
            "A/attachments/sr-ink-x-back.svg",
        );
        expect(inkEmbedPath("![](my%20cards/sr-ink-x-back.svg)")).toEqual(
            "my cards/sr-ink-x-back.svg",
        );
        expect(inkEmbedPath("![](<my cards/sr-ink-a-back.svg>)")).toEqual(
            "my cards/sr-ink-a-back.svg",
        );
    });

    test("Anything but exactly one ink embed is text", () => {
        expect(inkEmbedPath("[[sr-ink-a-front.svg]]")).toBeNull();
        expect(inkEmbedPath("![[photo.svg]]")).toBeNull();
        expect(inkEmbedPath("![[sr-ink-a-front.png]]")).toBeNull();
        expect(inkEmbedPath("Look: ![[sr-ink-a-front.svg]]")).toBeNull();
        expect(inkEmbedPath("![[sr-ink-a-front.svg]]\n![[sr-ink-b-front.svg]]")).toBeNull();
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
    const frontInk = "![[sr-ink/sr-ink-x-front.svg]]";
    const backInk = "![[sr-ink/sr-ink-x-back.svg]]";
    const added = (front: string, back: string, settings = DEFAULT_SETTINGS) =>
        misreadSide(CardType.MultiLineBasic, front, back, settings, (f, b) =>
            newCardBody(f, b, settings),
        );
    const edited = (cardType: CardType, front: string, back: string | null) =>
        misreadSide(cardType, front, back, DEFAULT_SETTINGS, (f, b) =>
            composeCardText(cardType, f, b, DEFAULT_SETTINGS),
        );
    const multi = (text: string, embed: string) => joinSide(CardType.MultiLineBasic, text, embed);

    test("a card that parses as typed", () => {
        expect(added("What is a vector?", "A dynamic array\n<br>\n- with `a::b`")).toBeNull();
        expect(added("Q", "A", END_MARKER_SETTINGS)).toBeNull();
        expect(added("```\na::b\n```", "A")).toBeNull();
        expect(edited(CardType.SingleLineBasic, "    - Q", "A")).toBeNull();
        expect(edited(CardType.Cloze, "The ==mitochondria== powers the cell", null)).toBeNull();
        expect(added(multi("Sketch a cell", frontInk), multi("Nucleus", backInk))).toBeNull();
    });

    test("text the parser would misread as card syntax", () => {
        expect(added("What does std::vector do?", "A dynamic array")).toEqual("front");
        expect(added("Q", "Like std::vector")).toEqual("back");
        expect(added("#biology Cells", "A")).toEqual("front");
        expect(added("Q", "A ^block-1")).toEqual("back");
        expect(edited(CardType.SingleLineBasic, "Q", "A:::B")).toEqual("back");
        // A blank line ends the card without an end marker
        expect(added("Q", "A\n\nB")).toEqual("back");
        expect(edited(CardType.Cloze, "No cloze here", null)).toEqual("front");
        // The typed text next to ink is still checked
        expect(added(multi("Q", frontInk), multi("Like std::vector", backInk))).toEqual("back");
    });
});

describe("cardMarkerLine", () => {
    test("finds a separator or end marker line, but not inside a line or a code block", () => {
        expect(cardMarkerLine("Answer\n---\nMore detail", END_MARKER_SETTINGS)).toEqual("---");
        expect(cardMarkerLine("Line\n  ?  ", END_MARKER_SETTINGS)).toEqual("?");
        expect(cardMarkerLine("Is it? Yes\n--- not a rule", END_MARKER_SETTINGS)).toBeNull();
        expect(cardMarkerLine("```\n?\n---\n```", END_MARKER_SETTINGS)).toBeNull();
    });
});

describe("Adding a card", () => {
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

    test("Handwritten and mixed sides parse as one card", async () => {
        const frontInk = "![[sr-ink/sr-ink-x-front.svg]]";
        const backInk = "![[sr-ink/sr-ink-x-back.svg]]";
        const front = joinSide(CardType.MultiLineBasic, "Sketch a cell", frontInk);
        for (const settings of [DEFAULT_SETTINGS, END_MARKER_SETTINGS]) {
            const questions = await parseQuestions(
                `#flashcards\n\n${newCardBody(front, backInk, settings)}\n`,
                settings,
            );
            expect(questions.length).toEqual(1);
            const reread = sides(questions[0], settings);
            expect(splitSide(reread.front)).toEqual({ text: "Sketch a cell", inkEmbed: frontInk });
            expect(splitSide(reread.back)).toEqual({ text: "", inkEmbed: backInk });
        }
    });

    test("With an end marker, blank lines before the card's type is known are protected", () => {
        // The parser still ends a card at a blank line while it doesn't know the card's type
        expect(protectBlankLines("a\n\nb", END_MARKER_SETTINGS, "front")).toEqual("a\n<br>\nb");
        const cloze = protectBlankLines(
            "Intro\n\nThe ==answer== is\n\nmore",
            END_MARKER_SETTINGS,
            "cloze",
        );
        expect(cloze).toEqual("Intro\n<br>\nThe ==answer== is\n\nmore");
        expect(
            parsesAsCard(
                newCardBody(cloze, null, END_MARKER_SETTINGS, CardType.Cloze),
                CardType.Cloze,
                cloze,
                null,
                END_MARKER_SETTINGS,
            ),
        ).toBe(true);
        const front = protectBlankLines("Q\n\nmore Q", END_MARKER_SETTINGS, "front");
        const back = protectBlankLines("A\n\nmore A", END_MARKER_SETTINGS, "back");
        expect(
            parsesAsCard(
                newCardBody(front, back, END_MARKER_SETTINGS),
                CardType.MultiLineBasic,
                front,
                back,
                END_MARKER_SETTINGS,
            ),
        ).toBe(true);
    });

    test("A typed blank line is protected so the card stays one card", async () => {
        expect(protectBlankLines("```\ncode\n\nmore\n```\n\nx", DEFAULT_SETTINGS)).toEqual(
            "```\ncode\n\nmore\n```\n<br>\nx",
        );
        expect(protectBlankLines("a\n\nb", END_MARKER_SETTINGS, "back")).toEqual("a\n\nb");

        const card = newCardBody(
            protectBlankLines("Q\n\nmore Q", DEFAULT_SETTINGS),
            protectBlankLines("line 1\n\nline 2", DEFAULT_SETTINGS),
            DEFAULT_SETTINGS,
        );
        const questions = await parseQuestions(`#flashcards\n\n${card}\n`, DEFAULT_SETTINGS);
        expect(questions.length).toEqual(1);
        expect(sides(questions[0])).toEqual({
            front: "Q\n<br>\nmore Q",
            back: "line 1\n<br>\nline 2",
        });
    });
});

describe("Sides with text and ink", () => {
    const frontInk = "![[sr-ink/sr-ink-x-front.svg]]";
    const backInk = "![[sr-ink/sr-ink-x-back.svg]]";

    test("splitSide finds only a trailing ink embed", () => {
        expect(splitSide(`Sketch the cell\n${frontInk}`)).toEqual({
            text: "Sketch the cell",
            inkEmbed: frontInk,
        });
        expect(splitSide(`${frontInk}\nmore text`)).toEqual({
            text: `${frontInk}\nmore text`,
            inkEmbed: null,
        });
        expect(splitSide("See ![[diagram.png]]")).toEqual({
            text: "See ![[diagram.png]]",
            inkEmbed: null,
        });
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
                for (const embed of [frontInk, "![](sr-ink/sr-ink-y.svg)", null]) {
                    expect(splitSide(joinSide(cardType, text, embed))).toEqual({
                        text,
                        inkEmbed: embed,
                    });
                }
            }
        }
    });

    test("A code block left open is closed before the ink", () => {
        expect(joinSide(CardType.MultiLineBasic, "```js\nconst a = 1", frontInk)).toEqual(
            "```js\nconst a = 1\n```\n" + frontInk,
        );
    });

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
                const cardText = composeCardText(cardType, front, back, DEFAULT_SETTINGS);
                const questions = await parseQuestions(
                    `#flashcards\n\n${cardText}\n`,
                    DEFAULT_SETTINGS,
                );
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
});
