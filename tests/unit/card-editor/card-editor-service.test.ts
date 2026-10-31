import { TFile } from "obsidian";

import {
    CardEditorModal,
    CardEditorOptions,
    CardEditorResult,
    SideResult,
} from "src/card-editor/card-editor-modal";
import { CardEditorService } from "src/card-editor/card-editor-service";
import { inkEmbedFileName } from "src/card-editor/core/card-text";
import { parseInkFileName, strokesToSvg, svgToStrokes } from "src/card-editor/core/ink-svg";
import { Stroke } from "src/card-editor/core/strokes";
import { SideState } from "src/card-editor/side-editor";
import { Question } from "src/data/data-structures/card/questions/question";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { SettingsManager } from "src/data/settings-manager";
import type SRPlugin from "src/main";
import { Note } from "src/note/note";
import { setupStaticDateProvider20230906 } from "src/utils/dates";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "../helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "../helpers/unit-test-setup";
import { createTestNoteQuestionParser } from "../sample-items";

// The editor is replaced by a stub that records its options, so a test can play the user
jest.mock("src/card-editor/card-editor-modal");
const ModalMock = CardEditorModal as jest.MockedClass<typeof CardEditorModal>;

const NOTE_PATH = "notes/bio.md";

const stroke = (x: number): Stroke => ({
    points: [
        [x, 10, 0.5],
        [x + 20, 30, 0.5],
    ],
    pressure: false,
});

const svgOf = (strokes: Stroke[], size = 7) => strokesToSvg(strokes, { size }).svg;

/** An in-memory vault with just the API the ink files use */
class FakeVault {
    files = new Map<string, { file: TFile; content: string }>();
    folders = new Set<string>();

    add(path: string, content: string): TFile {
        const name = path.substring(path.lastIndexOf("/") + 1);
        const file = {
            path,
            name,
            basename: name.replace(/\.[^.]*$/, ""),
            extension: "svg",
        } as TFile;
        this.files.set(path, { file, content });
        return file;
    }

    byName(name: string): TFile | null {
        for (const { file } of this.files.values()) if (file.name === name) return file;
        return null;
    }

    content(path: string): string | undefined {
        return this.files.get(path)?.content;
    }

    app = {
        vault: {
            read: jest.fn((file: TFile) => Promise.resolve(this.files.get(file.path).content)),
            create: jest.fn((path: string, data: string) => {
                if (this.files.has(path)) return Promise.reject(new Error("exists"));
                return Promise.resolve(this.add(path, data));
            }),
            modify: jest.fn((file: TFile, data: string) => {
                this.files.get(file.path).content = data;
                return Promise.resolve();
            }),
            getAbstractFileByPath: jest.fn((path: string) =>
                this.folders.has(path) ? { path } : null,
            ),
            createFolder: jest.fn((path: string) => {
                this.folders.add(path);
                return Promise.resolve();
            }),
            getResourcePath: jest.fn((file: TFile) => `app://vault/${file.path}?1`),
        },
        metadataCache: {
            getFirstLinkpathDest: jest.fn((link: string) => this.byName(link)),
            fileToLinktext: jest.fn((file: TFile) => file.path),
        },
        fileManager: {
            trashFile: jest.fn((file: TFile) => {
                this.files.delete(file.path);
                return Promise.resolve();
            }),
            getAvailablePathForAttachment: jest.fn((name: string) =>
                Promise.resolve(`notes/attachments/${name}`),
            ),
        },
    };
}

let vault: FakeVault;
let settings: SRSettings;
let service: CardEditorService;

beforeAll(() => {
    setupStaticDateProvider20230906();
    unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS);
});

beforeEach(() => {
    ModalMock.mockClear();
    vault = new FakeVault();
    settings = { ...DEFAULT_SETTINGS };
    const plugin = { app: vault.app } as unknown as SRPlugin;
    service = new CardEditorService(plugin, new SettingsManager(settings, () => Promise.resolve()));
});

async function parseQuestions(noteText: string): Promise<Question[]> {
    const parser = createTestNoteQuestionParser(settings);
    const file = new UnitTestSRFile(noteText, NOTE_PATH);
    const questions = await parser.createQuestionList(
        file,
        TextDirection.Ltr,
        TopicPath.emptyPath,
        true,
    );
    // The service only needs to know which note a question is in
    questions.forEach((q) => (q.note = { file } as unknown as Note));
    return questions;
}

async function parseQuestion(noteText: string): Promise<Question> {
    return (await parseQuestions(noteText))[0];
}

interface Session {
    opts: Extract<CardEditorOptions, { kind: "edit" }>;
    result: ReturnType<CardEditorService["editQuestion"]>;
}

/** Opens the editor for a question and waits until it is shown */
async function edit(question: Question): Promise<Session> {
    const result = service.editQuestion(question);
    for (let i = 0; i < 20 && ModalMock.mock.calls.length === 0; i++) await Promise.resolve();
    expect(ModalMock).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ModalMock.mock.instances[0].open).toHaveBeenCalled();
    const opts = ModalMock.mock.calls[0][2];
    if (opts.kind !== "edit") throw new Error("not opened for editing");
    return { opts, result };
}

/** Saves like the editor does: save() and, if it succeeded, closed() */
async function save(session: Session, result: CardEditorResult) {
    await session.opts.save(result);
    session.opts.closed();
    return session.result;
}

/** The result of saving a side as it was loaded */
function unchanged(state: SideState): SideResult {
    return state.mode === "text"
        ? { mode: "text", text: state.text }
        : { mode: "ink", strokes: state.strokes, penSize: state.penSize, changed: false };
}

const text = (t: string): SideResult => ({ mode: "text", text: t });
const ink = (strokes: Stroke[], changed = true): SideResult => ({
    mode: "ink",
    strokes,
    penSize: 5,
    changed,
});

// Cards whose question or answer contains the "?" separator, tables, LaTeX and lists
const textNote = `#flashcards

When plugged in, bad chargers spark 80% of the time. What's the probability that a sparking charger is bad?
?
**Prior odds:** $\\text{bad} : \\text{good} = 3 : 97$
**Probability:** $\\frac{48}{48 + 97} \\approx 33\\%$
<!--SR:!2026-10-27,0,250-->

---

What is the sensitivity of a test?
?
The true positive rate: $P(\\text{positive} \\mid \\text{sick})$<br>
|          | Test positive | Test negative |
| -------- | ------------- | ------------- |
| **Sick** | **TP**        | **FN**        |
$$\\text{Sensitivity} = \\frac{TP}{TP + FN}$$

---

Set up and solve:
- The test is negative, what's the probability of being pregnant nevertheless?
?
1. Posterior: is it "pregnant"?
2. Prior: pregnant : not pregnant $= 30 : 70$.

---

Is $P(E \\mid H) = P(H \\mid E)$?::No, it's conditioned the other way round?

---

The odds form of Bayes' rule has these parts:
* ==prior odds==
* ==likelihood ratio==
`;

const mixedNote = `#flashcards

What is the powerhouse of the cell?
?
![[pencards/pencard-20261031-141502123-back.svg]]
`;

const inkNote = `#flashcards

![[pencards/pencard-abc-front.svg]]
?
![[pencards/pencard-abc-back.svg]]
`;

describe("loading a card", () => {
    test("splits front and back only at the card separator", async () => {
        const { opts } = await edit((await parseQuestions(textNote))[0]);

        expect(opts.initial.front).toEqual({
            mode: "text",
            text: "When plugged in, bad chargers spark 80% of the time. What's the probability that a sparking charger is bad?",
            strokes: [],
            penSize: settings.cardEditorPenSize,
        });
        expect(opts.initial.back.text).toEqual(
            "**Prior odds:** $\\text{bad} : \\text{good} = 3 : 97$\n**Probability:** $\\frac{48}{48 + 97} \\approx 33\\%$",
        );
        expect(opts.kind).toEqual("edit");
        expect(opts.textDirection).toEqual(TextDirection.Ltr);
    });

    test("opens a handwritten side as ink with the strokes and pen size of its SVG", async () => {
        vault.add("pencards/pencard-20261031-141502123-back.svg", svgOf([stroke(0), stroke(40)]));
        const { opts } = await edit(await parseQuestion(mixedNote));

        expect(opts.initial.front.mode).toEqual("text");
        expect(opts.initial.back.mode).toEqual("ink");
        expect(opts.initial.back.text).toEqual("");
        expect(opts.initial.back.penSize).toEqual(7);
        expect(opts.initial.back.strokes).toHaveLength(2);
        expect(vault.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
            "pencard-20261031-141502123-back.svg",
            NOTE_PATH,
        );
    });

    test("opens a side as text showing the embed when its SVG is missing or has no strokes", async () => {
        const embed = "![[pencards/pencard-20261031-141502123-back.svg]]";
        let { opts } = await edit(await parseQuestion(mixedNote));
        expect(opts.initial.back).toMatchObject({ mode: "text", text: embed });

        ModalMock.mockClear();
        vault.add("pencards/pencard-20261031-141502123-back.svg", "<svg></svg>");
        ({ opts } = await edit(await parseQuestion(mixedNote)));
        expect(opts.initial.back).toMatchObject({ mode: "text", text: embed });
    });

    test("cloze cards have no back", async () => {
        const questions = await parseQuestions(textNote);
        const { opts } = await edit(questions[4]);
        expect(opts.initial.back).toBeNull();
        expect(opts.initial.front.text).toEqual(questions[4].questionText.actualQuestion);
    });
});

describe("saving a card", () => {
    test("saving without changes returns the original text for every card type and writes nothing", async () => {
        const questions = await parseQuestions(textNote);
        expect(questions.length).toEqual(5);

        for (const question of questions) {
            ModalMock.mockClear();
            const session = await edit(question);
            const { front, back } = session.opts.initial;
            const result = await save(session, {
                front: unchanged(front),
                back: back && unchanged(back),
            });
            expect(result).toEqual({
                text: question.questionText.actualQuestion,
                textChanged: false,
                changedImages: [],
            });
        }
        expect(vault.app.vault.create).not.toHaveBeenCalled();
    });

    test("an edited answer keeps question, tables and formulas intact", async () => {
        const question = (await parseQuestions(textNote))[1];
        const session = await edit(question);
        const { front, back } = session.opts.initial;

        const result = await save(session, {
            front: unchanged(front),
            back: text(back.text.replace("true positive", "TRUE POSITIVE")),
        });
        expect(result.textChanged).toBe(true);
        expect(result.text).toEqual(
            question.questionText.actualQuestion.replace("true positive", "TRUE POSITIVE"),
        );
    });

    test("cancel resolves to null and writes nothing", async () => {
        vault.add("pencards/pencard-abc-front.svg", svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(inkNote));
        session.opts.closed();

        await expect(session.result).resolves.toBeNull();
        expect(vault.app.vault.modify).not.toHaveBeenCalled();
        expect(vault.app.fileManager.trashFile).not.toHaveBeenCalled();
    });

    test("changed ink overwrites its SVG and keeps the note text", async () => {
        const back = vault.add("pencards/pencard-20261031-141502123-back.svg", svgOf([stroke(0)]));
        const question = await parseQuestion(mixedNote);
        const session = await edit(question);

        const result = await save(session, {
            front: unchanged(session.opts.initial.front),
            back: ink([stroke(0), stroke(50)]),
        });
        expect(result).toEqual({
            text: question.questionText.actualQuestion,
            textChanged: false,
            changedImages: [back],
        });
        expect(svgToStrokes(vault.content(back.path)).strokes).toHaveLength(2);
        expect(vault.app.vault.create).not.toHaveBeenCalled();
    });

    test("unchanged ink is not rewritten", async () => {
        vault.add("pencards/pencard-abc-front.svg", svgOf([stroke(0)]));
        vault.add("pencards/pencard-abc-back.svg", svgOf([stroke(5)]));
        const session = await edit(await parseQuestion(inkNote));
        const { front, back } = session.opts.initial;

        const result = await save(session, { front: unchanged(front), back: unchanged(back) });
        expect(result.textChanged).toBe(false);
        expect(result.changedImages).toEqual([]);
        expect(vault.app.vault.modify).not.toHaveBeenCalled();
    });

    test("text → ink creates an SVG named after the card's other ink side", async () => {
        vault.add("pencards/pencard-20261031-141502123-back.svg", svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(mixedNote));

        const result = await save(session, {
            front: ink([stroke(3)]),
            back: unchanged(session.opts.initial.back),
        });
        const path = "pencards/pencard-20261031-141502123-front.svg";
        expect(vault.content(path)).toBeDefined();
        expect(svgToStrokes(vault.content(path)).size).toEqual(5);
        expect(result.textChanged).toBe(true);
        expect(result.changedImages).toEqual([]);
        expect(result.text).toEqual(
            `![[${path}]]\n?\n![[pencards/pencard-20261031-141502123-back.svg]]`,
        );
    });

    test("text → ink on both sides uses one new stem, in the image folder", async () => {
        settings.cardEditorImageFolder = "ink/cards";
        const session = await edit((await parseQuestions(textNote))[0]);

        const result = await save(session, { front: ink([stroke(1)]), back: ink([stroke(2)]) });
        expect(vault.app.vault.createFolder).toHaveBeenCalledWith("ink/cards");

        const [frontText, backText] = result.text.split("\n?\n");
        const front = parseInkFileName(inkEmbedFileName(frontText));
        const back = parseInkFileName(inkEmbedFileName(backText));
        expect(front).toEqual({ stem: back.stem, side: "front" });
        expect(back.side).toEqual("back");
        expect(frontText).toEqual(`![[ink/cards/pencard-${front.stem}-front.svg]]`);
    });

    test("an empty image folder uses Obsidian's attachment folder", async () => {
        settings.cardEditorImageFolder = "";
        const session = await edit((await parseQuestions(textNote))[0]);

        const result = await save(session, {
            front: unchanged(session.opts.initial.front),
            back: ink([stroke(2)]),
        });
        expect(vault.app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(
            expect.stringMatching(/^pencard-.+-back\.svg$/),
            NOTE_PATH,
        );
        expect(result.text).toMatch(/\n!\[\[notes\/attachments\/pencard-.+-back\.svg\]\]$/);
        expect(vault.app.vault.createFolder).not.toHaveBeenCalled();
    });

    test("text → ink doesn't reuse a stem whose file name is taken", async () => {
        vault.add("pencards/pencard-20261031-141502123-back.svg", svgOf([stroke(0)]));
        vault.add("old/pencard-20261031-141502123-front.svg", svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(mixedNote));

        const result = await save(session, {
            front: ink([stroke(3)]),
            back: unchanged(session.opts.initial.back),
        });
        const name = inkEmbedFileName(result.text.split("\n?\n")[0]);
        expect(name).toMatch(/^pencard-.+-front\.svg$/);
        expect(name).not.toEqual("pencard-20261031-141502123-front.svg");
        expect(vault.content("old/pencard-20261031-141502123-front.svg")).toBeDefined();
    });

    test("ink → text moves the SVG to the trash", async () => {
        const back = vault.add("pencards/pencard-20261031-141502123-back.svg", svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(mixedNote));

        const result = await save(session, {
            front: unchanged(session.opts.initial.front),
            back: text("Mitochondria"),
        });
        expect(result).toEqual({
            text: "What is the powerhouse of the cell?\n?\nMitochondria",
            textChanged: true,
            changedImages: [],
        });
        expect(vault.app.fileManager.trashFile).toHaveBeenCalledWith(back);
    });

    test("a failed write rejects the save and trashes nothing", async () => {
        vault.add("pencards/pencard-abc-front.svg", svgOf([stroke(0)]));
        vault.add("pencards/pencard-abc-back.svg", svgOf([stroke(5)]));
        vault.app.vault.modify.mockRejectedValueOnce(new Error("disk full"));
        const session = await edit(await parseQuestion(inkNote));

        await expect(
            session.opts.save({ front: text("typed"), back: ink([stroke(9)]) }),
        ).rejects.toThrow("disk full");
        expect(vault.app.fileManager.trashFile).not.toHaveBeenCalled();

        // The editor stays open; closing it now is a cancel
        session.opts.closed();
        await expect(session.result).resolves.toBeNull();
    });
});
