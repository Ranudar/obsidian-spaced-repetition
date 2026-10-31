import { App, Notice, Platform } from "obsidian";

import {
    CardEditorModal,
    CardEditorOptions,
    CardEditorResult,
    CardEditorSides,
} from "src/card-editor/card-editor-modal";
import { Stroke } from "src/card-editor/core/strokes";
import { InkField } from "src/card-editor/ink-field";
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

const stroke = (x: number): Stroke => ({
    points: [
        [x, 0, 0.5],
        [x + 10, 10, 0.5],
    ],
    pressure: false,
});

const side = (s: Partial<SideState> = {}): SideState => ({
    mode: "text",
    text: "",
    strokes: [],
    penSize: 5,
    ...s,
});

interface Callbacks {
    save: jest.Mock<Promise<void>, [CardEditorResult]>;
    keepDraft: jest.Mock<void, [CardEditorSides | null]>;
    closed: jest.Mock<void, []>;
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
const undo = () => iconButton("Undo");
const clearSide = () => iconButton("Clear side");
const saveNext = () => button("Save & next");
const saveClose = () => button("Save & close");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
        expect(button("Discard")).toBeDefined();
        expect(document.activeElement).toBe(textAreas()[0]);
    });

    test("sides start in the default input mode", () => {
        openAdd(null, { cardEditorDefaultMode: "ink" });
        expect($$(".sr-card-editor-side.is-ink")).toHaveLength(2);
        expect($$(".sr-ink-field")).toHaveLength(2);
    });

    test("edit mode: Cancel and Save, sides loaded from the card", () => {
        openEdit({ front: side({ text: "Q" }), back: side({ mode: "ink", strokes: [stroke(0)] }) });
        expect(textAreas()[0].value).toBe("Q");
        expect($$(".sr-card-editor-side")[1].hasClass("is-ink")).toBe(true);
        expect(button("Cancel")).toBeDefined();
        expect(button("Save")).toBeDefined();
        expect(saveNext()).toBeUndefined();
        expect(button("Discard")).toBeUndefined();
        expect($(".sr-card-editor-counter")).toBeNull();
    });

    test("cloze: one text side without pen switch", () => {
        openEdit({ front: side({ text: "a ==b==" }), back: null }, CardType.Cloze);
        expect($$(".sr-card-editor-side")).toHaveLength(1);
        expect($(".sr-card-editor-side-label").textContent).toBe("Card");
        expect($(".sr-card-editor-mode-switch")).toBeNull();
        expect(eraser().disabled).toBe(true);
    });
});

describe("CardEditorModal add mode", () => {
    test("save is disabled until both sides have content", () => {
        openAdd();
        expect(saveNext().disabled).toBe(true);
        // An empty card is closed with ✕, Esc or Discard
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
        expect(cb.save).toHaveBeenCalledWith({
            front: { mode: "text", text: "Q1" },
            back: { mode: "text", text: "A1" },
        });
        expect(textAreas().map((ta) => ta.value)).toEqual(["", ""]);
        // The counter sits in the footer, between Discard and the save buttons
        const counter = $(".sr-card-editor-counter");
        expect(counter.parentElement).toBe($(".sr-card-editor-footer"));
        expect(counter.previousElementSibling).toBe(button("Discard"));
        expect(counter.textContent).toBe("1 card(s) added");
        expect(document.activeElement).toBe(textAreas()[0]);
        expect(cb.closed).not.toHaveBeenCalled();

        type(0, "Q2");
        type(1, "A2");
        saveNext().click();
        await flush();
        expect(cb.save).toHaveBeenCalledTimes(2);
        expect($(".sr-card-editor-counter").textContent).toContain("2 card(s) added");
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

    test("ink sides are saved with strokes, pen size and the changed flag", async () => {
        const { cb } = openAdd({
            front: side({ text: "Q" }),
            back: side({ mode: "ink", strokes: [stroke(0)], penSize: 7 }),
        });
        saveNext().click();
        await flush();
        expect(cb.save.mock.calls[0][0].back).toEqual({
            mode: "ink",
            strokes: [stroke(0)],
            penSize: 7,
            changed: false,
        });
        // The next card keeps each side's input mode
        expect($$(".sr-card-editor-side")[1].hasClass("is-ink")).toBe(true);
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

    test("a draft keeps the strokes of a side switched back to text", () => {
        const { modal, cb } = openAdd({
            front: side({ mode: "text", text: "", strokes: [stroke(0)] }),
            back: side(),
        });
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

    test("Discard arms on the first tap and discards on the second", () => {
        const { cb } = openAdd();
        type(0, "Q");
        const discard = $<HTMLButtonElement>(".sr-card-editor-discard");
        discard.click();
        expect(discard.textContent).toBe("Tap again to discard");
        expect(cb.closed).not.toHaveBeenCalled();
        discard.click();
        expect(cb.keepDraft).toHaveBeenCalledWith(null);
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("Discard disarms after 3 seconds", () => {
        jest.useFakeTimers();
        const { cb } = openAdd();
        type(0, "Q");
        const discard = $<HTMLButtonElement>(".sr-card-editor-discard");
        discard.click();
        jest.advanceTimersByTime(3000);
        expect(discard.textContent).toBe("Discard");
        discard.click();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(discard.textContent).toBe("Tap again to discard");
    });

    test("Save & next disarms Discard for the next card", async () => {
        jest.useFakeTimers();
        const { cb } = openAdd();
        type(0, "Q");
        type(1, "A");
        const discard = $<HTMLButtonElement>(".sr-card-editor-discard");
        discard.click();
        expect(discard.textContent).toBe("Tap again to discard");
        saveNext().click();
        await jest.advanceTimersByTimeAsync(0);
        expect(cb.save).toHaveBeenCalledTimes(1);
        expect(discard.textContent).toBe("Discard");
        expect(discard.hasClass("is-armed")).toBe(false);

        // Within the first tap's 3 s: the first tap on the new card only arms
        type(0, "Q2");
        discard.click();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(discard.textContent).toBe("Tap again to discard");
    });

    test("Discard arms first on an empty card too", () => {
        const { cb } = openAdd();
        const discard = $<HTMLButtonElement>(".sr-card-editor-discard");
        discard.click();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(discard.textContent).toBe("Tap again to discard");
        discard.click();
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
    test("Cancel closes without saving", () => {
        const { cb } = openEdit({ front: side({ text: "Q" }), back: side({ text: "A" }) });
        button("Cancel").click();
        expect(cb.save).not.toHaveBeenCalled();
        expect(cb.closed).toHaveBeenCalledTimes(1);
    });

    test("Save passes both sides and closes", async () => {
        const strokes = [stroke(0)];
        const { cb } = openEdit({
            front: side({ text: "Q" }),
            back: side({ mode: "ink", strokes, penSize: 3 }),
        });
        type(0, "Q2");
        button("Save").click();
        await flush();
        expect(cb.save).toHaveBeenCalledWith({
            front: { mode: "text", text: "Q2" },
            back: { mode: "ink", strokes, penSize: 3, changed: false },
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
        expect(cb.save).toHaveBeenCalledWith({
            front: { mode: "text", text: "a ==b==" },
            back: null,
        });
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
    test("enabled only while a side is in ink mode", () => {
        openAdd();
        expect(eraser().disabled).toBe(true);
        expect(undo().disabled).toBe(true);
        expect(clearSide().disabled).toBe(true);

        $$<HTMLButtonElement>(".sr-card-editor-mode-button")[1].click(); // front → ink
        expect(eraser().disabled).toBe(false);
        expect(undo().disabled).toBe(true); // nothing to undo yet
        expect(clearSide().disabled).toBe(true); // nothing to clear yet
    });

    test("eraser toggles and turns off when no side is ink", () => {
        openAdd(null, { cardEditorDefaultMode: "ink" });
        eraser().click();
        expect(eraser().hasClass("is-active")).toBe(true);
        eraser().click();
        expect(eraser().hasClass("is-active")).toBe(false);
        eraser().click();

        const switches = $$<HTMLButtonElement>(".sr-card-editor-mode-button");
        switches[0].click(); // front → text
        expect(eraser().hasClass("is-active")).toBe(true);
        switches[2].click(); // back → text
        expect(eraser().hasClass("is-active")).toBe(false);
        expect(eraser().disabled).toBe(true);
    });

    test("clear side and undo work across both sides", async () => {
        const front = [stroke(0)];
        const back = [stroke(50)];
        const { cb } = openEdit({
            front: side({ mode: "ink", strokes: front }),
            back: side({ mode: "ink", strokes: back }),
        });
        // Clear acts on the side last touched
        $$(".sr-card-editor-side")[1].dispatchEvent(new Event("pointerdown"));
        clearSide().click();
        expect(button("Save").disabled).toBe(true);
        expect(clearSide().disabled).toBe(false); // front still has ink
        $$(".sr-card-editor-side")[0].dispatchEvent(new Event("pointerdown"));
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
        expect(result.front).toEqual({ mode: "ink", strokes: front, penSize: 5, changed: false });
        expect(result.back).toEqual({ mode: "ink", strokes: back, penSize: 5, changed: false });
    });

    test("undo shows the side it changes in ink mode", () => {
        openAdd({ front: side({ mode: "ink", strokes: [stroke(0)] }), back: side() });
        clearSide().click();
        $$<HTMLButtonElement>(".sr-card-editor-mode-button")[0].click(); // front → text
        expect(undo().disabled).toBe(true); // no ink side
        $$<HTMLButtonElement>(".sr-card-editor-mode-button")[3].click(); // back → ink
        undo().click();
        expect($$(".sr-card-editor-side")[0].hasClass("is-ink")).toBe(true);
    });

    test("Ctrl+Z in a text area is left to the text area", () => {
        openAdd({ front: side({ mode: "ink", strokes: [stroke(0)] }), back: side() });
        clearSide().click();
        const evt = keyDown(textAreas()[1], "z", { ctrlKey: true });
        expect(evt.defaultPrevented).toBe(false);
        expect(undo().disabled).toBe(false);
    });
});

test("a theme change redraws the ink with the new color, until the editor closes", () => {
    const themeChanged = jest.spyOn(InkField.prototype, "themeChanged");
    const { modal } = openAdd({ front: side({ mode: "ink", strokes: [stroke(0)] }), back: side() });
    workspaceEvents.get("css-change")();
    expect(themeChanged).toHaveBeenCalledTimes(1);
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
        fingerTap(button("Discard"));
        fingerTap(button("Discard"));
        fingerTap(undo());
        expect(cb.save).not.toHaveBeenCalled();
        expect(cb.closed).not.toHaveBeenCalled();
        expect(button("Discard")).toBeDefined();

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

    test("the palm doesn't switch a side's mode or focus its text area", () => {
        openAdd(
            { front: side({ mode: "ink", strokes: [stroke(0)] }), back: side() },
            { cardEditorPenOnly: true },
        );
        const [frontSide, backSide] = $$(".sr-card-editor-side");
        pointer("pointerdown", frontSide.querySelector(".sr-ink-field"), "pen");

        fingerTap(frontSide.querySelector<HTMLElement>(".sr-card-editor-mode-button"));
        expect(frontSide.hasClass("is-ink")).toBe(true);
        const touch = pointer("pointerdown", textAreas()[1], "touch");
        expect(touch.defaultPrevented).toBe(true);
        expect(backSide.hasClass("is-text")).toBe(true);
    });

    test("the palm resting on the other side doesn't change the side Clear acts on", () => {
        jest.useFakeTimers({ now: 10_000 });
        openAdd(
            {
                front: side({ mode: "ink", strokes: [stroke(0)] }),
                back: side({ mode: "ink", strokes: [stroke(50)] }),
            },
            { cardEditorPenOnly: true },
        );
        const [frontSide, backSide] = $$(".sr-card-editor-side");
        pointer("pointerdown", frontSide, "pen");
        pointer("pointerup", frontSide, "pen");
        pointer("pointerdown", backSide, "touch");
        jest.advanceTimersByTime(1000);
        clearSide().click();
        expect(frontSide.querySelector(".sr-ink-field").hasClass("is-empty")).toBe(true);
        expect(backSide.querySelector(".sr-ink-field").hasClass("is-empty")).toBe(false);
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

test("on mobile a text side isn't focused on open, so the soft keyboard stays closed", () => {
    const isMobile = jest.spyOn(Platform, "isMobile", "get").mockReturnValue(true);
    try {
        openAdd();
        expect(document.activeElement).not.toBe(textAreas()[0]);
        document.body.replaceChildren();
        openAdd(null, { cardEditorDefaultMode: "ink" });
        expect(document.activeElement).toBe($(".sr-ink-field"));
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
            back: side({ mode: "ink", strokes: [stroke(0)] }),
        });
        const finish = deferSave(cb);
        saveNext().click();

        expect(textAreas()[0].readOnly).toBe(true);
        const draw = pointer("pointerdown", $(".sr-ink-field canvas") ?? $(".sr-ink-field"), "pen");
        expect(draw.defaultPrevented).toBe(true);
        $$<HTMLButtonElement>(".sr-card-editor-mode-button")[2].click(); // back → text
        expect($$(".sr-card-editor-side")[1].hasClass("is-ink")).toBe(true);
        expect(keyDown(textAreas()[0], "Tab").defaultPrevented).toBe(false);
        expect(textAreas()[0].value).toBe("Q");
        expect(clearSide().disabled).toBe(true);
        clearSide().click();
        keyDown($(".sr-card-editor-sides"), "z", { ctrlKey: true });
        expect($(".sr-ink-field").hasClass("is-empty")).toBe(false);

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
