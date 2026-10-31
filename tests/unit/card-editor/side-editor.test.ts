import { readFileSync } from "fs";
import { join } from "path";

import { Stroke } from "src/card-editor/core/strokes";
import { InkField } from "src/card-editor/ink-field";
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

/** A stroke as written in the editor: with its own size */
const stroke = (x: number, size = 5): Stroke => ({
    points: [
        [x, 0, 0.5],
        [x + 10, 10, 0.5],
    ],
    pressure: false,
    size,
});

const state = (s: Partial<SideState> = {}): SideState => ({
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

describe("SideEditor layout", () => {
    test("text area on top, ink field below it, in one box", () => {
        const { side, parent } = setup(state({ text: "Hello", strokes: [stroke(0)] }));
        const body = parent.querySelector(".sr-card-editor-side-body");
        expect(Array.from(body.children).map((el) => el.className)).toEqual([
            "sr-card-editor-text",
            "sr-card-editor-ink",
        ]);
        expect(textArea(parent).value).toBe("Hello");
        expect(inkField(parent).hasClass("is-empty")).toBe(false);
        expect(side.state).toEqual({ text: "Hello", strokes: [stroke(0)], penSize: 5 });
        // The label is above the box
        expect(side.el.firstElementChild.textContent).toBe("Front");
        expect(textArea(parent).placeholder).toBe("Type…");
    });

    test("no mode switch, draft dots or hints", () => {
        const { side, parent } = setup(state({ text: "typed", strokes: [stroke(0)] }));
        expect(parent.querySelector("[class*='mode']")).toBeNull();
        expect(parent.querySelector(".sr-card-editor-hint")).toBeNull();
        expect(parent.querySelector("button")).toBeNull();
        expect(side.el.hasClass("is-text-only")).toBe(false);
    });

    test("nothing is added or removed while typing and writing", () => {
        const { side, parent } = setup(state());
        const before = parent.querySelectorAll("*").length;
        type(parent, "typed");
        side.setStrokes([stroke(0)]);
        type(parent, "");
        side.clear();
        expect(parent.querySelectorAll("*").length).toBe(before);
    });

    test("without ink (cloze) there is only the text area", () => {
        const { side, parent } = setup(state({ text: "a ==b==" }), { allowInk: false });
        expect(inkField(parent)).toBeNull();
        expect(side.el.hasClass("is-text-only")).toBe(true);
        expect(side.inkEl).toBeNull();
        side.setStrokes([stroke(0)]);
        expect(side.state.strokes).toEqual([]);
    });

    test("the text area has a fixed height of a few lines and scrolls inside itself", () => {
        const css = readFileSync(
            join(__dirname, "../../../src/card-editor/card-editor.css"),
            "utf8",
        );
        const rule = css.match(/\.sr-card-editor-side-body > \.sr-card-editor-text \{[^}]*\}/)[0];
        // Never grows; shrinks only in a low window, down to one line, before the ink field does
        expect(rule).toMatch(/flex: 0 100 auto/);
        expect(rule).toMatch(/min-height: calc\(var\(--font-text-size\)/);
        expect(rule).toMatch(/--sr-card-editor-text-lines/);
        expect(rule).toMatch(/overflow-y: auto/);
        expect(rule).toMatch(/resize: none/);
        // No border of its own: its height is exactly its lines, the ink field draws the divider
        expect(rule).not.toMatch(/border-bottom/);
        const ink = css.match(/\.sr-card-editor-ink \{[^}]*\}/)[0];
        expect(ink).toMatch(/border-top: 1px/);
        // Always inside the box: it shrinks instead of being pushed past the box' bottom edge,
        // where it would be cut off but still take ink
        expect(ink).toMatch(/flex: 1 1 60px/);
        expect(ink).toMatch(/min-height: 0/);
        expect(ink).toMatch(/overflow: hidden/);
    });

    test("focusInk moves the focus from the text area to the ink field", () => {
        const { side, parent } = setup(state());
        textArea(parent).focus();
        side.focusInk();
        expect(document.activeElement).toBe(side.inkEl);
    });

    test("a pen touching the text area isn't stopped", () => {
        const { parent } = setup(state({ text: "typed" }));
        const evt = pointerDown(textArea(parent), "pen");
        expect(evt.defaultPrevented).toBe(false);
    });

    test("typing on the ink field doesn't change the text", () => {
        const { side, parent } = setup(state());
        const evt = new KeyboardEvent("keydown", { key: "a", cancelable: true });
        inkField(parent).dispatchEvent(evt);
        expect(evt.defaultPrevented).toBe(false);
        expect(side.state.text).toBe("");
    });

    test("fingers scroll the text area: no touch-action of its own", () => {
        const css = readFileSync(
            join(__dirname, "../../../src/card-editor/card-editor.css"),
            "utf8",
        );
        expect(css).not.toMatch(/sr-pen-switch/);
        expect(css).not.toMatch(/sr-card-editor-mode/);
        const rules = css.match(/[^{}]*\.sr-card-editor-text[^{}]*\{[^}]*\}/g) ?? [];
        expect(rules.length).toBeGreaterThan(0);
        rules.forEach((rule) => expect(rule).not.toMatch(/touch-action/));
        expect(textArea(setup(state()).parent).className).toBe("sr-card-editor-text");
    });

    test("focus() focuses the text area", () => {
        const { side, parent } = setup(state({ strokes: [stroke(0)] }));
        side.focus();
        expect(document.activeElement).toBe(textArea(parent));
    });

    test("strokes without their own size keep the side's size when the pen changes", () => {
        const plain: Stroke = { points: stroke(0).points, pressure: true };
        const { side } = setup(state({ strokes: [plain, stroke(30, 2)], penSize: 4 }));
        side.setPenSize(1);
        expect(side.state.strokes.map((s) => s.size)).toEqual([4, 2]);
        expect(side.state.strokes[0].points).toBe(plain.points);
        // Giving them a size is no change of the ink
        expect(side.inkChanged).toBe(false);
    });

    test("the palm pressing on the text area doesn't focus it", () => {
        const { parent } = setup(state(), { isPalm: () => true });
        expect(pointerDown(textArea(parent), "touch").defaultPrevented).toBe(true);
        const finger = setup(state());
        expect(pointerDown(textArea(finger.parent), "touch").defaultPrevented).toBe(false);
    });

    test("pen size changes the thickness of the side", () => {
        const setStyle = jest.spyOn(InkField.prototype, "setStyle");
        const { side } = setup(state({ strokes: [stroke(0)] }));
        side.setPenSize(2);
        expect(side.state.penSize).toBe(2);
        expect(setStyle).toHaveBeenCalledWith({ size: 2 });
        setStyle.mockClear();
        side.setPenSize(2);
        expect(setStyle).not.toHaveBeenCalled();
        setStyle.mockRestore();
    });
});

describe("SideEditor content", () => {
    test("text and strokes are kept side by side", () => {
        const strokes = [stroke(0)];
        const { side, parent, onChange } = setup(state({ strokes }));
        type(parent, "typed");
        expect(side.state).toEqual({ text: "typed", strokes, penSize: 5 });
        side.setStrokes([...strokes, stroke(20)]);
        expect(side.state.text).toBe("typed");
        expect(side.state.strokes).toHaveLength(2);
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    test("setText replaces the text and reports a change", () => {
        const { side, parent, onChange } = setup(state({ text: "a" }));
        side.setText("b");
        expect(textArea(parent).value).toBe("b");
        expect(onChange).toHaveBeenCalledTimes(1);
        side.setText("b");
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test("reset replaces text, strokes and the initial state", () => {
        const { side, parent } = setup(state({ strokes: [stroke(0)], text: "x" }));
        side.setStrokes([stroke(0), stroke(1)]);
        side.reset(state({ penSize: 7 }));
        expect(side.state).toEqual({ text: "", strokes: [], penSize: 7 });
        expect(textArea(parent).value).toBe("");
        expect(inkField(parent).hasClass("is-empty")).toBe(true);
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
        const destroy = jest.spyOn(InkField.prototype, "destroy");
        const { side, parent } = setup(state());
        side.destroy();
        expect(parent.children.length).toBe(0);
        expect(destroy).toHaveBeenCalledTimes(1);
        destroy.mockRestore();
    });
});

describe("SideEditor isEmpty", () => {
    test("blank text and no strokes", () => {
        const { side, parent } = setup(state());
        expect(side.isEmpty).toBe(true);
        type(parent, "  \n ");
        expect(side.isEmpty).toBe(true);
        type(parent, "x");
        expect(side.isEmpty).toBe(false);
    });

    test("strokes alone, or text alone, are content", () => {
        const { side, parent } = setup(state());
        side.setStrokes([stroke(0)]);
        expect(side.isEmpty).toBe(false);
        type(parent, "typed");
        side.setStrokes([]);
        expect(side.isEmpty).toBe(false);
        type(parent, "");
        expect(side.isEmpty).toBe(true);
    });
});

describe("SideEditor clear", () => {
    test("clears text and ink as one step that can be undone", () => {
        const strokes = [stroke(0)];
        const { side, parent, onInkCommit, onChange } = setup(state({ text: "typed", strokes }));
        side.clear();
        expect(side.isEmpty).toBe(true);
        expect(textArea(parent).value).toBe("");
        expect(inkField(parent).hasClass("is-empty")).toBe(true);
        expect(onInkCommit).toHaveBeenCalledTimes(1);
        expect(onInkCommit).toHaveBeenCalledWith(strokes, "typed");
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test("text only or ink only", () => {
        const text = setup(state({ text: "typed" }));
        text.side.clear();
        expect(text.onInkCommit).toHaveBeenCalledWith([], "typed");
        expect(text.side.state.text).toBe("");

        const ink = setup(state({ strokes: [stroke(0)] }));
        ink.side.clear();
        expect(ink.onInkCommit).toHaveBeenCalledWith([stroke(0)], "");
        expect(ink.side.state.strokes).toEqual([]);
    });

    test("an empty side: nothing to undo", () => {
        const { side, onInkCommit, onChange } = setup(state());
        side.clear();
        expect(onInkCommit).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });

    test("cloze: clears the text", () => {
        const { side, onInkCommit } = setup(state({ text: "a ==b==" }), { allowInk: false });
        side.clear();
        expect(side.state.text).toBe("");
        expect(onInkCommit).toHaveBeenCalledWith([], "a ==b==");
    });
});

describe("SideEditor inkChanged", () => {
    test("unchanged strokes, also after typing", () => {
        const { side, parent } = setup(state({ strokes: [stroke(0)] }));
        expect(side.inkChanged).toBe(false);
        type(parent, "typed");
        expect(side.inkChanged).toBe(false);
    });

    test("added, removed or cleared strokes", () => {
        const a = stroke(0);
        const b = stroke(20);
        const { side } = setup(state({ strokes: [a, b] }));
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
        const { side } = setup(state({ strokes: [a, b] }));
        side.setStrokes([a]);
        // e.g. the eraser removed a stroke and undo restored it, as a new array
        side.setStrokes([a, b]);
        expect(side.inkChanged).toBe(false);
    });

    test("a text side that gets strokes", () => {
        const { side } = setup(state({ text: "typed" }));
        expect(side.inkChanged).toBe(false);
        side.setStrokes([stroke(0)]);
        expect(side.inkChanged).toBe(true);
    });
});
