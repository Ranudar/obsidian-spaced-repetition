import { MarkdownView, Notice, TFile, TFolder } from "obsidian";

import {
    CardEditorModal,
    CardEditorOptions,
    CardEditorResult,
    CardEditorSides,
    SideResult,
} from "src/card-editor/card-editor-modal";
import { CardEditorService, findQuestionWithInk } from "src/card-editor/card-editor-service";
import { inkEmbedPath } from "src/card-editor/core/card-text";
import { parseInkFileName, strokesToSvg, svgToStrokes } from "src/card-editor/core/ink-svg";
import { Stroke } from "src/card-editor/core/strokes";
import { SideState } from "src/card-editor/side-editor";
import { CardType, Question } from "src/data/data-structures/card/questions/question";
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

/** File name if the side is exactly one embed of an ink SVG, else null */
const inkEmbedFileName = (side: string): string | null =>
    inkEmbedPath(side)?.split("/").pop() ?? null;

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
            extension: name.substring(name.lastIndexOf(".") + 1),
        } as TFile;
        this.files.set(path, { file, content });
        return file;
    }

    byName(name: string): TFile | null {
        for (const { file } of this.files.values()) if (file.name === name) return file;
        return null;
    }

    /** Like Obsidian: a path finds that file, a bare name a file of that name anywhere */
    byLink(link: string): TFile | null {
        if (link.includes("/")) return this.files.get(link)?.file ?? null;
        return this.byName(link);
    }

    content(path: string): string | undefined {
        return this.files.get(path)?.content;
    }

    app = {
        vault: {
            read: jest.fn((file: TFile) => Promise.resolve(this.files.get(file.path).content)),
            cachedRead: jest.fn((file: TFile) =>
                Promise.resolve(this.files.get(file.path).content),
            ),
            getFiles: jest.fn(() => [...this.files.values()].map(({ file }) => file)),
            create: jest.fn((path: string, data: string) => {
                if (this.files.has(path)) return Promise.reject(new Error("exists"));
                return Promise.resolve(this.add(path, data));
            }),
            modify: jest.fn((file: TFile, data: string) => {
                this.files.get(file.path).content = data;
                return Promise.resolve();
            }),
            getAbstractFileByPath: jest.fn((path: string) =>
                this.folders.has(path) ? Object.assign(new TFolder(), { path }) : null,
            ),
            getAllLoadedFiles: jest.fn(() =>
                [...this.folders].map((path) => Object.assign(new TFolder(), { path })),
            ),
            createFolder: jest.fn((path: string) => {
                this.folders.add(path);
                return Promise.resolve();
            }),
            getResourcePath: jest.fn((file: TFile) => `app://vault/${file.path}?1`),
            process: jest.fn((file: TFile, fn: (data: string) => string) => {
                const entry = this.files.get(file.path);
                entry.content = fn(entry.content);
                return Promise.resolve(entry.content);
            }),
        },
        metadataCache: {
            /** Source note → linked file → number of links, like Obsidian's link index */
            resolvedLinks: {} as Record<string, Record<string, number>>,
            getFirstLinkpathDest: jest.fn((link: string) => this.byLink(link)),
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
        workspace: {
            getLeavesOfType: jest.fn((): { view: unknown }[] => markdownLeaves),
            iterateAllLeaves: jest.fn(),
        },
    };
}

/** Leaves of the markdown editors open in the workspace */
let markdownLeaves: { view: unknown }[] = [];
let vault: FakeVault;
let settings: SRSettings;
let service: CardEditorService;
/** Tags of the notes, as Obsidian's metadata cache reports them */
let noteTags: string[];
const sync = jest.fn(() => Promise.resolve());
/** What dataManager.loadNote returns */
let loadedNote: Note | null;
const editCurrentQuestion = jest.fn(() => Promise.resolve());

beforeAll(() => {
    setupStaticDateProvider20230906();
    unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS);
});

beforeEach(() => {
    ModalMock.mockClear();
    vault = new FakeVault();
    markdownLeaves = [];
    settings = { ...DEFAULT_SETTINGS };
    noteTags = ["#flashcards"];
    sync.mockClear();
    loadedNote = null;
    editCurrentQuestion.mockClear();
    jest.mocked(Notice).mockClear();
    const plugin = {
        app: vault.app,
        isInitialized: true,
        getObsidianRtlSetting: () => TextDirection.Ltr,
        dataManager: {
            createSRNoteTFile: () => ({ getAllTagsFromCache: () => noteTags }),
            sync,
            loadNote: jest.fn(() => Promise.resolve(loadedNote)),
        },
        isUiManagerLoaded: () => true,
        uiManager: { contentManager: { editCurrentQuestion } },
    } as unknown as SRPlugin;
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

/** Writes the note in edit(): records the text, resolves to whether the card was found */
let writeText: jest.Mock<Promise<boolean>, [string]>;
/** Deletes the card in edit(): resolves to whether the card was found */
let deleteQuestion: jest.Mock<Promise<boolean>, []>;

beforeEach(() => {
    writeText = jest.fn((_text: string) => Promise.resolve(true));
    deleteQuestion = jest.fn(() => Promise.resolve(true));
});

/** Opens the editor for a question and waits until it is shown */
async function edit(question: Question): Promise<Session> {
    const result = service.editQuestion(question, writeText, deleteQuestion);
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
    return {
        text: state.text,
        ink:
            state.strokes.length > 0
                ? { strokes: state.strokes, penSize: state.penSize, changed: false }
                : null,
    };
}

/** A side with only typed text: its handwriting, if it had any, erased */
const text = (t: string): SideResult => ({ text: t, ink: null });
/** A side with only handwriting: its typed text, if it had any, deleted */
const ink = (strokes: Stroke[], changed = true, typed = ""): SideResult => ({
    text: typed,
    ink: { strokes, penSize: 5, changed },
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
![[sr-ink/sr-ink-20261031-141502123-back.svg]]
`;

const inkNote = `#flashcards

![[sr-ink/sr-ink-abc-front.svg]]
?
![[sr-ink/sr-ink-abc-back.svg]]
`;

describe("loading a card", () => {
    test("splits front and back only at the card separator", async () => {
        const { opts } = await edit((await parseQuestions(textNote))[0]);

        expect(opts.initial.front).toEqual({
            text: "When plugged in, bad chargers spark 80% of the time. What's the probability that a sparking charger is bad?",
            strokes: [],
            penSize: settings.cardEditorPenSize,
        });
        expect(opts.initial.back.text).toEqual(
            "**Prior odds:** $\\text{bad} : \\text{good} = 3 : 97$\n**Probability:** $\\frac{48}{48 + 97} \\approx 33\\%$",
        );
    });

    test("opens a handwritten side with the strokes and pen size of its SVG", async () => {
        vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0), stroke(40)]));
        const { opts } = await edit(await parseQuestion(mixedNote));

        expect(opts.initial.front.text).toEqual("What is the powerhouse of the cell?");
        expect(opts.initial.front.strokes).toEqual([]);
        expect(opts.initial.back.text).toEqual("");
        expect(opts.initial.back.penSize).toEqual(7);
        expect(opts.initial.back.strokes).toHaveLength(2);
        expect(vault.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
            "sr-ink/sr-ink-20261031-141502123-back.svg",
            NOTE_PATH,
        );
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
        expect(writeText).not.toHaveBeenCalled();
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
        expect(writeText).toHaveBeenCalledWith(result.text, CardType.MultiLineBasic);
    });

    test("cancel resolves to null and writes nothing", async () => {
        vault.add("sr-ink/sr-ink-abc-front.svg", svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(inkNote));
        session.opts.closed();

        await expect(session.result).resolves.toBeNull();
        expect(vault.app.vault.modify).not.toHaveBeenCalled();
        expect(vault.app.fileManager.trashFile).not.toHaveBeenCalled();
    });

    test("changed ink overwrites its SVG and keeps the note text", async () => {
        const back = vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
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

    test("new ink creates an SVG named after the card's other ink side", async () => {
        vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(mixedNote));

        const result = await save(session, {
            front: ink([stroke(3)]),
            back: unchanged(session.opts.initial.back),
        });
        const path = "sr-ink/sr-ink-20261031-141502123-front.svg";
        expect(vault.content(path)).toBeDefined();
        expect(svgToStrokes(vault.content(path)).size).toEqual(5);
        expect(result.textChanged).toBe(true);
        expect(result.changedImages).toEqual([]);
        expect(result.text).toEqual(
            `![[${path}]]\n?\n![[sr-ink/sr-ink-20261031-141502123-back.svg]]`,
        );
    });

    test("new ink doesn't reuse a stem whose file name is taken", async () => {
        vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
        vault.add("old/sr-ink-20261031-141502123-front.svg", svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(mixedNote));

        const result = await save(session, {
            front: ink([stroke(3)]),
            back: unchanged(session.opts.initial.back),
        });
        const name = inkEmbedFileName(result.text.split("\n?\n")[0]);
        expect(name).toMatch(/^sr-ink-.+-front\.svg$/);
        expect(name).not.toEqual("sr-ink-20261031-141502123-front.svg");
        expect(vault.content("old/sr-ink-20261031-141502123-front.svg")).toBeDefined();
    });

    test("erased ink moves the SVG to the trash", async () => {
        const back = vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
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

    test("Delete card deletes the card and moves its SVGs to the trash", async () => {
        const back = vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(mixedNote));
        await session.opts.delete();
        session.opts.closed();
        await expect(session.result).resolves.toEqual({
            text: "",
            textChanged: true,
            changedImages: [],
            deleted: true,
        });
        expect(deleteQuestion).toHaveBeenCalledTimes(1);
        expect(writeText).not.toHaveBeenCalled();
        expect(vault.app.fileManager.trashFile).toHaveBeenCalledWith(back);
    });

    test("Delete card keeps the SVGs when the card is no longer in the note", async () => {
        vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
        deleteQuestion.mockResolvedValueOnce(false);
        const session = await edit(await parseQuestion(mixedNote));
        await expect(session.opts.delete()).rejects.toThrow();
        expect(vault.app.fileManager.trashFile).not.toHaveBeenCalled();
    });

    test("erased ink keeps an SVG that other cards or notes still embed", async () => {
        const back = vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
        const links = vault.app.metadataCache.resolvedLinks;
        const toText = async () => {
            ModalMock.mockClear();
            const session = await edit(await parseQuestion(mixedNote));
            await save(session, {
                front: unchanged(session.opts.initial.front),
                back: text("Mitochondria"),
            });
        };

        // Embedded in another note too
        links[NOTE_PATH] = { [back.path]: 1 };
        links["notes/summary.md"] = { [back.path]: 1 };
        await toText();
        expect(vault.app.fileManager.trashFile).not.toHaveBeenCalled();

        // Embedded twice in this note, e.g. by a copy of the card
        delete links["notes/summary.md"];
        links[NOTE_PATH] = { [back.path]: 2 };
        await toText();
        expect(vault.app.fileManager.trashFile).not.toHaveBeenCalled();

        // Only this card embeds it
        links[NOTE_PATH] = { [back.path]: 1 };
        await toText();
        expect(vault.app.fileManager.trashFile).toHaveBeenCalledWith(back);
    });

    test("erased ink decides what to keep before the link index catches up with the write", async () => {
        const front = vault.add("sr-ink/sr-ink-abc-front.svg", svgOf([stroke(0)]));
        const back = vault.add("sr-ink/sr-ink-abc-back.svg", svgOf([stroke(5)]));
        const links = vault.app.metadataCache.resolvedLinks;
        // The back is also embedded in another note
        links[NOTE_PATH] = { [front.path]: 1, [back.path]: 1 };
        links["notes/summary.md"] = { [back.path]: 1 };
        // Obsidian re-indexes the note right after it is written
        writeText.mockImplementation(() => {
            links[NOTE_PATH] = {};
            return Promise.resolve(true);
        });

        const session = await edit(await parseQuestion(inkNote));
        await save(session, { front: text("Q"), back: text("A") });

        expect(vault.app.fileManager.trashFile).toHaveBeenCalledTimes(1);
        expect(vault.app.fileManager.trashFile).toHaveBeenCalledWith(front);
        expect(vault.content(back.path)).toBeDefined();
    });

    test("a typed line that would split or end the card is rejected, nothing is written", async () => {
        settings.multilineCardEndMarker = "---";
        const back = vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(mixedNote + "---\n"));

        await expect(
            session.opts.save({
                front: unchanged(session.opts.initial.front),
                back: text("Answer\n---\nMore detail"),
            }),
        ).rejects.toThrow('only "---"');
        await expect(
            session.opts.save({
                front: text("Question\n?\nmore"),
                back: unchanged(session.opts.initial.back),
            }),
        ).rejects.toThrow('only "?"');
        expect(writeText).not.toHaveBeenCalled();
        expect(vault.content(back.path)).toBeDefined();
    });

    test("erased ink keeps an SVG a note or canvas refers to, even if the link index doesn't know", async () => {
        const back = vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
        vault.app.metadataCache.resolvedLinks[NOTE_PATH] = { [back.path]: 1 };
        const toText = async () => {
            ModalMock.mockClear();
            const session = await edit(await parseQuestion(mixedNote));
            await save(session, {
                front: unchanged(session.opts.initial.front),
                back: text("Mitochondria"),
            });
        };
        const other = (content: string, path = "notes/summary.md") => {
            vault.files.clear();
            vault.add(back.path, svgOf([stroke(0)]));
            vault.add(path, content);
        };

        for (const [content, path] of [
            ["See [[sr-ink-20261031-141502123-back.svg]]", undefined],
            ['{"nodes":[{"file":"sr-ink/sr-ink-20261031-141502123-back.svg"}]}', "board.canvas"],
        ]) {
            other(content, path);
            await toText();
            expect(vault.app.fileManager.trashFile).not.toHaveBeenCalled();
        }

        // A link to a file of the same name in another folder doesn't keep it
        other("![[archive/sr-ink-20261031-141502123-back.svg]]");
        vault.add("archive/sr-ink-20261031-141502123-back.svg", svgOf([stroke(3)]));
        await toText();
        expect(vault.app.fileManager.trashFile).toHaveBeenCalledTimes(1);
        expect(vault.content(back.path)).toBeUndefined();
    });

    test("the embed's folder decides which file is edited, not just its name", async () => {
        const archived = vault.add("archive/sr-ink-abc-front.svg", svgOf([stroke(0)]));
        const front = vault.add("sr-ink/sr-ink-abc-front.svg", svgOf([stroke(1), stroke(2)]));
        vault.add("sr-ink/sr-ink-abc-back.svg", svgOf([stroke(5)]));
        const session = await edit(await parseQuestion(inkNote));
        expect(session.opts.initial.front.strokes).toHaveLength(2);

        const result = await save(session, {
            front: ink([stroke(9)]),
            back: unchanged(session.opts.initial.back),
        });
        expect(result.changedImages).toEqual([front]);
        expect(vault.content(archived.path)).toEqual(svgOf([stroke(0)]));
    });

    test("the note write is the commit point: if it finds no card, everything is undone", async () => {
        const back = vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
        const original = vault.content(back.path);
        writeText.mockResolvedValue(false);

        // ink → text: the SVG stays
        let session = await edit(await parseQuestion(mixedNote));
        await expect(
            session.opts.save({ front: text("Typed"), back: text("Mitochondria") }),
        ).rejects.toThrow("The card's text in the note has changed");
        expect(vault.app.fileManager.trashFile).not.toHaveBeenCalled();
        expect(vault.content(back.path)).toEqual(original);

        // text → ink and ink → ink: the new SVG is removed, the rewritten one restored
        ModalMock.mockClear();
        session = await edit(await parseQuestion(mixedNote));
        await expect(
            session.opts.save({ front: ink([stroke(3)]), back: ink([stroke(4)]) }),
        ).rejects.toThrow("The card's text in the note has changed");
        expect([...vault.files.keys()]).toEqual([back.path]);
        expect(vault.content(back.path)).toEqual(original);

        session.opts.closed();
        await expect(session.result).resolves.toBeNull();
    });

    test("a failed ink write removes the files already created and keeps the editor open", async () => {
        const back = vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
        vault.app.vault.modify.mockRejectedValueOnce(new Error("disk full"));
        const session = await edit(await parseQuestion(mixedNote));

        await expect(
            session.opts.save({ front: ink([stroke(3)]), back: ink([stroke(4)]) }),
        ).rejects.toThrow("disk full");
        expect([...vault.files.keys()]).toEqual([back.path]);
        expect(vault.content(back.path)).toEqual(svgOf([stroke(0)]));
        expect(writeText).not.toHaveBeenCalled();

        // The editor stays open; closing it now is a cancel
        session.opts.closed();
        await expect(session.result).resolves.toBeNull();
    });
});

describe("sides with typed text and handwriting", () => {
    const BACK = "sr-ink/sr-ink-20261031-141502123-back.svg";
    const combinedNote = `#flashcards

What is the powerhouse of the cell?
?
Mitochondria, drawn:
![[${BACK}]]
`;

    test("loads the typed text and the strokes of a side holding both", async () => {
        vault.add(BACK, svgOf([stroke(0), stroke(40)]));
        const { opts } = await edit(await parseQuestion(combinedNote));
        expect(opts.initial.back.text).toEqual("Mitochondria, drawn:");
        expect(opts.initial.back.strokes).toHaveLength(2);
        expect(opts.initial.back.penSize).toEqual(7);
    });

    test("changed typed text keeps the embed after it; the SVG is untouched", async () => {
        vault.add(BACK, svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(combinedNote));
        const { front, back } = session.opts.initial;
        const result = await save(session, {
            front: unchanged(front),
            back: { ...unchanged(back), text: "The mitochondrion:\n\nsee drawing" },
        });
        expect(result.text).toEqual(
            `What is the powerhouse of the cell?\n?\nThe mitochondrion:\n<br>\nsee drawing\n![[${BACK}]]`,
        );
        expect(result.changedImages).toEqual([]);
        expect(vault.app.vault.modify).not.toHaveBeenCalled();
    });

    test("writing on a typed side adds a new SVG after the text", async () => {
        vault.add(BACK, svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(mixedNote));
        const result = await save(session, {
            front: ink([stroke(3)], true, "What is the powerhouse of the cell?"),
            back: unchanged(session.opts.initial.back),
        });
        expect(result.text).toEqual(
            `What is the powerhouse of the cell?\n![[sr-ink/sr-ink-20261031-141502123-front.svg]]\n?\n![[${BACK}]]`,
        );
        expect(vault.content("sr-ink/sr-ink-20261031-141502123-front.svg")).toBeDefined();
    });

    test("erasing all strokes removes the embed, keeps the typed text and trashes the SVG", async () => {
        const back = vault.add(BACK, svgOf([stroke(0)]));
        const session = await edit(await parseQuestion(combinedNote));
        const result = await save(session, {
            front: unchanged(session.opts.initial.front),
            back: text("Mitochondria, drawn:"),
        });
        expect(result.text).toEqual("What is the powerhouse of the cell?\n?\nMitochondria, drawn:");
        expect(vault.app.fileManager.trashFile).toHaveBeenCalledWith(back);
    });
});

describe("adding cards", () => {
    const NOTE = "#flashcards\n";
    let note: TFile;

    type AddOptions = Extract<CardEditorOptions, { kind: "add" }>;

    beforeEach(() => {
        note = vault.add(NOTE_PATH, NOTE);
    });

    /** Opens the add editor on the note (no editor open, so cards are appended) */
    function openAdd(): AddOptions {
        service.openAdd(note, null);
        const calls = ModalMock.mock.calls;
        const opts = calls[calls.length - 1][2];
        if (opts.kind !== "add") throw new Error("not opened for adding");
        return opts;
    }

    async function flush() {
        for (let i = 0; i < 10; i++) await Promise.resolve();
    }

    test("typed cards are appended to the note, one after the other", async () => {
        const opts = openAdd();
        expect(opts.title).toEqual("bio");
        expect(opts.draft).toBeNull();

        await opts.save({ front: text("Q1  "), back: text("A1") });
        await opts.save({ front: text("Q2"), back: text("A2") });

        expect(vault.content(NOTE_PATH)).toEqual("#flashcards\n\nQ1\n?\nA1\n\nQ2\n?\nA2\n");
        expect(vault.app.vault.create).not.toHaveBeenCalled();
    });

    test("a typed line that would end the card is rejected, the SVGs made for it are removed", async () => {
        settings.multilineCardEndMarker = "---";
        const opts = openAdd();
        await expect(
            opts.save({ front: ink([stroke(0)]), back: text("Answer\n---\nMore detail") }),
        ).rejects.toThrow('only "---"');
        expect(vault.content(NOTE_PATH)).toEqual(NOTE);
        expect(vault.app.fileManager.trashFile).toHaveBeenCalledTimes(1);
    });

    test("a typed side the parser would read as other card syntax is rejected, naming the side", async () => {
        const opts = openAdd();
        await expect(
            opts.save({ front: text("What does std::vector do?"), back: text("A dynamic array") }),
        ).rejects.toThrow("Front");
        await expect(
            opts.save({ front: text("What is a vector?"), back: text("See std::vector") }),
        ).rejects.toThrow("Back");
        // A tag at the start would be read as the card's deck
        await expect(opts.save({ front: text("#biology Cells"), back: text("A") })).rejects.toThrow(
            "Front",
        );
        expect(vault.content(NOTE_PATH)).toEqual(NOTE);

        await opts.save({ front: text("What does `std::vector` do?"), back: text("A") });
        expect(vault.content(NOTE_PATH)).toEqual(`${NOTE}\nWhat does \`std::vector\` do?\n?\nA\n`);
    });

    test("the end marker follows a blank line", async () => {
        settings.multilineCardEndMarker = "---";
        const opts = openAdd();
        await opts.save({ front: text("Q"), back: text("A") });
        expect(vault.content(NOTE_PATH)).toEqual("#flashcards\n\nQ\n?\nA\n\n---\n");
    });

    test("handwritten sides become SVGs sharing one stem, embedded in the card", async () => {
        const opts = openAdd();
        await opts.save({ front: ink([stroke(0)]), back: ink([stroke(5), stroke(9)]) });

        const cardText = vault.content(NOTE_PATH).slice(NOTE.length).trim();
        const [front, back] = cardText.split("\n?\n");
        const frontName = inkEmbedFileName(front);
        const backName = inkEmbedFileName(back);
        expect(front).toEqual(`![[sr-ink/${frontName}]]`);
        expect(parseInkFileName(frontName)).toEqual({
            stem: parseInkFileName(backName).stem,
            side: "front",
        });
        expect(parseInkFileName(backName).side).toEqual("back");
        expect(svgToStrokes(vault.content(`sr-ink/${backName}`)).strokes).toHaveLength(2);
    });

    test("a mixed card has a typed front and a handwritten back", async () => {
        const opts = openAdd();
        await opts.save({
            front: text("What is the powerhouse of the cell?"),
            back: ink([stroke(0)]),
        });

        const [front, back] = vault.content(NOTE_PATH).slice(NOTE.length).trim().split("\n?\n");
        expect(front).toEqual("What is the powerhouse of the cell?");
        expect(inkEmbedFileName(back)).toMatch(/^sr-ink-.+-back\.svg$/);
        expect(vault.app.vault.create).toHaveBeenCalledTimes(1);
    });

    test("a failed insert rejects the save and removes the new SVGs", async () => {
        vault.app.vault.process.mockRejectedValueOnce(new Error("disk full"));
        const opts = openAdd();

        await expect(
            opts.save({ front: ink([stroke(0)]), back: ink([stroke(5)]) }),
        ).rejects.toThrow("disk full");
        expect(vault.app.fileManager.trashFile).toHaveBeenCalledTimes(2);
        expect([...vault.files.keys()]).toEqual([NOTE_PATH]);
    });

    test("the note is rescanned after closing, if cards were added", async () => {
        let opts = openAdd();
        opts.keepDraft(null);
        opts.closed();
        await flush();
        expect(sync).not.toHaveBeenCalled();

        opts = openAdd();
        await opts.save({ front: text("Q"), back: text("A") });
        expect(sync).not.toHaveBeenCalled();
        opts.keepDraft(null);
        opts.closed();
        await flush();
        expect(sync).toHaveBeenCalledTimes(1);
    });

    test("the card type decides what is written: ?, ?? or a cloze card", async () => {
        const opts = openAdd();
        await opts.save({
            cardType: CardType.MultiLineBasic,
            front: text("Q1"),
            back: text("A1"),
        });
        await opts.save({
            cardType: CardType.MultiLineReversed,
            front: text("Q2"),
            back: text("A2"),
        });
        await opts.save({
            cardType: CardType.Cloze,
            front: text("The ==heart== pumps"),
            back: null,
        });
        expect(vault.content(NOTE_PATH)).toEqual(
            "#flashcards\n\nQ1\n?\nA1\n\nQ2\n??\nA2\n\nThe ==heart== pumps\n",
        );
    });

    test("a cloze card gets the end marker; it must be read back as a cloze card", async () => {
        settings.multilineCardEndMarker = "---";
        const opts = openAdd();
        await opts.save({
            cardType: CardType.Cloze,
            front: text("The ==heart==\n\npumps"),
            back: null,
        });
        expect(vault.content(NOTE_PATH)).toEqual("#flashcards\n\nThe ==heart==\n\npumps\n\n---\n");
        await expect(
            opts.save({ cardType: CardType.Cloze, front: text("No cloze ? here"), back: null }),
        ).rejects.toThrow("Cloze");
    });

    test("the decks of the note go to the editor; none: an empty list, no notice", () => {
        noteTags = ["#flashcards/medicine", "#other", "#flashcards/biology/cells"];
        expect(openAdd().decks).toEqual(["medicine", "biology/cells"]);
        noteTags = ["#other"];
        expect(openAdd().decks).toEqual([]);
        expect(Notice).not.toHaveBeenCalled();
    });

    test("an unsaved card is restored the next time", () => {
        const draft: CardEditorSides = {
            front: { text: "Q", strokes: [], penSize: 5 },
            back: { text: "A", strokes: [stroke(0)], penSize: 5 },
        };
        openAdd().keepDraft(draft);
        const opts = openAdd();
        expect(opts.draft).toBe(draft);

        opts.keepDraft(null);
        expect(openAdd().draft).toBeNull();
    });
});

describe("editing from a note", () => {
    const pencilNote = `#flashcards

What is the powerhouse of the cell?
?
![[sr-ink/sr-ink-20261031-141502123-back.svg]]
<!--SR:!2026-10-27,3,250-->

Draw a cell::![](sr-ink/sr-ink-xyz-back.svg)
`;
    let noteFile: UnitTestSRFile;

    beforeEach(async () => {
        vault.add("sr-ink/sr-ink-20261031-141502123-back.svg", svgOf([stroke(0)]));
        vault.add("sr-ink/sr-ink-xyz-back.svg", svgOf([stroke(1)]));
        noteFile = new UnitTestSRFile(pencilNote, NOTE_PATH);
        const parser = createTestNoteQuestionParser(settings);
        const questions = await parser.createQuestionList(
            noteFile,
            TextDirection.Ltr,
            TopicPath.emptyPath,
            true,
        );
        loadedNote = new Note(noteFile, questions);
    });

    /** Taps the pencil on an image and waits until the editor is shown */
    async function tapPencil(imageName: string) {
        const done = service.editInNote(
            { path: NOTE_PATH, extension: "md" } as TFile,
            vault.byName(imageName) ?? ({ path: `sr-ink/${imageName}` } as TFile),
        );
        for (let i = 0; i < 20 && ModalMock.mock.calls.length === 0; i++) await Promise.resolve();
        const opts = ModalMock.mock.calls[0]?.[2];
        return { done, opts: opts?.kind === "edit" ? opts : null };
    }

    const find = (path: string) =>
        findQuestionWithInk(loadedNote.questionList, { path } as TFile, (link) =>
            vault.byLink(link),
        );

    test("finds the card whose text embeds the image, in either embed form", () => {
        const [first, second] = loadedNote.questionList;
        expect(find("sr-ink/sr-ink-20261031-141502123-back.svg")).toBe(first);
        expect(find("sr-ink/sr-ink-xyz-back.svg")).toBe(second);
        expect(find("sr-ink/sr-ink-other-back.svg")).toBeNull();
    });

    test("a changed text is written to the note, keeping the schedule, and the vault is rescanned", async () => {
        const { done, opts } = await tapPencil("sr-ink-20261031-141502123-back.svg");
        await opts.save({
            front: text("What is the powerhouse of the eukaryotic cell?"),
            back: unchanged(opts.initial.back),
        });
        opts.closed();
        await done;

        expect(noteFile.content).toEqual(
            pencilNote.replace("of the cell?", "of the eukaryotic cell?"),
        );
        expect(sync).toHaveBeenCalledTimes(1);
    });

    test("basic ⇄ reversed writes the other separator and keeps the schedule", async () => {
        const { done, opts } = await tapPencil("sr-ink-20261031-141502123-back.svg");
        await opts.save({
            cardType: CardType.MultiLineReversed,
            front: unchanged(opts.initial.front),
            back: unchanged(opts.initial.back),
        });
        opts.closed();
        await done;
        expect(noteFile.content).toEqual(pencilNote.replace("cell?\n?\n", "cell?\n??\n"));

        ModalMock.mockClear();
        const second = await tapPencil("sr-ink-xyz-back.svg");
        await second.opts.save({
            cardType: CardType.SingleLineReversed,
            front: unchanged(second.opts.initial.front),
            back: unchanged(second.opts.initial.back),
        });
        second.opts.closed();
        await second.done;
        expect(noteFile.content).toContain("Draw a cell:::![](sr-ink/sr-ink-xyz-back.svg)");
    });

    test("changed ink rewrites only the image, and its copies are reloaded", async () => {
        const refresh = jest.spyOn(service.inkFiles, "refresh");
        const { done, opts } = await tapPencil("sr-ink-xyz-back.svg");
        await opts.save({ front: unchanged(opts.initial.front), back: ink([stroke(7)]) });
        opts.closed();
        await done;

        expect(noteFile.content).toEqual(pencilNote);
        expect(sync).not.toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledWith([vault.byName("sr-ink-xyz-back.svg")]);
        expect(svgToStrokes(vault.content("sr-ink/sr-ink-xyz-back.svg")).strokes).toEqual([
            { ...stroke(7), size: 5 },
        ]);
    });

    test("a card changed in the note meanwhile: the save fails, the note and SVGs stay", async () => {
        const { done, opts } = await tapPencil("sr-ink-20261031-141502123-back.svg");
        const changed = pencilNote.replace("powerhouse", "power plant");
        noteFile.content = changed;

        await expect(
            opts.save({ front: text("Typed"), back: text("Mitochondria") }),
        ).rejects.toThrow("The card's text in the note has changed");
        expect(noteFile.content).toEqual(changed);
        expect(vault.content("sr-ink/sr-ink-20261031-141502123-back.svg")).toBeDefined();
        expect(loadedNote.questionList[0].questionText.actualQuestion).toContain("powerhouse");

        opts.closed();
        await done;
        expect(sync).not.toHaveBeenCalled();
    });

    test("unsaved typing in an editor showing the note is saved before the card is read", async () => {
        const save = jest.fn(() => Promise.resolve());
        const other = jest.fn(() => Promise.resolve());
        markdownLeaves = [
            {
                view: Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
                    file: { path: NOTE_PATH },
                    save,
                }),
            },
            {
                view: Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
                    file: { path: "x.md" },
                    save: other,
                }),
            },
        ];
        const { done, opts } = await tapPencil("sr-ink-xyz-back.svg");
        expect(save).toHaveBeenCalledTimes(1);
        expect(other).not.toHaveBeenCalled();
        opts.closed();
        await done;
    });

    test("next card saves the changes, opens the next card's editor; rescanned once at the end", async () => {
        const { done, opts } = await tapPencil("sr-ink-20261031-141502123-back.svg");
        expect(opts.steps).toMatchObject({ prev: false, next: true });

        // As the editor steps: save, stepped, closed
        await opts.save({
            front: text("What is the powerhouse of the eukaryotic cell?"),
            back: unchanged(opts.initial.back),
        });
        opts.steps.stepped(1);
        opts.closed();
        for (let i = 0; i < 20 && ModalMock.mock.calls.length < 2; i++) await Promise.resolve();
        expect(ModalMock).toHaveBeenCalledTimes(2);
        const second = ModalMock.mock.calls[1][2];
        if (second.kind !== "edit") throw new Error("not opened for editing");
        expect(second.initial.front.text).toEqual("Draw a cell");
        expect(second.steps).toMatchObject({ prev: true, next: false });
        expect(sync).not.toHaveBeenCalled();

        // Back to the first card, without changes: nothing is written
        second.steps.stepped(-1);
        second.closed();
        for (let i = 0; i < 20 && ModalMock.mock.calls.length < 3; i++) await Promise.resolve();
        const third = ModalMock.mock.calls[2][2];
        if (third.kind !== "edit") throw new Error("not opened for editing");
        expect(third.initial.front.text).toEqual("What is the powerhouse of the eukaryotic cell?");
        third.closed();
        await done;

        expect(noteFile.content).toEqual(
            pencilNote.replace("of the cell?", "of the eukaryotic cell?"),
        );
        expect(sync).toHaveBeenCalledTimes(1);
    });

    test("a failed save doesn't step", async () => {
        const { done, opts } = await tapPencil("sr-ink-20261031-141502123-back.svg");
        noteFile.content = pencilNote.replace("powerhouse", "power plant");
        await expect(
            opts.save({ front: text("Typed"), back: unchanged(opts.initial.back) }),
        ).rejects.toThrow();
        // The editor stays open; closed later with ✕
        opts.closed();
        await done;
        expect(ModalMock).toHaveBeenCalledTimes(1);
        expect(sync).not.toHaveBeenCalled();
    });

    test("an image that is not part of a card opens no editor", async () => {
        const { done, opts } = await tapPencil("sr-ink-other-back.svg");
        await done;
        expect(opts).toBeNull();
        expect(Notice).toHaveBeenCalledTimes(1);

        loadedNote = null;
        await service.editInNote(
            { path: NOTE_PATH, extension: "md" } as TFile,
            vault.byName("sr-ink-xyz-back.svg"),
        );
        expect(Notice).toHaveBeenCalledTimes(2);
        expect(ModalMock).not.toHaveBeenCalled();
    });
});

describe("unloading the plugin", () => {
    test("closes the open editors, which then write nothing; no editor opens any more", async () => {
        const note = vault.add(NOTE_PATH, "#flashcards\n");
        service.openAdd(note, null);
        const addOpts = ModalMock.mock.calls[0][2];
        const question = await parseQuestion(mixedNote);
        const session = await edit2(question);

        service.destroy();
        for (const modal of ModalMock.mock.instances) {
            // eslint-disable-next-line @typescript-eslint/unbound-method
            expect(modal.close).toHaveBeenCalled();
        }

        await expect(addOpts.save({ front: text("Q"), back: text("A") })).rejects.toThrow();
        await expect(
            session.opts.save({ front: text("Typed"), back: text("A") }),
        ).rejects.toThrow();
        expect(vault.content(NOTE_PATH)).toEqual("#flashcards\n");
        expect(writeText).not.toHaveBeenCalled();
        addOpts.closed();
        session.opts.closed();
        await expect(session.result).resolves.toBeNull();
        expect(sync).not.toHaveBeenCalled();

        ModalMock.mockClear();
        service.openAdd(note, null);
        await expect(service.editQuestion(question, writeText, deleteQuestion)).resolves.toBeNull();
        expect(ModalMock).not.toHaveBeenCalled();
    });

    /** Like edit(), with another editor open already */
    async function edit2(question: Question): Promise<Session> {
        const result = service.editQuestion(question, writeText, deleteQuestion);
        for (let i = 0; i < 20 && ModalMock.mock.calls.length < 2; i++) await Promise.resolve();
        const opts = ModalMock.mock.calls[1][2];
        if (opts.kind !== "edit") throw new Error("not opened for editing");
        return { opts, result };
    }
});

test("the pencil in the review window edits like the toolbar's Edit button", async () => {
    await service.editInReview();
    expect(editCurrentQuestion).toHaveBeenCalledTimes(1);
});
