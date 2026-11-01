import { App, Notice, Platform } from "obsidian";

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
const SETTINGS: SRSettings = { ...DEFAULT_SETTINGS, cardEditorHandwriting: true };

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
        expect($(".sr-card-editor-counter").textContent).toBe("1 added");
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
        // The pen size is the toolbar's (medium of the 2.5 setting); strokes keep their own
        expect(cb.save.mock.calls[0][0]).toEqual({
            front: { text: "", ink: { strokes: [stroke(50)], penSize: 2.5, changed: false } },
            back: {
                text: "typed",
                ink: { strokes: [stroke(0)], penSize: 2.5, changed: false },
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

describe("CardEditorModal with handwriting off", () => {
    test("sides are text only, without pen tools", () => {
        openAdd(null, { cardEditorHandwriting: false });
        expect(inkFields()).toHaveLength(0);
        expect($(".sr-card-editor-modal").hasClass("sr-card-editor-no-ink")).toBe(true);
    });

    test("a side that has handwriting keeps its writing field", () => {
        openEdit(
            { front: side({ text: "Q" }), back: side({ strokes: [stroke(0)] }) },
            CardType.MultiLineBasic,
            { cardEditorHandwriting: false },
        );
        expect(inkFields()).toHaveLength(1);
        expect($(".sr-card-editor-modal").hasClass("sr-card-editor-no-ink")).toBe(false);
    });
});

describe("CardEditorModal drafts and discard", () => {
    test("closing keeps the unsaved card with its text and ink as a draft, which restores", () => {
        const first = openAdd({ front: side({ text: "Q", strokes: [stroke(0)] }), back: side() });
        first.modal.close();
        expect(first.cb.keepDraft).toHaveBeenCalledTimes(1);
        const draft = first.cb.keepDraft.mock.calls[0][0];
        expect(draft.front).toEqual({ text: "Q", strokes: [stroke(0)], penSize: 2.5 });
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

    test("Delete card closes an empty card at once", () => {
        const { cb } = openAdd();
        $<HTMLButtonElement>(".sr-card-editor-discard").click();
        expect(cb.closed).toHaveBeenCalledTimes(1);
        expect(cb.keepDraft).toHaveBeenCalledWith(null);
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
        expect(del.disabled).toBe(false);
    });

    test("the sides load from the card; Save passes both sides and closes", async () => {
        const strokes = [stroke(0)];
        const { cb } = openEdit({
            front: side({ text: "Q" }),
            back: side({ strokes, penSize: 3 }),
        });
        expect(textAreas().map((ta) => ta.value)).toEqual(["Q", ""]);
        expect(inkFields()[1].hasClass("is-empty")).toBe(false);
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

    test("cloze has a single text side without ink and saves it", async () => {
        const { cb } = openEdit({ front: side({ text: "a ==b==" }), back: null }, CardType.Cloze);
        expect(sideEls()).toHaveLength(1);
        expect(inkFields()).toHaveLength(0);
        keyDown(textAreas()[0], "Enter", { ctrlKey: true });
        await flush();
        expect(cb.save).toHaveBeenCalledWith({ front: textOnly("a ==b=="), back: null });
    });
});

describe("CardEditorModal pen tools", () => {
    test("pen size cycles medium, thick, thin around the setting", async () => {
        const { modal, cb } = openAdd(
            { front: side({ text: "Q" }), back: side({ strokes: [stroke(0)] }) },
            { cardEditorPenSize: 2.5 },
        );
        expect(penSize().hasClass("is-medium")).toBe(true);
        penSize().click();
        expect(penSize().hasClass("is-thick")).toBe(true);

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
});
