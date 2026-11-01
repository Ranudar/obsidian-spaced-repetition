import { App, Notice, Platform } from "obsidian";

import {
    CardEditorModal,
    CardEditorOptions,
    CardEditorResult,
    CardEditorSides,
    SideResult,
} from "src/card-editor/card-editor-modal";
import { Stroke } from "src/card-editor/core/strokes";
import { InkField } from "src/card-editor/ink-field";
import { SideEditor, SideState } from "src/card-editor/side-editor";
import { CardType } from "src/data/data-structures/card/questions/question";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";

// jsdom has no canvas; the ink field only needs a context object to exist
beforeAll(() => {
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        () => ({}) as unknown as CanvasRenderingContext2D,
    );
});

afterAll(() => {
    jest.restoreAllMocks();
});

afterEach(() => {
    document.body.replaceChildren();
    (Notice as unknown as jest.Mock).mockClear();
    jest.useRealTimers();
});

/** A stroke as written in the editor: with its own size */
const stroke = (x: number, size = 5): Stroke => ({
    points: [
        [x, 0, 0.5],
        [x + 10, 10, 0.5],
    ],
    pressure: false,
    size,
});

const side = (s: Partial<SideState> = {}): SideState => ({
    text: "",
    strokes: [],
    penSize: 5,
    ...s,
});

interface Callbacks {
    save: jest.Mock<Promise<void>, [CardEditorResult]>;
    keepDraft: jest.Mock<void, [CardEditorSides | null]>;
    closed: jest.Mock<void, []>;
    delete: jest.Mock<Promise<void>, []>;
}

/** Handlers registered on the workspace, by event name */
let workspaceEvents: Map<string, () => void>;

/** An app with just the workspace events the editor subscribes to */
function testApp(): App {
    workspaceEvents = new Map();
    return {
        workspace: {
            on: (name: string, callback: () => void) => {
                workspaceEvents.set(name, callback);
                return { name };
            },
            offref: (ref: { name: string }) => workspaceEvents.delete(ref.name),
        },
    } as unknown as App;
}

function callbacks(): Callbacks {
    return {
        save: jest.fn<Promise<void>, [CardEditorResult]>(() => Promise.resolve()),
        keepDraft: jest.fn<void, [CardEditorSides | null]>(),
        closed: jest.fn<void, []>(),
        delete: jest.fn<Promise<void>, []>(() => Promise.resolve()),
    };
}

function openAdd(
    draft: CardEditorSides | null = null,
    settings: Partial<SRSettings> = {},
): { modal: CardEditorModal; cb: Callbacks } {
    const cb = callbacks();
    const opts: CardEditorOptions = { kind: "add", title: "Biology", draft, ...cb };
    const modal = new CardEditorModal(testApp(), { ...DEFAULT_SETTINGS, ...settings }, opts);
    modal.open();
    return { modal, cb };
}

function openEdit(
    initial: CardEditorSides,
    cardType = CardType.MultiLineBasic,
): { modal: CardEditorModal; cb: Callbacks } {
    const cb = callbacks();
    const opts: CardEditorOptions = {
        kind: "edit",
        title: "Edit card",
        initial,
        cardType,
        save: cb.save,
        closed: cb.closed,
        delete: cb.delete,
    };
    const modal = new CardEditorModal(testApp(), DEFAULT_SETTINGS, opts);
    modal.open();
    return { modal, cb };
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.body.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) =>
    Array.from(document.body.querySelectorAll<T>(sel));

const textAreas = () => $$<HTMLTextAreaElement>("textarea.sr-card-editor-text");
const button = (text: string) =>
    $$<HTMLButtonElement>("button").find((b) => b.textContent === text);
const iconButton = (label: string) => $<HTMLButtonElement>(`button[aria-label="${label}"]`);
const eraser = () => iconButton("Eraser (or hold the pen button)");
const penSize = () => $<HTMLButtonElement>("button.sr-card-editor-pen-size");
const undo = () => iconButton("Undo");
const clearSide = () => iconButton("Clear side");
const saveNext = () => button("Save & next");
const saveClose = () => button("Save & close");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sideEls = () => $$(".sr-card-editor-side");
const inkFields = () => $$(".sr-ink-field");
/** A text side as saved */
const textOnly = (text: string): SideResult => ({ text, ink: null });

function type(index: number, text: string) {
    const ta = textAreas()[index];
    ta.value = text;
    ta.dispatchEvent(new Event("input"));
}

function keyDown(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
    const evt = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(evt);
    return evt;
}

describe("CardEditorModal layout", () => {
    test("add mode: title, two text sides, single visible close button", () => {
        openAdd();
        expect($(".sr-card-editor-title").textContent).toBe("Biology");
        expect(textAreas()).toHaveLength(2);
        expect($(".modal-close-button").hasClass("sr-card-editor-chrome-hidden")).toBe(true);
        expect($(".modal-bg").hasClass("sr-card-editor-chrome-hidden")).toBe(false);
        expect($$(".sr-card-editor-close")).toHaveLength(1);
        expect($(".sr-card-editor-header").lastElementChild).toBe($(".sr-card-editor-close"));
        expect(saveNext()).toBeDefined();
        expect(saveClose()).toBeDefined();
        expect(button("Delete card")).toBeDefined();
        expect(document.activeElement).toBe(textAreas()[0]);
    });

    test("footer: Delete card, Save & close, Save & next; the counter is hidden at 0", () => {
        openAdd();
        const footerButtons = $$<HTMLButtonElement>(".sr-card-editor-footer button");
        expect(footerButtons.map((b) => b.textContent)).toEqual([
            "Delete card",
            "Save & close",
            "Save & next",
        ]);
        expect($(".sr-card-editor-footer .sr-card-editor-counter")).toBeNull();
        expect($(".sr-card-editor-counter").hasClass("sr-is-hidden")).toBe(true);
        expect($(".sr-card-editor-counter").textContent).toBe("");
    });

    test("every side has a text area and an ink field, without a mode switch", () => {
        openAdd();
        expect(inkFields()).toHaveLength(2);
        sideEls().forEach((el) => {
            const body = el.querySelector(".sr-card-editor-side-body");
            expect(body.firstElementChild.tagName).toBe("TEXTAREA");
            expect(body.lastElementChild.hasClass("sr-card-editor-ink")).toBe(true);
        });
        expect($("[class*='mode']")).toBeNull();
    });

    test("edit mode: Delete card and Save, sides loaded from the card", () => {
        openEdit({
            front: side({ text: "Q" }),
            back: side({ text: "A", strokes: [stroke(0)] }),
        });
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q", "A"]);
        expect(inkFields()[0].hasClass("is-empty")).toBe(true);
        expect(inkFields()[1].hasClass("is-empty")).toBe(false);
        expect(button("Cancel")).toBeUndefined();
        expect(button("Delete card")).toBeDefined();
        expect(button("Save")).toBeDefined();
        expect(saveNext()).toBeUndefined();
        expect($(".sr-card-editor-counter")).toBeNull();
    });

    test("cloze: one text side without ink field", () => {
        openEdit({ front: side({ text: "a ==b==" }), back: null }, CardType.Cloze);
        expect($$(".sr-card-editor-side")).toHaveLength(1);
        expect($(".sr-card-editor-side-label").textContent).toBe("Card");
        expect(inkFields()).toHaveLength(0);
        expect(eraser().disabled).toBe(true);
        expect(penSize().disabled).toBe(true);
        expect(clearSide().disabled).toBe(false);
    });
});

describe("CardEditorModal add mode", () => {
    test("save is disabled until both sides have content", () => {
        openAdd();
        expect(saveNext().disabled).toBe(true);
        // An empty card is closed with ✕, Esc or Delete
        expect(saveClose().disabled).toBe(true);
        type(0, "Q");
        expect(saveNext().disabled).toBe(true);
        expect(saveClose().disabled).toBe(true);
        type(1, "   ");
        expect(saveNext().disabled).toBe(true);
        type(1, "A");
        expect(saveNext().disabled).toBe(false);
        expect(saveClose().disabled).toBe(false);
    });

    test("Save & next saves, clears the sides, counts and focuses the front", async () => {
        const { cb } = openAdd();
        type(0, "Q1");
        type(1, "A1");
        saveNext().click();
        await flush();
        expect(cb.save).toHaveBeenCalledWith({ front: textOnly("Q1"), back: textOnly("A1") });
        expect(textAreas().map((ta) => ta.value)).toEqual(["", ""]);
        // The counter is a badge next to the title, not in the footer
        const counter = $(".sr-card-editor-counter");
        expect(counter.closest(".sr-card-editor-header")).not.toBeNull();
        expect(counter.previousElementSibling).toBe($(".sr-card-editor-title"));
        expect(counter.hasClass("sr-is-hidden")).toBe(false);
        expect(counter.textContent).toBe("1 added");
        expect(document.activeElement).toBe(textAreas()[0]);
        expect(cb.closed).not.toHaveBeenCalled();

        type(0, "Q2");
        type(1, "A2");
        saveNext().click();
        await flush();
        expect(cb.save).toHaveBeenCalledTimes(2);
        expect($(".sr-card-editor-counter").textContent).toBe("2 added");
    });

    test("Save & close saves and closes without a draft", async () => {
        const { cb } = openAdd();
        type(0, "Q");
        type(1, "A");
        saveClose().click();
        await flush();
        expect(cb.save).toHaveBeenCalledTimes(1);
        expect(cb.keepDraft).toHaveBeenCalledWith(null);
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("Save & close on an empty card does nothing", async () => {
        const { cb } = openAdd();
        saveClose().click();
        await flush();
        expect(cb.save).not.toHaveBeenCalled();
        expect(cb.closed).not.toHaveBeenCalled();
    });

    test("sides are saved with text and ink: strokes, pen size and the changed flag", async () => {
        const { cb } = openAdd({
            front: side({ text: "Q" }),
            back: side({ text: "typed", strokes: [stroke(0)], penSize: 7 }),
        });
        saveNext().click();
        await flush();
        // The pen size is the toolbar's (medium of the 2.5 setting); strokes keep their own
        expect(cb.save.mock.calls[0][0]).toEqual({
            front: textOnly("Q"),
            back: {
                text: "typed",
                ink: { strokes: [stroke(0)], penSize: 2.5, changed: false },
            },
        });
        // The next card starts empty, ink included
        expect(textAreas().map((ta) => ta.value)).toEqual(["", ""]);
        expect(inkFields().every((el) => el.hasClass("is-empty"))).toBe(true);
    });

    test("ink alone fills a side", async () => {
        const { cb } = openAdd({ front: side({ strokes: [stroke(0)] }), back: side() });
        expect(saveNext().disabled).toBe(true);
        type(1, "A");
        expect(saveNext().disabled).toBe(false);
        saveNext().click();
        await flush();
        expect(cb.save.mock.calls[0][0].front).toEqual({
            text: "",
            ink: { strokes: [stroke(0)], penSize: 2.5, changed: false },
        });
    });

    test("save errors keep the editor open and show a notice", async () => {
        const { cb } = openAdd();
        cb.save.mockRejectedValueOnce(new Error("disk full"));
        jest.spyOn(console, "error").mockImplementation(() => {});
        type(0, "Q");
        type(1, "A");
        saveClose().click();
        await flush();
        expect(Notice).toHaveBeenCalledWith("Could not save the card: Error: disk full");
        expect(cb.closed).not.toHaveBeenCalled();
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q", "A"]);
        expect(saveNext().disabled).toBe(false);
    });

    test("a second save while saving is ignored", async () => {
        const { cb } = openAdd();
        let finish: () => void = () => {};
        cb.save.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
        type(0, "Q");
        type(1, "A");
        saveNext().click();
        expect(saveNext().disabled).toBe(true);
        keyDown(textAreas()[0], "Enter", { ctrlKey: true });
        saveClose().click();
        finish();
        await flush();
        expect(cb.save).toHaveBeenCalledTimes(1);
    });

    test("Ctrl/Cmd+Enter is Save & next", async () => {
        const { cb } = openAdd();
        type(0, "Q");
        type(1, "A");
        const evt = keyDown(textAreas()[1], "Enter", { metaKey: true });
        expect(evt.defaultPrevented).toBe(true);
        await flush();
        expect(cb.save).toHaveBeenCalledTimes(1);
        expect(cb.closed).not.toHaveBeenCalled();
    });

    test("Ctrl+Enter with an empty side shows a notice instead of saving", async () => {
        const { cb } = openAdd();
        type(0, "Q");
        keyDown(textAreas()[0], "Enter", { ctrlKey: true });
        await flush();
        expect(cb.save).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith("Fill in both sides of the card first.");
    });
});

describe("CardEditorModal drafts and discard", () => {
    test("closing keeps the unsaved card as a draft, which restores", () => {
        const first = openAdd();
        type(0, "Q");
        first.modal.close();
        expect(first.cb.keepDraft).toHaveBeenCalledTimes(1);
        const draft = first.cb.keepDraft.mock.calls[0][0];
        expect(draft.front.text).toBe("Q");
        expect(draft.back.text).toBe("");
        expect(first.cb.closed).toHaveBeenCalledTimes(1);

        openAdd(draft);
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q", ""]);
    });

    test("a draft keeps text and strokes of every side", () => {
        const { modal, cb } = openAdd({
            front: side({ text: "Q", strokes: [stroke(0)] }),
            back: side({ strokes: [stroke(50)] }),
        });
        type(1, "A");
        modal.close();
        const draft = cb.keepDraft.mock.calls[0][0];
        expect(draft.front).toEqual({ text: "Q", strokes: [stroke(0)], penSize: 2.5 });
        expect(draft.back).toEqual({ text: "A", strokes: [stroke(50)], penSize: 2.5 });

        openAdd(draft);
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q", "A"]);
        expect(inkFields().map((el) => el.hasClass("is-empty"))).toEqual([false, false]);
    });

    test("a card with ink only is kept as a draft too", () => {
        const { modal, cb } = openAdd({ front: side({ strokes: [stroke(0)] }), back: side() });
        modal.close();
        expect(cb.keepDraft.mock.calls[0][0].front.strokes).toEqual([stroke(0)]);
    });

    test("an empty card leaves no draft", () => {
        const { modal, cb } = openAdd();
        modal.close();
        expect(cb.keepDraft).toHaveBeenCalledWith(null);
    });

    test("the close button closes", () => {
        const { cb } = openAdd();
        $<HTMLButtonElement>(".sr-card-editor-close").click();
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("Delete card arms on the first tap and discards on the second", () => {
        const { cb } = openAdd();
        type(0, "Q");
        const discard = $<HTMLButtonElement>(".sr-card-editor-discard");
        discard.click();
        expect(discard.textContent).toBe("Tap again to delete");
        expect(cb.closed).not.toHaveBeenCalled();
        discard.click();
        expect(cb.keepDraft).toHaveBeenCalledWith(null);
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("Delete card disarms after 3 seconds", () => {
        jest.useFakeTimers();
        const { cb } = openAdd();
        type(0, "Q");
        const discard = $<HTMLButtonElement>(".sr-card-editor-discard");
        discard.click();
        jest.advanceTimersByTime(3000);
        expect(discard.textContent).toBe("Delete card");
        discard.click();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(discard.textContent).toBe("Tap again to delete");
    });

    test("Save & next disarms Delete card for the next card", async () => {
        jest.useFakeTimers();
        const { cb } = openAdd();
        type(0, "Q");
        type(1, "A");
        const discard = $<HTMLButtonElement>(".sr-card-editor-discard");
        discard.click();
        expect(discard.textContent).toBe("Tap again to delete");
        saveNext().click();
        await jest.advanceTimersByTimeAsync(0);
        expect(cb.save).toHaveBeenCalledTimes(1);
        expect(discard.textContent).toBe("Delete card");
        expect(discard.hasClass("is-armed")).toBe(false);

        // Within the first tap's 3 s: the first tap on the new card only arms
        type(0, "Q2");
        discard.click();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(discard.textContent).toBe("Tap again to delete");
    });

    test("Delete card closes an empty new card at once", () => {
        const { cb } = openAdd();
        $<HTMLButtonElement>(".sr-card-editor-discard").click();
        expect(cb.closed).toHaveBeenCalledTimes(1);
        expect(cb.keepDraft).toHaveBeenCalledWith(null);
    });

    test("closing while saving keeps the draft only if saving fails", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        for (const fails of [false, true]) {
            const { modal, cb } = openAdd();
            let settle: (ok: boolean) => void = () => {};
            cb.save.mockImplementationOnce(
                () =>
                    new Promise<void>((resolve, reject) => {
                        settle = (ok) => (ok ? resolve() : reject(new Error("x")));
                    }),
            );
            type(0, "Q");
            type(1, "A");
            saveNext().click();
            modal.close();
            expect(cb.closed).not.toHaveBeenCalled();
            settle(!fails);
            await flush();
            expect(cb.closed).toHaveBeenCalledTimes(1);
            const draft = cb.keepDraft.mock.calls[0][0];
            if (fails) expect(draft.front.text).toBe("Q");
            else expect(draft).toBeNull();
        }
    });
});

describe("CardEditorModal edit mode", () => {
    test("✕ closes without saving", () => {
        const { cb } = openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        $<HTMLButtonElement>(".sr-card-editor-close").click();
        expect(cb.save).not.toHaveBeenCalled();
        expect(cb.delete).not.toHaveBeenCalled();
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("Delete card deletes on the second tap and closes", async () => {
        const { cb } = openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        const del = button("Delete card");
        del.click();
        expect(del.textContent).toBe("Tap again to delete");
        expect(cb.delete).not.toHaveBeenCalled();
        del.click();
        await flush();
        expect(cb.delete).toHaveBeenCalledTimes(1);
        expect(cb.save).not.toHaveBeenCalled();
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("a failed delete keeps the editor open", async () => {
        const { cb } = openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        cb.delete.mockRejectedValueOnce(new Error("gone"));
        jest.spyOn(console, "error").mockImplementation(() => {});
        const del = button("Delete card");
        del.click();
        del.click();
        await flush();
        expect(cb.delete).toHaveBeenCalledTimes(1);
        expect(cb.closed).not.toHaveBeenCalled();
        expect(del.textContent).toBe("Delete card");
        expect(del.disabled).toBe(false);
    });

    test("Save passes both sides and closes", async () => {
        const strokes = [stroke(0)];
        const { cb } = openEdit({
            front: side({ text: "Q" }),
            back: side({ strokes, penSize: 3 }),
        });
        type(0, "Q2");
        type(1, "A");
        button("Save").click();
        await flush();
        expect(cb.save).toHaveBeenCalledWith({
            front: textOnly("Q2"),
            back: { text: "A", ink: { strokes, penSize: 2.5, changed: false } },
        });
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("Save is disabled while a side is empty", () => {
        openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        type(1, "");
        expect(button("Save").disabled).toBe(true);
    });

    test("cloze saves a single text side", async () => {
        const { cb } = openEdit({ front: side({ text: "a ==b==" }), back: null }, CardType.Cloze);
        keyDown(textAreas()[0], "Enter", { ctrlKey: true });
        await flush();
        expect(cb.save).toHaveBeenCalledWith({ front: textOnly("a ==b=="), back: null });
    });

    test("save errors keep the editor open", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        const { cb } = openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        cb.save.mockRejectedValueOnce("nope");
        button("Save").click();
        await flush();
        expect(Notice).toHaveBeenCalledWith("Could not save the card: nope");
        expect(cb.closed).not.toHaveBeenCalled();
    });
});

describe("CardEditorModal pen tools", () => {
    test("pen size and eraser are always enabled; undo and clear once there is something", () => {
        openAdd();
        expect(penSize().disabled).toBe(false);
        expect(eraser().disabled).toBe(false);
        expect(undo().disabled).toBe(true); // nothing to undo yet
        expect(clearSide().disabled).toBe(true); // nothing to clear yet

        const header = $(".sr-card-editor-header");
        const toolsBefore = Array.from(header.children);
        type(0, "Q");
        // The tools keep their place, only their state changes
        expect(Array.from(header.children)).toEqual(toolsBefore);
        expect(clearSide().disabled).toBe(false);
        // Typing is undone by the text area
        expect(undo().disabled).toBe(true);
    });

    test("pen size cycles medium, thick, thin around the setting", async () => {
        const { modal, cb } = openAdd(
            { front: side({ text: "Q" }), back: side({ strokes: [stroke(0)] }) },
            { cardEditorPenSize: 2.5 },
        );
        expect(penSize().hasClass("is-medium")).toBe(true);
        expect(penSize().getAttribute("aria-label")).toContain("Pen thickness");
        expect(penSize().querySelector(".sr-card-editor-pen-dot")).not.toBeNull();
        penSize().click();
        expect(penSize().hasClass("is-thick")).toBe(true);
        expect(penSize().hasClass("is-medium")).toBe(false);

        saveNext().click();
        await flush();
        // The side is saved with the thickness it is shown with
        expect(cb.save.mock.calls[0][0].back.ink).toMatchObject({ penSize: 4 });

        // The next card keeps the chosen thickness; it lasts for this editor only
        penSize().click();
        expect(penSize().hasClass("is-thin")).toBe(true);
        type(0, "Q2");
        modal.close();
        expect(cb.keepDraft.mock.calls[0][0].back.penSize).toBe(1.5);
        document.body.replaceChildren();
        openAdd(null, { cardEditorPenSize: 2.5 });
        expect(penSize().hasClass("is-medium")).toBe(true);
    });

    test("an edited card and a restored draft write with the size the button shows", () => {
        const setPenSize = jest.spyOn(SideEditor.prototype, "setPenSize");
        try {
            // An old card saved with the thick pen of earlier builds (5)
            openEdit({
                front: side({ text: "Q" }),
                back: side({ strokes: [stroke(0, 5)], penSize: 5 }),
            });
            expect(penSize().hasClass("is-medium")).toBe(true);
            expect(setPenSize).toHaveBeenCalledWith(2.5);
            expect(setPenSize.mock.calls.every(([size]) => size === 2.5)).toBe(true);
            document.body.replaceChildren();
            setPenSize.mockClear();

            // A draft closed while the thin pen was picked
            openAdd({
                front: side({ text: "Q" }),
                back: side({ strokes: [stroke(0, 1.5)], penSize: 1.5 }),
            });
            expect(penSize().hasClass("is-medium")).toBe(true);
            expect(setPenSize.mock.calls.every(([size]) => size === 2.5)).toBe(true);
            // Pressing the button once goes to thick, not skipping a step
            penSize().click();
            expect(setPenSize).toHaveBeenLastCalledWith(4);
        } finally {
            setPenSize.mockRestore();
        }
    });

    test("eraser toggles and stays on while typing", () => {
        openAdd();
        eraser().click();
        expect(eraser().hasClass("is-active")).toBe(true);
        expect(eraser().getAttribute("aria-pressed")).toBe("true");
        eraser().click();
        expect(eraser().hasClass("is-active")).toBe(false);
        eraser().click();
        type(0, "Q");
        expect(eraser().hasClass("is-active")).toBe(true);
    });

    test("clear side and undo work across both sides", async () => {
        const front = [stroke(0)];
        const back = [stroke(50)];
        const { cb } = openEdit({
            front: side({ strokes: front }),
            back: side({ strokes: back }),
        });
        // Clear acts on the side last touched
        $$(".sr-card-editor-side")[1].dispatchEvent(new Event("pointerdown"));
        clearSide().click();
        expect(button("Save").disabled).toBe(true);
        expect(clearSide().disabled).toBe(true); // the back is empty now
        $$(".sr-card-editor-side")[0].dispatchEvent(new Event("pointerdown"));
        expect(clearSide().disabled).toBe(false); // the front still has ink
        clearSide().click();
        expect(clearSide().disabled).toBe(true);
        expect(undo().disabled).toBe(false);

        undo().click(); // front back
        expect(button("Save").disabled).toBe(true);
        keyDown($(".sr-ink-field"), "z", { ctrlKey: true }); // back back
        expect(undo().disabled).toBe(true);
        expect(button("Save").disabled).toBe(false);

        button("Save").click();
        await flush();
        const result = cb.save.mock.calls[0][0];
        const ink = (strokes: Stroke[]) => ({ strokes, penSize: 2.5, changed: false });
        expect(result.front).toEqual({ text: "", ink: ink(front) });
        expect(result.back).toEqual({ text: "", ink: ink(back) });
    });

    test("clear side clears text and ink; one undo restores both", async () => {
        const strokes = [stroke(0)];
        const { cb } = openEdit({
            front: side({ text: "Q", strokes }),
            back: side({ text: "A" }),
        });
        clearSide().click();
        expect(textAreas()[0].value).toBe("");
        expect(inkFields()[0].hasClass("is-empty")).toBe(true);
        expect(textAreas()[1].value).toBe("A");
        expect(button("Save").disabled).toBe(true);
        expect(clearSide().disabled).toBe(true);

        undo().click();
        expect(textAreas()[0].value).toBe("Q");
        expect(inkFields()[0].hasClass("is-empty")).toBe(false);
        expect(undo().disabled).toBe(true);
        expect(button("Save").disabled).toBe(false);

        button("Save").click();
        await flush();
        expect(cb.save.mock.calls[0][0].front).toEqual({
            text: "Q",
            ink: { strokes, penSize: 2.5, changed: false },
        });
    });

    test("clear side on a text-only side, and on an empty active side", () => {
        openAdd({ front: side(), back: side({ text: "A" }) });
        // The front is active and empty: nothing to clear there
        expect(clearSide().disabled).toBe(true);
        textAreas()[1].dispatchEvent(new Event("focusin", { bubbles: true }));
        expect(clearSide().disabled).toBe(false);
        clearSide().click();
        expect(textAreas()[1].value).toBe("");
        undo().click();
        expect(textAreas()[1].value).toBe("A");
    });

    test("undo makes the side it changes the active one", () => {
        openAdd({ front: side({ strokes: [stroke(0)] }), back: side({ text: "A" }) });
        clearSide().click();
        textAreas()[1].dispatchEvent(new Event("focusin", { bubbles: true }));
        undo().click();
        expect(inkFields()[0].hasClass("is-empty")).toBe(false);
        // Clear now acts on the front again
        clearSide().click();
        expect(inkFields()[0].hasClass("is-empty")).toBe(true);
        expect(textAreas()[1].value).toBe("A");
    });

    test("undoing Clear side keeps text typed since", () => {
        openAdd({ front: side({ text: "A", strokes: [stroke(0)] }), back: side() });
        clearSide().click();
        type(0, "B");
        undo().click();
        expect(textAreas()[0].value).toBe("B");
        expect(inkFields()[0].hasClass("is-empty")).toBe(false);
    });

    test("writing in an ink field takes the focus off the text area, so Ctrl+Z undoes the ink", () => {
        const raf = jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
        const g = globalThis as unknown as { Path2D: unknown };
        const path2d = g.Path2D;
        g.Path2D = jest.fn();
        try {
            openAdd();
            textAreas()[1].focus();
            type(1, "A");
            const backInk = inkFields()[1];
            const canvas = backInk.querySelector("canvas");
            for (const [type, x] of [
                ["pointerdown", 10],
                ["pointermove", 40],
                ["pointerup", 40],
            ] as const) {
                const evt = new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: 10,
                    buttons: 1,
                });
                Object.assign(evt, { pointerType: "pen", pointerId: 1, pressure: 0.5 });
                canvas.dispatchEvent(evt);
            }
            expect(backInk.hasClass("is-empty")).toBe(false);
            expect(document.activeElement).toBe(backInk);

            keyDown(document.activeElement as HTMLElement, "z", { ctrlKey: true });
            expect(backInk.hasClass("is-empty")).toBe(true);
            expect(textAreas()[1].value).toBe("A");
        } finally {
            raf.mockRestore();
            g.Path2D = path2d;
        }
    });

    test("Ctrl+Z in a text area is left to the text area", () => {
        openAdd({ front: side({ strokes: [stroke(0)] }), back: side() });
        clearSide().click();
        const evt = keyDown(textAreas()[1], "z", { ctrlKey: true });
        expect(evt.defaultPrevented).toBe(false);
        expect(undo().disabled).toBe(false);
    });
});

test("a theme change redraws the ink with the new color, until the editor closes", () => {
    const themeChanged = jest.spyOn(InkField.prototype, "themeChanged");
    const { modal } = openAdd({ front: side({ strokes: [stroke(0)] }), back: side() });
    workspaceEvents.get("css-change")();
    // Every side has an ink field
    expect(themeChanged).toHaveBeenCalledTimes(2);
    modal.close();
    expect(workspaceEvents.has("css-change")).toBe(false);
    themeChanged.mockRestore();
});

// jsdom has no PointerEvent, a MouseEvent with the pointer fields added does the job
function pointer(type: string, target: HTMLElement, pointerType: string, buttons = 1) {
    const evt = new MouseEvent(type, { bubbles: true, cancelable: true, buttons });
    Object.assign(evt, { pointerType, pointerId: 1, pressure: 0.5 });
    target.dispatchEvent(evt);
    return evt;
}

describe("CardEditorModal pen only", () => {
    /** A finger tap on a button: pointerdown, then the click the browser adds */
    function fingerTap(el: HTMLElement) {
        pointer("pointerdown", el, "touch");
        el.click();
    }

    test("the palm touching a button while the pen writes doesn't press it", () => {
        jest.useFakeTimers({ now: 10_000 });
        const { cb } = openAdd(null, { cardEditorPenOnly: true });
        type(0, "Q");
        type(1, "A");
        const ink = $$(".sr-card-editor-side")[1];
        pointer("pointerdown", ink, "pen");

        fingerTap(saveNext());
        fingerTap(button("Delete card"));
        fingerTap(button("Delete card"));
        fingerTap(undo());
        expect(cb.save).not.toHaveBeenCalled();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(button("Delete card")).toBeDefined();

        // Just after the pen was lifted, still the palm
        pointer("pointerup", ink, "pen");
        jest.advanceTimersByTime(300);
        fingerTap(saveNext());
        expect(cb.save).not.toHaveBeenCalled();

        // A finger tap a moment later, the pen, and a key press work
        jest.advanceTimersByTime(300);
        fingerTap(saveNext());
        expect(cb.save).toHaveBeenCalledTimes(1);
    });

    test("the palm doesn't focus a text area", () => {
        openAdd(
            { front: side({ strokes: [stroke(0)] }), back: side() },
            { cardEditorPenOnly: true },
        );
        const [frontSide] = $$(".sr-card-editor-side");
        pointer("pointerdown", frontSide.querySelector(".sr-ink-field"), "pen");
        const touch = pointer("pointerdown", textAreas()[1], "touch");
        expect(touch.defaultPrevented).toBe(true);
    });

    test("the palm resting on the other side doesn't change the side Clear acts on", () => {
        jest.useFakeTimers({ now: 10_000 });
        openAdd(
            {
                front: side({ strokes: [stroke(0)] }),
                back: side({ strokes: [stroke(50)] }),
            },
            { cardEditorPenOnly: true },
        );
        const backSide = sideEls()[1];
        const [frontInk, backInk] = inkFields();
        pointer("pointerdown", frontInk, "pen");
        pointer("pointerup", frontInk, "pen");
        pointer("pointerdown", backSide, "touch");
        // A finger on the ink field is the hand resting there, even long after the pen
        jest.advanceTimersByTime(1000);
        pointer("pointerdown", backInk, "touch");
        clearSide().click();
        expect(frontInk.hasClass("is-empty")).toBe(true);
        expect(backInk.hasClass("is-empty")).toBe(false);

        // A finger on the back's text area chooses the back
        pointer("pointerdown", backSide.querySelector("textarea"), "touch");
        clearSide().click();
        expect(backInk.hasClass("is-empty")).toBe(true);
    });

    test("a pen hovering over the screen doesn't block finger taps", () => {
        jest.useFakeTimers({ now: 10_000 });
        const { cb } = openAdd(null, { cardEditorPenOnly: true });
        type(0, "Q");
        type(1, "A");
        pointer("pointermove", $$(".sr-card-editor-side")[1], "pen", 0);
        fingerTap(saveNext());
        expect(cb.save).toHaveBeenCalledTimes(1);
    });

    test("with pen only, a tap on the background doesn't close the editor", () => {
        const background = () => document.body.querySelector<HTMLElement>(".modal-bg");
        const tapBackground = () => {
            pointer("pointerdown", background(), "touch");
            background().click();
        };
        // Like Obsidian: a click on the background closes the modal
        const closeOnBackground = (modal: CardEditorModal) =>
            background().addEventListener("click", () => modal.close());

        const penOnly = openAdd(null, { cardEditorPenOnly: true });
        closeOnBackground(penOnly.modal);
        tapBackground();
        expect(penOnly.cb.closed).not.toHaveBeenCalled();
        penOnly.modal.close();

        const normal = openAdd(null, { cardEditorPenOnly: false });
        closeOnBackground(normal.modal);
        tapBackground();
        expect(normal.cb.closed).toHaveBeenCalled();
    });

    test("without pen only, a finger tap during a stroke counts", () => {
        const { cb } = openAdd(null, { cardEditorPenOnly: false });
        type(0, "Q");
        type(1, "A");
        pointer("pointerdown", $$(".sr-card-editor-side")[1], "pen");
        fingerTap(saveNext());
        expect(cb.save).toHaveBeenCalledTimes(1);
    });
});

test("on mobile no text area is focused, so the soft keyboard stays closed", async () => {
    const isMobile = jest.spyOn(Platform, "isMobile", "get").mockReturnValue(true);
    try {
        const { cb } = openAdd();
        const focused = () => textAreas().includes(document.activeElement as HTMLTextAreaElement);
        expect(focused()).toBe(false);
        // Save & next neither: the text area typed in last loses the focus, closing the keyboard
        type(0, "Q");
        textAreas()[1].focus();
        type(1, "A");
        saveNext().click();
        await flush();
        expect(cb.save).toHaveBeenCalledTimes(1);
        expect(focused()).toBe(false);
        document.body.replaceChildren();
        openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        expect(focused()).toBe(false);
    } finally {
        isMobile.mockRestore();
    }
});

test("on desktop the front text area is focused, also when editing", () => {
    openEdit({ front: side({ strokes: [stroke(0)] }), back: side({ text: "A" }) });
    expect(document.activeElement).toBe(textAreas()[0]);
});

test("on mobile the editor keeps its height while the soft keyboard opens and closes", () => {
    const isMobile = jest.spyOn(Platform, "isMobile", "get").mockReturnValue(true);
    const resize = (width: number, height: number) => {
        Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
        window.dispatchEvent(new Event("resize"));
    };
    try {
        resize(400, 800);
        const { modal } = openAdd();
        const height = () => modal.modalEl.style.getPropertyValue("--sr-card-editor-height");
        expect(modal.containerEl.hasClass("sr-card-editor-container")).toBe(true);
        expect(height()).toBe("800px");
        resize(400, 500); // keyboard opens
        expect(height()).toBe("800px");
        resize(400, 800); // and closes
        expect(height()).toBe("800px");
        resize(800, 400); // rotated
        expect(height()).toBe("400px");
        resize(800, 450); // higher, e.g. a bar went away
        expect(height()).toBe("450px");
        modal.close();
        resize(400, 800);
        expect(height()).toBe("450px");
    } finally {
        resize(1024, 768);
        isMobile.mockRestore();
    }
});

test("on desktop the editor's height is left to CSS", () => {
    openAdd();
    expect($(".sr-card-editor-modal").style.getPropertyValue("--sr-card-editor-height")).toBe("");
});

describe("CardEditorModal while saving", () => {
    /** Makes the next save wait until the returned function is called */
    function deferSave(cb: Callbacks): (ok?: boolean) => void {
        let settle: (ok: boolean) => void = () => {};
        cb.save.mockImplementationOnce(
            () =>
                new Promise<void>((resolve, reject) => {
                    settle = (ok) => (ok ? resolve() : reject(new Error("x")));
                }),
        );
        return (ok = true) => settle(ok);
    }

    test("Save & next: the sides can't be changed until the card is saved", async () => {
        const { cb } = openAdd({
            front: side({ text: "Q" }),
            back: side({ strokes: [stroke(0)] }),
        });
        const backInk = inkFields()[1];
        const finish = deferSave(cb);
        saveNext().click();

        expect(textAreas()[0].readOnly).toBe(true);
        const draw = pointer("pointerdown", backInk.querySelector("canvas") ?? backInk, "pen");
        expect(draw.defaultPrevented).toBe(true);
        expect(keyDown(textAreas()[0], "Tab").defaultPrevented).toBe(false);
        expect(textAreas()[0].value).toBe("Q");
        expect(clearSide().disabled).toBe(true);
        expect(undo().disabled).toBe(true);
        clearSide().click();
        keyDown($(".sr-card-editor-sides"), "z", { ctrlKey: true });
        expect(backInk.hasClass("is-empty")).toBe(false);
        expect(textAreas()[0].value).toBe("Q");

        finish();
        await flush();
        expect(cb.save).toHaveBeenCalledTimes(1);
        expect(textAreas()[0].readOnly).toBe(false);
        expect(textAreas()[0].value).toBe("");
        type(0, "Q2");
        expect(textAreas()[0].value).toBe("Q2");
    });

    test("Save & close: a failed save unlocks the sides", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        const { cb } = openAdd();
        type(0, "Q");
        type(1, "A");
        const finish = deferSave(cb);
        saveClose().click();
        expect(textAreas().every((ta) => ta.readOnly)).toBe(true);
        const touch = pointer("pointerdown", textAreas()[1], "mouse");
        expect(touch.defaultPrevented).toBe(true);

        finish(false);
        await flush();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(textAreas().some((ta) => ta.readOnly)).toBe(false);
        expect(pointer("pointerdown", textAreas()[1], "mouse").defaultPrevented).toBe(false);
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q", "A"]);
    });

    test("Save & close: the sides stay locked until the editor closes", async () => {
        const { cb } = openAdd();
        type(0, "Q");
        type(1, "A");
        const finish = deferSave(cb);
        saveClose().click();
        expect(textAreas().every((ta) => ta.readOnly)).toBe(true);
        finish();
        await flush();
        expect(cb.keepDraft).toHaveBeenCalledWith(null);
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("edit: Save locks the sides", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        const { cb } = openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        const finish = deferSave(cb);
        button("Save").click();
        expect(textAreas().every((ta) => ta.readOnly)).toBe(true);
        finish(false);
        await flush();
        expect(textAreas().some((ta) => ta.readOnly)).toBe(false);
    });
});
