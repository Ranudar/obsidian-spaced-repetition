import { Stroke } from "src/card-editor/core/strokes";
import { SideEditor, SideEditorOptions, SideState } from "src/card-editor/side-editor";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { TextDirection } from "src/utils/strings";

// jsdom has no canvas; the side editor only needs a context object to exist
beforeAll(() => {
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        () => ({}) as unknown as CanvasRenderingContext2D,
    );
});

afterAll(() => {
    jest.restoreAllMocks();
});

const stroke = (x: number): Stroke => ({
    points: [
        [x, 0, 0.5],
        [x + 10, 10, 0.5],
    ],
    pressure: false,
});

const state = (s: Partial<SideState> = {}): SideState => ({
    mode: "text",
    text: "",
    strokes: [],
    penSize: 5,
    ...s,
});

interface Setup {
    side: SideEditor;
    parent: HTMLElement;
    onChange: jest.Mock;
    onInkCommit: jest.Mock;
}

function setup(
    initial: SideState,
    opts: Partial<SideEditorOptions> = {},
    settings: Partial<SRSettings> = {},
): Setup {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onChange = jest.fn();
    const onInkCommit = jest.fn();
    const side = new SideEditor(parent, {
        label: "Front",
        initial,
        allowInk: true,
        settings: { ...DEFAULT_SETTINGS, ...settings },
        textDirection: TextDirection.Ltr,
        onChange,
        onInkCommit,
        ...opts,
    });
    return { side, parent, onChange, onInkCommit };
}

const textArea = (parent: HTMLElement) =>
    parent.querySelector<HTMLTextAreaElement>("textarea.sr-card-editor-text");
const inkField = (parent: HTMLElement) => parent.querySelector<HTMLElement>(".sr-ink-field");
const hint = (parent: HTMLElement) => parent.querySelector<HTMLElement>(".sr-card-editor-hint");
const switchButton = (parent: HTMLElement, index: number) =>
    parent.querySelectorAll<HTMLButtonElement>(".sr-card-editor-mode-button")[index];

function type(parent: HTMLElement, text: string) {
    const ta = textArea(parent);
    ta.value = text;
    ta.dispatchEvent(new Event("input"));
}

// jsdom has no PointerEvent, a MouseEvent with the pointer fields added does the job
function pointer(type: string, target: HTMLElement, pointerType: string) {
    const evt = new MouseEvent(type, { bubbles: true, cancelable: true, buttons: 1 });
    Object.assign(evt, { pointerType, pointerId: 1, pressure: 0.5 });
    target.dispatchEvent(evt);
    return evt;
}

const pointerDown = (target: HTMLElement, pointerType: string) =>
    pointer("pointerdown", target, pointerType);

afterEach(() => {
    document.body.replaceChildren();
});

describe("SideEditor modes", () => {
    test("starts in the initial mode, ink field only created for ink", () => {
        const text = setup(state({ mode: "text", text: "Hello" }));
        expect(text.side.mode).toBe("text");
        expect(textArea(text.parent).value).toBe("Hello");
        expect(inkField(text.parent)).toBeNull();

        const ink = setup(state({ mode: "ink", strokes: [stroke(0)] }));
        expect(ink.side.mode).toBe("ink");
        expect(inkField(ink.parent)).not.toBeNull();
        expect(textArea(ink.parent).hasClass("sr-is-hidden")).toBe(true);
    });

    test("switch buttons change the mode and report a change", () => {
        const { side, parent, onChange } = setup(state());
        switchButton(parent, 1).click();
        expect(side.mode).toBe("ink");
        expect(side.el.hasClass("is-ink")).toBe(true);
        expect(switchButton(parent, 1).hasClass("is-active")).toBe(true);
        expect(onChange).toHaveBeenCalledTimes(1);

        switchButton(parent, 0).click();
        expect(side.mode).toBe("text");
        expect(textArea(parent).hasClass("sr-is-hidden")).toBe(false);
        expect(onChange).toHaveBeenCalledTimes(2);

        // Same mode again: no change
        side.setMode("text");
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    test("without ink (cloze) there is no switch and ink mode is refused", () => {
        const { side, parent } = setup(state({ mode: "ink" }), { allowInk: false });
        expect(side.mode).toBe("text");
        expect(switchButton(parent, 0)).toBeUndefined();
        side.setMode("ink");
        expect(side.mode).toBe("text");
        expect(inkField(parent)).toBeNull();
    });

    test("a pen touching the text area switches to ink when the setting is on", () => {
        const { side, parent, onInkCommit } = setup(state({ text: "typed" }));
        textArea(parent).focus();
        const evt = pointerDown(textArea(parent), "pen");
        expect(side.mode).toBe("ink");
        expect(evt.defaultPrevented).toBe(true);
        // The hidden text area doesn't keep the focus (and the soft keyboard)
        expect(document.activeElement).toBe(inkField(parent));

        // The same pen touch draws the first stroke
        pointer("pointerup", parent.querySelector("canvas"), "pen");
        expect(side.state.strokes).toHaveLength(1);
        expect(side.state.strokes[0].pressure).toBe(true);
        expect(onInkCommit).toHaveBeenCalledWith([]);
    });

    test("mouse, finger, or the setting off keep the text mode", () => {
        const on = setup(state());
        pointerDown(textArea(on.parent), "mouse");
        pointerDown(textArea(on.parent), "touch");
        expect(on.side.mode).toBe("text");

        const off = setup(state(), {}, { cardEditorPenSwitchesToInk: false });
        pointerDown(textArea(off.parent), "pen");
        expect(off.side.mode).toBe("text");
    });

    test("the text area doesn't pan when a pen touch can switch it to ink", () => {
        expect(textArea(setup(state()).parent).hasClass("sr-pen-switch")).toBe(true);
        const off = setup(state(), {}, { cardEditorPenSwitchesToInk: false });
        expect(textArea(off.parent).hasClass("sr-pen-switch")).toBe(false);
        const cloze = setup(state(), { allowInk: false });
        expect(textArea(cloze.parent).hasClass("sr-pen-switch")).toBe(false);
    });

    test("typing into an empty ink side switches to text and keeps the key", () => {
        const { side, parent, onChange } = setup(state({ mode: "ink" }));
        const evt = new KeyboardEvent("keydown", { key: "a", cancelable: true });
        inkField(parent).dispatchEvent(evt);
        expect(evt.defaultPrevented).toBe(true);
        expect(side.mode).toBe("text");
        expect(side.state.text).toBe("a");
        expect(onChange).toHaveBeenCalled();
    });

    test("typing into an ink side with strokes, or shortcuts, keep the ink mode", () => {
        const { side, parent } = setup(state({ mode: "ink", strokes: [stroke(0)] }));
        inkField(parent).dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
        expect(side.mode).toBe("ink");

        const empty = setup(state({ mode: "ink" }));
        inkField(empty.parent).dispatchEvent(
            new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
        );
        inkField(empty.parent).dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
        expect(empty.side.mode).toBe("ink");
    });
});

describe("SideEditor drafts", () => {
    test("both drafts are kept when switching", () => {
        const strokes = [stroke(0)];
        const { side, parent } = setup(state({ mode: "ink", strokes }));
        side.setMode("text");
        type(parent, "typed");
        side.setMode("ink");
        expect(side.state).toEqual({ mode: "ink", text: "typed", strokes, penSize: 5 });
        side.setMode("text");
        expect(side.state.mode).toBe("text");
        expect(side.state.strokes).toBe(strokes);
    });

    test("strokes set before the ink field exists show up once it is created", () => {
        const strokes = [stroke(0), stroke(20)];
        const { side, parent } = setup(state());
        side.setStrokes(strokes);
        expect(inkField(parent)).toBeNull();
        side.setMode("ink");
        expect(side.state.strokes).toBe(strokes);
        expect(inkField(parent).hasClass("is-empty")).toBe(false);
    });

    test("reset replaces both drafts and the initial state", () => {
        const { side, parent } = setup(state({ mode: "ink", strokes: [stroke(0)], text: "x" }));
        side.setStrokes([stroke(0), stroke(1)]);
        side.reset(state({ mode: "text", penSize: 7 }));
        expect(side.state).toEqual({ mode: "text", text: "", strokes: [], penSize: 7 });
        expect(textArea(parent).value).toBe("");
        expect(side.inkChanged).toBe(false);
    });

    test("tab inserts a tab", () => {
        const { side, parent } = setup(state({ text: "ab" }));
        const ta = textArea(parent);
        ta.setSelectionRange(1, 1);
        const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
        ta.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(true);
        expect(side.state.text).toBe("a\tb");
    });

    test("right-to-left text direction", () => {
        const { parent } = setup(state(), { textDirection: TextDirection.Rtl });
        expect(textArea(parent).getAttribute("dir")).toBe("rtl");
        const ltr = setup(state());
        expect(textArea(ltr.parent).getAttribute("dir")).toBeNull();
    });

    test("destroy removes the side", () => {
        const { side, parent } = setup(state({ mode: "ink" }));
        side.destroy();
        expect(parent.children.length).toBe(0);
    });
});

describe("SideEditor isEmpty", () => {
    test("text mode: empty or whitespace only", () => {
        const { side, parent } = setup(state());
        expect(side.isEmpty).toBe(true);
        type(parent, "  \n ");
        expect(side.isEmpty).toBe(true);
        type(parent, "x");
        expect(side.isEmpty).toBe(false);
    });

    test("ink mode: no strokes, regardless of the text draft", () => {
        const { side, parent } = setup(state({ text: "typed" }));
        side.setMode("ink");
        expect(side.isEmpty).toBe(true);
        side.setStrokes([stroke(0)]);
        expect(side.isEmpty).toBe(false);
        type(parent, "");
        side.setMode("text");
        expect(side.isEmpty).toBe(true);
    });

    test("clear empties the visible mode only, ink clearing can be undone", () => {
        const strokes = [stroke(0)];
        const { side, onInkCommit } = setup(state({ mode: "ink", text: "typed", strokes }));
        side.clear();
        expect(side.isEmpty).toBe(true);
        expect(onInkCommit).toHaveBeenCalledWith(strokes);
        expect(side.state.text).toBe("typed");

        side.setMode("text");
        side.clear();
        expect(side.state.text).toBe("");
        expect(side.isEmpty).toBe(true);
    });

    test("clear on a side whose ink field was never shown", () => {
        const strokes = [stroke(0)];
        const { side, onInkCommit } = setup(state({ strokes }));
        side.setMode("ink");
        side.clear();
        expect(onInkCommit).toHaveBeenCalledWith(strokes);
        expect(side.state.strokes).toEqual([]);
    });
});

describe("SideEditor replacesOther", () => {
    test("ink shown while there is typed text", () => {
        const { side, parent } = setup(state());
        type(parent, "typed");
        expect(side.replacesOther).toBe(false);
        expect(hint(parent).hasClass("sr-is-hidden")).toBe(true);

        side.setMode("ink");
        expect(side.replacesOther).toBe(true);
        expect(hint(parent).textContent).toBe("Saving replaces the text with handwriting");
        expect(hint(parent).hasClass("sr-is-hidden")).toBe(false);
    });

    test("text shown while there are strokes", () => {
        const { side, parent } = setup(state({ mode: "ink", strokes: [stroke(0)] }));
        expect(side.replacesOther).toBe(false);
        side.setMode("text");
        expect(side.replacesOther).toBe(true);
        expect(hint(parent).textContent).toBe("Saving replaces the handwriting with text");
    });

    test("the hint goes away once the other draft is empty", () => {
        const { side, parent } = setup(state({ mode: "ink", strokes: [stroke(0)] }));
        side.setMode("text");
        side.setStrokes([]);
        expect(side.replacesOther).toBe(false);
        expect(hint(parent).hasClass("sr-is-hidden")).toBe(true);

        side.setMode("ink");
        type(parent, "  ");
        expect(side.replacesOther).toBe(false);
    });
});

describe("SideEditor inkChanged", () => {
    test("unchanged strokes, also after switching modes", () => {
        const { side } = setup(state({ mode: "ink", strokes: [stroke(0)] }));
        expect(side.inkChanged).toBe(false);
        side.setMode("text");
        side.setMode("ink");
        expect(side.inkChanged).toBe(false);
    });

    test("added, removed or cleared strokes", () => {
        const a = stroke(0);
        const b = stroke(20);
        const { side } = setup(state({ mode: "ink", strokes: [a, b] }));
        side.setStrokes([a, b, stroke(40)]);
        expect(side.inkChanged).toBe(true);
        side.setStrokes([a]);
        expect(side.inkChanged).toBe(true);
        side.clear();
        expect(side.inkChanged).toBe(true);
    });

    test("undo back to the same strokes counts as unchanged", () => {
        const a = stroke(0);
        const b = stroke(20);
        const { side } = setup(state({ mode: "ink", strokes: [a, b] }));
        side.setStrokes([a]);
        // e.g. the eraser removed a stroke and undo restored it, as a new array
        side.setStrokes([a, b]);
        expect(side.inkChanged).toBe(false);
    });

    test("a text side that gets strokes", () => {
        const { side } = setup(state({ text: "typed" }));
        expect(side.inkChanged).toBe(false);
        side.setMode("ink");
        side.setStrokes([stroke(0)]);
        expect(side.inkChanged).toBe(true);
    });
});
