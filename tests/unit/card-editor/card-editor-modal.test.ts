import { App, MarkdownRenderer, Menu, Notice, Platform } from "obsidian";

import {
    CardEditorModal,
    CardEditorOptions,
    CardEditorResult,
    CardEditorSides,
    SideResult,
} from "src/card-editor/card-editor-modal";
import { Stroke } from "src/card-editor/core/strokes";
import { SideState } from "src/card-editor/side-editor";
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

/** An app with just the workspace events the editor subscribes to */
function testApp(): App {
    return {
        workspace: {
            on: (name: string) => ({ name }),
            offref: () => {},
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

/** The tests write by hand unless they turn handwriting off */
const SETTINGS: SRSettings = { ...DEFAULT_SETTINGS, cardEditorPenMode: true };

function openAdd(
    draft: CardEditorSides | null = null,
    settings: Partial<SRSettings> = {},
): { modal: CardEditorModal; cb: Callbacks } {
    const cb = callbacks();
    const opts: CardEditorOptions = { kind: "add", title: "Biology", draft, ...cb };
    const modal = new CardEditorModal(testApp(), { ...SETTINGS, ...settings }, opts);
    modal.open();
    return { modal, cb };
}

function openEdit(
    initial: CardEditorSides,
    cardType = CardType.MultiLineBasic,
    settings: Partial<SRSettings> = {},
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
    const modal = new CardEditorModal(testApp(), { ...SETTINGS, ...settings }, opts);
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
const sizeButton = () => $<HTMLButtonElement>("button.sr-card-editor-size");
const sizeDot = () => $(".sr-card-editor-size-dot");
const eraser = () => $<HTMLButtonElement>("button.sr-card-editor-eraser");
const undo = () => iconButton("Undo");
const clearSide = () => iconButton("Clear side");
const deleteCard = () => $<HTMLButtonElement>("button.sr-card-editor-delete");
const switchSide = () => $<HTMLButtonElement>("button.sr-card-editor-switch");
const saveNext = () => button("Save & next");
const saveClose = () => button("Save & close");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sideEls = () => $$(".sr-card-editor-side");
const inkFields = () => $$(".sr-ink-field");
/** Index of the side shown: 0 front, 1 back */
const shown = () => sideEls().findIndex((el) => !el.hasClass("sr-is-hidden"));
const sideLabel = () => $(".sr-card-editor-side-label").textContent;
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

// jsdom has no PointerEvent, a MouseEvent with the pointer fields added does the job
function pointer(
    type: string,
    target: HTMLElement,
    pointerType: string,
    buttons = 1,
    o: { pressure?: number; clientX?: number } = {},
) {
    const evt = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        buttons,
        clientX: o.clientX ?? 0,
        clientY: 10,
    });
    Object.assign(evt, { pointerType, pointerId: 1, pressure: o.pressure ?? 0.5 });
    target.dispatchEvent(evt);
    return evt;
}

/** Runs fn with the drawing the ink field needs, which jsdom lacks */
function withCanvas(fn: () => void) {
    const raf = jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const g = globalThis as unknown as { Path2D: unknown };
    const path2d = g.Path2D;
    g.Path2D = jest.fn();
    try {
        fn();
    } finally {
        raf.mockRestore();
        g.Path2D = path2d;
    }
}

describe("CardEditorModal layout", () => {
    test("one side is shown at a time; the switch toggles it and moves the focus", () => {
        openAdd();
        expect(shown()).toBe(0);
        expect(sideLabel()).toBe("Front");
        expect(document.activeElement).toBe(textAreas()[0]);
        expect($(".sr-card-editor-switch-side.is-active").textContent).toBe("Front");
        type(0, "Q");

        switchSide().click();
        expect(shown()).toBe(1);
        expect(sideLabel()).toBe("Back");
        expect(document.activeElement).toBe(textAreas()[1]);
        expect($(".sr-card-editor-switch-side.is-active").textContent).toBe("Back");
        expect($(".sr-card-editor-main").hasClass("is-back")).toBe(true);

        // Text is kept per side
        switchSide().click();
        expect(shown()).toBe(0);
        expect(textAreas()[0].value).toBe("Q");
    });

    test("the hints show while a zone is empty", () => {
        openAdd();
        const wrap = $$(".sr-card-editor-text-wrap")[0];
        expect(wrap.querySelector(".sr-card-editor-text-hint").innerHTML).toBe(
            "Type the <b>question</b>",
        );
        expect(inkFields()[1].querySelector(".sr-ink-placeholder").innerHTML).toBe(
            "Draw on <b>back</b>",
        );
        expect(wrap.hasClass("is-empty")).toBe(true);
        type(0, "Q");
        expect(wrap.hasClass("is-empty")).toBe(false);
    });

    test("buttons and the pen zone don't take the focus from the text area", () => {
        openAdd();
        for (const el of [sizeButton(), eraser(), switchSide(), saveNext(), deleteCard()]) {
            expect(pointer("pointerdown", el, "touch").defaultPrevented).toBe(true);
        }
        const canvas = inkFields()[0].querySelector("canvas");
        expect(pointer("pointerdown", canvas, "touch").defaultPrevented).toBe(true);
        // The pen zone's border, around the canvas
        const zone = $(".sr-card-editor-ink");
        expect(pointer("pointerdown", zone, "pen").defaultPrevented).toBe(true);
    });
});

describe("CardEditorModal add mode", () => {
    test("save on an empty side shows that side, outlines it and saves nothing", async () => {
        const { cb } = openAdd();
        expect(saveNext().disabled).toBe(false);
        type(0, "Q");
        type(1, "   ");
        saveNext().click();
        await flush();
        expect(cb.save).not.toHaveBeenCalled();
        expect(shown()).toBe(1);
        expect(document.activeElement).toBe(textAreas()[1]);
        expect(sideEls()[1].hasClass("is-flashing")).toBe(true);
        expect(Notice).toHaveBeenCalledWith("Back is empty", 2000);

        type(0, "");
        saveClose().click();
        await flush();
        expect(shown()).toBe(0);
        expect(Notice).toHaveBeenLastCalledWith("Front is empty", 2000);
        expect(cb.closed).not.toHaveBeenCalled();
    });

    test("Save & next saves, clears the sides, counts and shows and focuses the front", async () => {
        const { cb } = openAdd();
        type(0, "Q1");
        type(1, "A1");
        switchSide().click();
        saveNext().click();
        await flush();
        expect(cb.save).toHaveBeenCalledWith({
            cardType: CardType.MultiLineBasic,
            front: textOnly("Q1"),
            back: textOnly("A1"),
        });
        expect(textAreas().map((ta) => ta.value)).toEqual(["", ""]);
        expect($(".sr-card-editor-counter").textContent).toBe("1 added");
        expect(shown()).toBe(0);
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

    test("sides are saved with text and ink; ink alone fills a side", async () => {
        const { cb } = openAdd({
            front: side({ strokes: [stroke(50)] }),
            back: side({ strokes: [stroke(0)], penSize: 7 }),
        });
        type(1, "typed");
        saveNext().click();
        await flush();
        // The pen size is the size button's (thin, 0.6 of the 2.5 setting); strokes keep their own
        expect(cb.save.mock.calls[0][0]).toEqual({
            cardType: CardType.MultiLineBasic,
            front: { text: "", ink: { strokes: [stroke(50)], penSize: 1.5, changed: false } },
            back: {
                text: "typed",
                ink: { strokes: [stroke(0)], penSize: 1.5, changed: false },
            },
        });
        // The next card starts empty, ink included
        expect(textAreas().map((ta) => ta.value)).toEqual(["", ""]);
        expect(inkFields().every((el) => el.hasClass("is-empty"))).toBe(true);
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
});

describe("CardEditorModal with pen mode off", () => {
    test("sides are text only, without pen tools; the layout has no pen zone", () => {
        openAdd(null, { cardEditorPenMode: false });
        expect(inkFields()).toHaveLength(0);
        expect($(".sr-card-editor-modal").hasClass("sr-card-editor-no-ink")).toBe(true);
        expect(sizeButton().hasClass("sr-is-hidden")).toBe(true);
        expect(eraser().hasClass("sr-is-hidden")).toBe(true);
        expect(switchSide()).not.toBeNull();
    });

    test("a side that has handwriting keeps its pen zone", () => {
        openEdit(
            { front: side({ text: "Q" }), back: side({ strokes: [stroke(0)] }) },
            CardType.MultiLineBasic,
            { cardEditorPenMode: false },
        );
        expect(inkFields()).toHaveLength(1);
        expect($(".sr-card-editor-modal").hasClass("sr-card-editor-no-ink")).toBe(false);
        expect(sideEls()[0].hasClass("is-text-only")).toBe(true);
        expect(sizeButton().hasClass("sr-is-hidden")).toBe(true);
        switchSide().click();
        expect(sizeButton().hasClass("sr-is-hidden")).toBe(false);
    });
});

describe("CardEditorModal drafts and delete", () => {
    test("closing keeps the unsaved card with its text and ink as a draft, which restores", () => {
        const first = openAdd({ front: side({ text: "Q", strokes: [stroke(0)] }), back: side() });
        first.modal.close();
        expect(first.cb.keepDraft).toHaveBeenCalledTimes(1);
        const draft = first.cb.keepDraft.mock.calls[0][0];
        expect(draft.front).toEqual({ text: "Q", strokes: [stroke(0)], penSize: 1.5 });
        expect(draft.back.text).toBe("");
        expect(first.cb.closed).toHaveBeenCalledTimes(1);

        openAdd(draft);
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q", ""]);
        expect(inkFields()[0].hasClass("is-empty")).toBe(false);
    });

    test("an empty card leaves no draft", () => {
        const { modal, cb } = openAdd();
        modal.close();
        expect(cb.keepDraft).toHaveBeenCalledWith(null);
    });

    test("Delete card in the title bar closes an empty card at once", () => {
        const { cb } = openAdd();
        expect(deleteCard().closest(".sr-card-editor-header")).not.toBeNull();
        deleteCard().click();
        expect(cb.closed).toHaveBeenCalledTimes(1);
        expect(cb.keepDraft).toHaveBeenCalledWith(null);
    });

    test("Delete card arms on the first tap and deletes on the second", () => {
        jest.useFakeTimers({ now: 10_000 });
        const { cb } = openAdd();
        type(0, "Q");
        deleteCard().click();
        expect(deleteCard().textContent).toBe("Tap again to delete");
        expect(deleteCard().hasClass("is-armed")).toBe(true);
        // Disarmed after 3 s
        jest.advanceTimersByTime(3000);
        expect(deleteCard().hasClass("is-armed")).toBe(false);
        deleteCard().click();
        expect(cb.closed).not.toHaveBeenCalled();
        deleteCard().click();
        expect(cb.keepDraft).toHaveBeenCalledWith(null);
        expect(cb.closed).toHaveBeenCalledTimes(1);
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
    test("Delete card deletes on the second tap and closes", async () => {
        const { cb } = openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        deleteCard().click();
        expect(deleteCard().textContent).toBe("Tap again to delete");
        expect(cb.delete).not.toHaveBeenCalled();
        deleteCard().click();
        await flush();
        expect(cb.delete).toHaveBeenCalledTimes(1);
        expect(cb.save).not.toHaveBeenCalled();
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("a failed delete keeps the editor open", async () => {
        const { cb } = openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        cb.delete.mockRejectedValueOnce(new Error("gone"));
        jest.spyOn(console, "error").mockImplementation(() => {});
        deleteCard().click();
        deleteCard().click();
        await flush();
        expect(cb.delete).toHaveBeenCalledTimes(1);
        expect(cb.closed).not.toHaveBeenCalled();
        expect(deleteCard().disabled).toBe(false);
    });

    test("the sides load from the card; a single Save passes both sides and closes", async () => {
        const strokes = [stroke(0)];
        const { cb } = openEdit({
            front: side({ text: "Q" }),
            back: side({ strokes, penSize: 3 }),
        });
        expect($$(".sr-card-editor-saves button")).toHaveLength(1);
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q", ""]);
        expect(inkFields()[1].hasClass("is-empty")).toBe(false);
        type(0, "Q2");
        type(1, "A");
        button("Save").click();
        await flush();
        expect(cb.save).toHaveBeenCalledWith({
            cardType: CardType.MultiLineBasic,
            front: textOnly("Q2"),
            back: { text: "A", ink: { strokes, penSize: 1.5, changed: false } },
        });
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("cloze has a single text side without ink or switch and saves it", async () => {
        const { cb } = openEdit({ front: side({ text: "a ==b==" }), back: null }, CardType.Cloze);
        expect(sideEls()).toHaveLength(1);
        expect(inkFields()).toHaveLength(0);
        expect(switchSide()).toBeNull();
        expect(sideLabel()).toBe("Cloze");
        expect($(".sr-card-editor-main").hasClass("sr-card-editor-one-side")).toBe(true);
        keyDown(textAreas()[0], "Enter", { ctrlKey: true });
        await flush();
        expect(cb.save).toHaveBeenCalledWith({
            cardType: CardType.Cloze,
            front: textOnly("a ==b=="),
            back: null,
        });
    });
});

describe("CardEditorModal pen tools", () => {
    test("the size button cycles the pen thin, medium, thick around the setting", async () => {
        const { modal, cb } = openAdd(
            { front: side({ text: "Q" }), back: side({ strokes: [stroke(0)] }) },
            { cardEditorPenSize: 2.5 },
        );
        expect(sizeButton().getAttribute("aria-label")).toBe("Pen thickness: Thin");
        sizeButton().click();
        sizeButton().click();
        expect(sizeButton().getAttribute("aria-label")).toBe("Pen thickness: Thick");

        saveNext().click();
        await flush();
        // The side is saved with the thickness it is shown with
        expect(cb.save.mock.calls[0][0].back.ink).toMatchObject({ penSize: 4 });

        // The next card keeps the chosen thickness; it lasts for this editor only
        sizeButton().click();
        expect(sizeButton().getAttribute("aria-label")).toBe("Pen thickness: Thin");
        type(0, "Q2");
        modal.close();
        expect(cb.keepDraft.mock.calls[0][0].back.penSize).toBe(1.5);
        document.body.replaceChildren();
        openAdd(null, { cardEditorPenSize: 2.5 });
        expect(sizeButton().getAttribute("aria-label")).toBe("Pen thickness: Thin");
    });

    test("with the eraser on, the size button sets its radius and shows it as a ring", () => {
        openAdd();
        const dotSize = () => sizeButton().style.getPropertyValue("--sr-card-editor-dot-size");
        expect(sizeButton().hasClass("is-eraser")).toBe(false);
        eraser().click();
        expect(eraser().hasClass("is-active")).toBe(true);
        expect($(".sr-card-editor-main").hasClass("is-erasing")).toBe(true);
        expect(sizeButton().hasClass("is-eraser")).toBe(true);
        // Medium: radius 9, so the ring is 18 px across, like the circle in the pen zone
        expect(sizeButton().getAttribute("aria-label")).toBe("Eraser size: Medium");
        expect(dotSize()).toBe("18px");
        sizeButton().click();
        expect(dotSize()).toBe("30px");
        sizeButton().click();
        expect(dotSize()).toBe("10px");

        // The pen keeps its own size
        eraser().click();
        expect(sizeButton().getAttribute("aria-label")).toBe("Pen thickness: Thin");
        expect(sizeDot()).not.toBeNull();
    });

    test("clear side and undo act on the side shown only", async () => {
        const strokes = [stroke(0)];
        const { cb } = openEdit({
            front: side({ text: "Q", strokes }),
            back: side({ text: "A", strokes: [stroke(50)] }),
        });
        clearSide().click();
        expect(textAreas()[0].value).toBe("");
        expect(inkFields()[0].hasClass("is-empty")).toBe(true);
        expect(textAreas()[1].value).toBe("A");
        expect(clearSide().disabled).toBe(true);

        // The back has nothing to undo
        switchSide().click();
        expect(undo().disabled).toBe(true);
        switchSide().click();

        undo().click();
        expect(textAreas()[0].value).toBe("Q");
        expect(inkFields()[0].hasClass("is-empty")).toBe(false);
        expect(undo().disabled).toBe(true);

        button("Save").click();
        await flush();
        expect(cb.save.mock.calls[0][0].front).toEqual({
            text: "Q",
            ink: { strokes, penSize: 1.5, changed: false },
        });
    });

    test("writing with the pen keeps the focus in the text area", () => {
        withCanvas(() => {
            openAdd();
            switchSide().click();
            type(1, "A");
            const backInk = inkFields()[1];
            const canvas = backInk.querySelector("canvas");
            for (const [type, x] of [
                ["pointerdown", 10],
                ["pointermove", 40],
                ["pointerup", 40],
            ] as const) {
                pointer(type, canvas, "pen", 1, { clientX: x });
            }
            expect(backInk.hasClass("is-empty")).toBe(false);
            expect(document.activeElement).toBe(textAreas()[1]);
            expect(undo().disabled).toBe(false);
        });
    });

    test("Ctrl+Z in the text area undoes the ink when it was the last change", () => {
        withCanvas(() => {
            openAdd();
            const ink = inkFields()[0];
            const draw = () => {
                const canvas = ink.querySelector("canvas");
                pointer("pointerdown", canvas, "pen", 1, { clientX: 10 });
                pointer("pointermove", canvas, "pen", 1, { clientX: 40 });
                pointer("pointerup", canvas, "pen", 1, { clientX: 40 });
            };
            const ctrlZ = (el: HTMLElement) => keyDown(el, "z", { ctrlKey: true });

            draw();
            expect(ctrlZ(textAreas()[0]).defaultPrevented).toBe(true);
            expect(ink.hasClass("is-empty")).toBe(true);

            // Typed after the stroke: the text area's own undo
            draw();
            type(0, "Q");
            expect(ctrlZ(textAreas()[0]).defaultPrevented).toBe(false);
            expect(ink.hasClass("is-empty")).toBe(false);

            // Outside a text area it always undoes the ink
            expect(ctrlZ($(".sr-card-editor-sides")).defaultPrevented).toBe(true);
            expect(ink.hasClass("is-empty")).toBe(true);
        });
    });
});

describe("CardEditorModal pen side button", () => {
    /** The pen hovering over the front's pen zone, with the side button pressed or not */
    const hover = (pressed: boolean) =>
        pointer("pointermove", inkFields()[0].querySelector("canvas"), "pen", pressed ? 1 : 0, {
            pressure: 0,
        });

    test("a press while hovering toggles the eraser, once per press", () => {
        jest.useFakeTimers({ now: 10_000 });
        openAdd();
        hover(true);
        // One sample is not enough
        expect(eraser().hasClass("is-active")).toBe(false);
        hover(true);
        expect(eraser().hasClass("is-active")).toBe(true);
        hover(true);
        expect(eraser().hasClass("is-active")).toBe(true);
        hover(false);
        hover(true);
        hover(true);
        expect(eraser().hasClass("is-active")).toBe(false);
    });

    test("not right after the tip touched or lifted, and not for a mouse", () => {
        jest.useFakeTimers({ now: 10_000 });
        withCanvas(() => {
            openAdd();
            const canvas = inkFields()[0].querySelector("canvas");
            pointer("pointerdown", canvas, "pen");
            pointer("pointerup", canvas, "pen");
            jest.advanceTimersByTime(200);
            hover(true);
            hover(true);
            expect(eraser().hasClass("is-active")).toBe(false);

            jest.advanceTimersByTime(100);
            for (let i = 0; i < 2; i++) pointer("pointermove", canvas, "mouse", 1, { pressure: 0 });
            expect(eraser().hasClass("is-active")).toBe(false);
            hover(true);
            hover(true);
            expect(eraser().hasClass("is-active")).toBe(true);
        });
    });

    test("not while the pen writes, and not right after a pen tap elsewhere", () => {
        jest.useFakeTimers({ now: 10_000 });
        withCanvas(() => {
            openAdd();
            const canvas = inkFields()[0].querySelector("canvas");
            pointer("pointerdown", canvas, "pen");
            jest.advanceTimersByTime(300);
            hover(true);
            hover(true);
            pointer("pointerup", canvas, "pen");
            expect(eraser().hasClass("is-active")).toBe(false);

            // A pen tap on a button just above the pen zone
            jest.advanceTimersByTime(300);
            pointer("pointerdown", sizeButton(), "pen");
            pointer("pointerup", sizeButton(), "pen");
            jest.advanceTimersByTime(200);
            hover(true);
            hover(true);
            expect(eraser().hasClass("is-active")).toBe(false);
        });
    });
});

describe("CardEditorModal pen only", () => {
    /** A finger tap on a button: pointerdown, then the click the browser adds */
    function fingerTap(el: HTMLElement) {
        pointer("pointerdown", el, "touch");
        el.click();
    }

    test("the palm touching a button while the pen writes doesn't press it", () => {
        jest.useFakeTimers({ now: 10_000 });
        const { cb } = openAdd();
        type(0, "Q");
        type(1, "A");
        const ink = sideEls()[0];
        pointer("pointerdown", ink, "pen");

        fingerTap(saveNext());
        fingerTap(deleteCard());
        fingerTap(deleteCard());
        fingerTap(switchSide());
        expect(cb.save).not.toHaveBeenCalled();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(shown()).toBe(0);

        // Just after the pen was lifted, still the palm
        pointer("pointerup", ink, "pen");
        jest.advanceTimersByTime(300);
        fingerTap(saveNext());
        expect(cb.save).not.toHaveBeenCalled();

        // A finger tap a moment later works
        jest.advanceTimersByTime(300);
        fingerTap(saveNext());
        expect(cb.save).toHaveBeenCalledTimes(1);
    });

    test("a pen hovering over the screen doesn't block finger taps", () => {
        jest.useFakeTimers({ now: 10_000 });
        const { cb } = openAdd();
        type(0, "Q");
        type(1, "A");
        pointer("pointermove", sideEls()[0], "pen", 0);
        pointer("pointermove", sideEls()[0], "pen", 1, { pressure: 0 });
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

        const penOnly = openAdd();
        closeOnBackground(penOnly.modal);
        tapBackground();
        expect(penOnly.cb.closed).not.toHaveBeenCalled();
        penOnly.modal.close();

        const normal = openAdd(null, { cardEditorPenMode: false });
        closeOnBackground(normal.modal);
        tapBackground();
        expect(normal.cb.closed).toHaveBeenCalled();
    });
});

test("on mobile the front's text area is focused too, so the keyboard is up", async () => {
    const isMobile = jest.spyOn(Platform, "isMobile", "get").mockReturnValue(true);
    try {
        const { cb } = openAdd();
        expect(document.activeElement).toBe(textAreas()[0]);
        expect($(".sr-card-editor-modal").style.getPropertyValue("--sr-card-editor-height")).toBe(
            `${window.innerHeight}px`,
        );
        type(0, "Q");
        type(1, "A");
        saveNext().click();
        await flush();
        expect(cb.save).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(textAreas()[0]);
    } finally {
        isMobile.mockRestore();
    }
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
        const { cb } = openAdd({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        const frontInk = inkFields()[0];
        const canvas = frontInk.querySelector("canvas");
        // A stroke, the last change: Ctrl+Z in the text area would undo it
        withCanvas(() => {
            pointer("pointerdown", canvas, "pen", 1, { clientX: 10 });
            pointer("pointermove", canvas, "pen", 1, { clientX: 40 });
            pointer("pointerup", canvas, "pen", 1, { clientX: 40 });
        });
        const finish = deferSave(cb);
        saveNext().click();

        expect(textAreas()[0].readOnly).toBe(true);
        const reached = jest.fn();
        canvas.addEventListener("pointerdown", reached);
        pointer("pointerdown", canvas, "pen");
        expect(reached).not.toHaveBeenCalled();
        expect(keyDown(textAreas()[0], "Tab").defaultPrevented).toBe(false);
        expect(clearSide().disabled).toBe(true);
        expect(undo().disabled).toBe(true);
        expect(switchSide().disabled).toBe(true);
        clearSide().click();
        switchSide().click();
        keyDown(textAreas()[0], "z", { ctrlKey: true });
        expect(frontInk.hasClass("is-empty")).toBe(false);
        expect(textAreas()[0].value).toBe("Q");
        expect(shown()).toBe(0);

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
        const touch = pointer("pointerdown", textAreas()[0], "mouse");
        expect(touch.defaultPrevented).toBe(true);

        finish(false);
        await flush();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(textAreas().some((ta) => ta.readOnly)).toBe(false);
        expect(pointer("pointerdown", textAreas()[0], "mouse").defaultPrevented).toBe(false);
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q", "A"]);
    });
});

describe("CardEditorModal buttons on the left", () => {
    const moved = () => $(".sr-card-editor-main").hasClass("sr-card-editor-buttons-left");

    test("the setting moves the right column to the left, with pen mode on", () => {
        openAdd(null, { cardEditorButtonsLeft: true });
        expect(moved()).toBe(true);
    });

    test("off by default, and without pen mode", () => {
        openAdd();
        expect(moved()).toBe(false);
        document.body.replaceChildren();
        openAdd(null, { cardEditorButtonsLeft: true, cardEditorPenMode: false });
        expect(moved()).toBe(false);
    });
});

describe("CardEditorModal previous / next card", () => {
    const prev = () => iconButton("Previous card");
    const next = () => iconButton("Next card");

    function openStepping(prevCard: boolean, nextCard: boolean) {
        const cb = callbacks();
        const stepped = jest.fn<void, [-1 | 1]>();
        const opts: CardEditorOptions = {
            kind: "edit",
            title: "Biology",
            initial: { front: side({ text: "Q" }), back: side({ text: "A" }) },
            cardType: CardType.MultiLineBasic,
            save: cb.save,
            closed: cb.closed,
            delete: cb.delete,
            steps: { prev: prevCard, next: nextCard, stepped },
        };
        new CardEditorModal(testApp(), SETTINGS, opts).open();
        return { cb, stepped };
    }

    test("only shown when editing a card of a note, disabled at the ends", () => {
        openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        expect(prev()).toBeNull();
        expect(next()).toBeNull();
        document.body.replaceChildren();

        openStepping(false, true);
        expect(prev().disabled).toBe(true);
        expect(next().disabled).toBe(false);
        document.body.replaceChildren();

        // A note with one card
        openStepping(false, false);
        expect(prev().disabled).toBe(true);
        expect(next().disabled).toBe(true);
    });

    test("stepping saves the changes first, then closes", async () => {
        const { cb, stepped } = openStepping(true, true);
        type(1, "A2");
        next().click();
        await flush();
        expect(cb.save).toHaveBeenCalledWith({
            cardType: CardType.MultiLineBasic,
            front: textOnly("Q"),
            back: textOnly("A2"),
        });
        expect(stepped).toHaveBeenCalledWith(1);
        expect(cb.save.mock.invocationCallOrder[0]).toBeLessThan(
            stepped.mock.invocationCallOrder[0],
        );
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("a card without changes is not saved", async () => {
        const { cb, stepped } = openStepping(true, true);
        prev().click();
        await flush();
        expect(cb.save).not.toHaveBeenCalled();
        expect(stepped).toHaveBeenCalledWith(-1);
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("a failed save stays on the card", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        const { cb, stepped } = openStepping(true, true);
        cb.save.mockRejectedValueOnce(new Error("gone"));
        type(0, "Q2");
        next().click();
        await flush();
        expect(Notice).toHaveBeenCalledTimes(1);
        expect(stepped).not.toHaveBeenCalled();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(next().disabled).toBe(false);
        expect(textAreas()[0].value).toBe("Q2");
    });
});

describe("CardEditorModal card types", () => {
    const typeButton = () => $<HTMLButtonElement>("button.sr-card-editor-type");
    /** Opens the card type menu and returns its items */
    function typeMenu() {
        (Menu as unknown as { last: unknown }).last = null;
        typeButton().click();
        return (Menu as unknown as { last: { items: { title: string; checked: boolean }[] } }).last;
    }
    /** Picks a card type from the menu */
    function pick(title: string) {
        const item = typeMenu().items.find((i) => i.title === title) as unknown as {
            click(): void;
        };
        item.click();
    }

    test("adding offers Basic, Reversed and Cloze; each saves its type", async () => {
        const { cb } = openAdd();
        expect(typeButton().textContent).toBe("Basic ▾");
        expect(typeMenu().items.map((i) => [i.title, i.checked])).toEqual([
            ["Basic", true],
            ["Reversed", false],
            ["Cloze", false],
        ]);

        pick("Reversed");
        expect(typeButton().textContent).toBe("Reversed ▾");
        type(0, "Q");
        type(1, "A");
        saveNext().click();
        await flush();
        expect(cb.save.mock.calls[0][0].cardType).toBe(CardType.MultiLineReversed);
        // Kept for the next card
        expect(typeButton().textContent).toBe("Reversed ▾");

        pick("Cloze");
        type(0, "a ==b==");
        saveNext().click();
        await flush();
        expect(cb.save.mock.calls[1][0]).toEqual({
            cardType: CardType.Cloze,
            front: textOnly("a ==b=="),
            back: null,
        });
    });

    test("cloze: one side, no pen zone, no switch; its text is kept from the front and back", () => {
        openAdd();
        type(0, "Q");
        type(1, "A");
        pick("Cloze");
        expect(sideEls()).toHaveLength(1);
        expect(inkFields()).toHaveLength(0);
        expect(switchSide()).toBeNull();
        expect(sideLabel()).toBe("Cloze");
        expect($(".sr-card-editor-main").hasClass("sr-card-editor-one-side")).toBe(true);
        expect(iconButton("Mark as cloze")).not.toBeNull();
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q"]);

        pick("Basic");
        expect(inkFields()).toHaveLength(2);
        expect(switchSide()).not.toBeNull();
        expect(iconButton("Mark as cloze")).toBeNull();
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q", ""]);
    });

    test("handwriting can't go into a cloze card", () => {
        openAdd({ front: side({ strokes: [stroke(0)] }), back: side() });
        pick("Cloze");
        expect(Notice).toHaveBeenCalledWith(expect.stringContaining("Handwriting"));
        expect(inkFields()).toHaveLength(2);
        expect(typeButton().textContent).toBe("Basic ▾");
    });

    test("a draft keeps its card type", () => {
        const { modal, cb } = openAdd();
        pick("Cloze");
        type(0, "a ==b==");
        modal.close();
        expect(cb.keepDraft).toHaveBeenCalledWith({
            cardType: CardType.Cloze,
            front: side({ text: "a ==b==", penSize: 1.5 }),
            back: null,
        });
        const draft = cb.keepDraft.mock.calls[0][0];
        document.body.replaceChildren();
        openAdd(draft);
        expect(typeButton().textContent).toBe("Cloze ▾");
        expect(sideEls()).toHaveLength(1);
    });

    test("Mark as cloze wraps the selection, or puts the cursor inside an empty one", () => {
        openAdd(null, { clozePatterns: ["{{[123::]answer[::hint]}}"] });
        pick("Cloze");
        const ta = textAreas()[0];
        type(0, "The heart has four chambers");
        ta.setSelectionRange(14, 18);
        iconButton("Mark as cloze").click();
        expect(ta.value).toBe("The heart has {{four}} chambers");
        expect(ta.selectionStart).toBe(22);

        ta.setSelectionRange(ta.value.length, ta.value.length);
        iconButton("Mark as cloze").click();
        expect(ta.value).toBe("The heart has {{four}} chambers{{}}");
        expect(ta.selectionStart).toBe(ta.value.length - 2);
    });

    test("a cloze card without a cloze is refused", async () => {
        const { cb } = openAdd();
        pick("Cloze");
        type(0, "Nothing marked");
        saveClose().click();
        await flush();
        expect(cb.save).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith("Mark at least one part as cloze", 2000);
    });

    test("editing offers the other one of basic and reversed, with a notice", async () => {
        const { cb } = openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        expect(typeMenu().items.map((i) => i.title)).toEqual(["Basic", "Reversed"]);
        pick("Reversed");
        expect(Notice).toHaveBeenCalledWith("The reverse direction becomes a new card");
        button("Save").click();
        await flush();
        expect(cb.save.mock.calls[0][0].cardType).toBe(CardType.MultiLineReversed);
        document.body.replaceChildren();

        openEdit(
            { front: side({ text: "Q" }), back: side({ text: "A" }) },
            CardType.SingleLineReversed,
        );
        expect(typeButton().textContent).toBe("Reversed ▾");
        pick("Basic");
        expect(Notice).toHaveBeenCalledWith("The reverse direction's schedule is dropped");
        expect(typeButton().textContent).toBe("Basic ▾");
    });

    test("a cloze card being edited shows its type without a menu", () => {
        openEdit({ front: side({ text: "a ==b==" }), back: null }, CardType.Cloze);
        expect(typeButton().textContent).toBe("Cloze");
        expect(typeButton().disabled).toBe(true);
    });
});

describe("CardEditorModal preview", () => {
    /** The mock renderer; its last argument is the component that owns what it rendered */
    const render = jest.mocked(
        MarkdownRenderer as unknown as {
            render: jest.Mock<
                Promise<void>,
                [App, string, HTMLElement, string, { loaded: boolean }]
            >;
        },
    ).render;
    const preview = () => iconButton("Preview");
    const previewEls = () => $$(".sr-card-editor-preview");

    test("renders the side's text; a tap on it goes back to typing at the end", () => {
        openAdd();
        type(0, "**bold** $x^2$");
        preview().click();
        expect(render).toHaveBeenLastCalledWith(
            expect.anything(),
            "**bold** $x^2$",
            previewEls()[0],
            "",
            expect.anything(),
        );
        expect($(".sr-card-editor-text-wrap.is-preview")).not.toBeNull();
        expect(preview().getAttribute("aria-pressed")).toBe("true");

        previewEls()[0].click();
        expect($(".sr-card-editor-text-wrap.is-preview")).toBeNull();
        expect(previewEls()[0].textContent).toBe("");
        expect(document.activeElement).toBe(textAreas()[0]);
        expect(textAreas()[0].selectionStart).toBe("**bold** $x^2$".length);
    });

    test("stays on when switching sides, shows the other side; unloaded when off and closed", () => {
        const { modal } = openAdd();
        type(0, "Q");
        type(1, "A");
        preview().click();
        const component = render.mock.lastCall[4];
        switchSide().click();
        expect(component.loaded).toBe(false);
        expect(previewEls()[0].textContent).toBe("");
        expect(previewEls()[1].textContent).toBe("A");

        preview().click();
        expect($(".sr-card-editor-text-wrap.is-preview")).toBeNull();
        preview().click();
        const last = render.mock.lastCall[4];
        modal.close();
        expect(last.loaded).toBe(false);
    });
});

describe("CardEditorModal decks", () => {
    function open(decks: string[]) {
        const cb = callbacks();
        new CardEditorModal(testApp(), SETTINGS, {
            kind: "add",
            title: "Biology",
            decks,
            draft: null,
            ...cb,
        }).open();
    }
    const deckLine = () => $(".sr-card-editor-decks");

    test("shows the card's decks under the title", () => {
        open(["medicine"]);
        expect(deckLine().textContent).toBe("Deck: medicine");
        expect(deckLine().hasClass("is-warning")).toBe(false);
        document.body.replaceChildren();
        open(["medicine", "biology/cells"]);
        expect(deckLine().textContent).toBe("Decks: medicine, biology/cells");
    });

    test("no deck: says the note is no flashcard note", () => {
        open([]);
        expect(deckLine().textContent).toContain("has no #flashcards tag");
        expect(deckLine().hasClass("is-warning")).toBe(true);
    });
});
