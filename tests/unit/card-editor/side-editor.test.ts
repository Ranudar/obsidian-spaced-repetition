import { readFileSync } from "fs";
import * as obsidian from "obsidian";
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
const switchButton = (parent: HTMLElement, index: number) =>
    parent.querySelectorAll<HTMLButtonElement>(".sr-card-editor-mode-button")[index];
/** Whether the text and the pen button show the draft dot */
const dots = (parent: HTMLElement) =>
    [0, 1].map((i) => switchButton(parent, i).hasClass("has-draft"));

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

    test("the switch is a labelled Text | Pen control with icons", () => {
        const setIcon = jest.mocked(obsidian.setIcon);
        setIcon.mockClear();
        const { parent } = setup(state());
        expect(parent.querySelector(".sr-card-editor-mode-switch").getAttribute("role")).toBe(
            "group",
        );
        expect(switchButton(parent, 0).textContent).toBe("Text");
        expect(switchButton(parent, 1).textContent).toBe("Pen");
        expect(switchButton(parent, 0).getAttribute("aria-pressed")).toBe("true");
        expect(switchButton(parent, 1).getAttribute("aria-pressed")).toBe("false");
        expect(setIcon.mock.calls.map((call) => call[1])).toEqual(["keyboard", "pen-line"]);
    });

    test("a pen touching the text area doesn't switch to ink", () => {
        const { side, parent } = setup(state({ text: "typed" }));
        const evt = pointerDown(textArea(parent), "pen");
        expect(side.mode).toBe("text");
        expect(evt.defaultPrevented).toBe(false);
        expect(inkField(parent)).toBeNull();
    });

    test("typing into an ink side doesn't switch to text", () => {
        const { side, parent } = setup(state({ mode: "ink" }));
        const evt = new KeyboardEvent("keydown", { key: "a", cancelable: true });
        inkField(parent).dispatchEvent(evt);
        expect(evt.defaultPrevented).toBe(false);
        expect(side.mode).toBe("ink");
        expect(side.state.text).toBe("");
    });

    test("fingers scroll the text area: no touch-action of its own", () => {
        const css = readFileSync(
            join(__dirname, "../../../src/card-editor/card-editor.css"),
            "utf8",
        );
        expect(css).not.toMatch(/sr-pen-switch/);
        const rules = css.match(/[^{}]*\.sr-card-editor-text[^{}]*\{[^}]*\}/g) ?? [];
        expect(rules.length).toBeGreaterThan(0);
        rules.forEach((rule) => expect(rule).not.toMatch(/touch-action/));
        expect(textArea(setup(state()).parent).className).toBe("sr-card-editor-text");
    });

    test("on mobile, switching modes never focuses the text area", () => {
        const isMobile = jest.spyOn(obsidian.Platform, "isMobile", "get").mockReturnValue(true);
        try {
            const { side, parent } = setup(state({ mode: "ink" }));
            switchButton(parent, 0).click();
            expect(side.mode).toBe("text");
            expect(document.activeElement).not.toBe(textArea(parent));

            // A focused text area lets go when the side switches to ink
            textArea(parent).focus();
            switchButton(parent, 1).click();
            expect(side.mode).toBe("ink");
            expect(document.activeElement).toBe(inkField(parent));
            switchButton(parent, 0).click();
            expect(document.activeElement).not.toBe(textArea(parent));
        } finally {
            isMobile.mockRestore();
        }
    });

    test("on desktop, switching to text focuses the text area for typing", () => {
        const { side, parent } = setup(state({ mode: "ink" }));
        switchButton(parent, 0).click();
        expect(side.mode).toBe("text");
        expect(document.activeElement).toBe(textArea(parent));
        switchButton(parent, 1).click();
        expect(document.activeElement).toBe(inkField(parent));
    });

    test("strokes without their own size keep the side's size when the pen changes", () => {
        const plain: Stroke = { points: stroke(0).points, pressure: true };
        const { side } = setup(state({ mode: "ink", strokes: [plain, stroke(30, 2)], penSize: 4 }));
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
        const { side } = setup(state({ mode: "ink", strokes: [stroke(0)] }));
        const setStyle = jest.spyOn(InkField.prototype, "setStyle");
        side.setPenSize(2);
        expect(side.state.penSize).toBe(2);
        expect(setStyle).toHaveBeenCalledWith({ size: 2 });
        setStyle.mockClear();
        side.setPenSize(2);
        expect(setStyle).not.toHaveBeenCalled();

        // Before the ink field exists, it is created with the new size
        const text = setup(state());
        text.side.setPenSize(3);
        text.side.setMode("ink");
        expect(text.side.state.penSize).toBe(3);
        setStyle.mockRestore();
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
    test("ink shown while there is typed text: a dot on the text button", () => {
        const { side, parent } = setup(state());
        type(parent, "typed");
        expect(side.replacesOther).toBe(false);
        expect(dots(parent)).toEqual([false, false]);

        side.setMode("ink");
        expect(side.replacesOther).toBe(true);
        expect(dots(parent)).toEqual([true, false]);
        expect(switchButton(parent, 0).getAttribute("aria-description")).toBe(
            "Saving replaces the text with handwriting",
        );
    });

    test("text shown while there are strokes: a dot on the pen button", () => {
        const { side, parent } = setup(state({ mode: "ink", strokes: [stroke(0)] }));
        expect(side.replacesOther).toBe(false);
        side.setMode("text");
        expect(side.replacesOther).toBe(true);
        expect(dots(parent)).toEqual([false, true]);
        expect(switchButton(parent, 1).getAttribute("aria-description")).toBe(
            "Saving replaces the handwriting with text",
        );
    });

    test("no hint text that would move the layout", () => {
        const { side, parent } = setup(state({ mode: "ink", strokes: [stroke(0)] }));
        const before = side.el.children.length;
        side.setMode("text");
        expect(side.el.children.length).toBe(before);
        expect(parent.querySelector(".sr-card-editor-hint")).toBeNull();
    });

    test("the dot goes away once the other draft is empty", () => {
        const { side, parent } = setup(state({ mode: "ink", strokes: [stroke(0)] }));
        side.setMode("text");
        side.setStrokes([]);
        expect(side.replacesOther).toBe(false);
        expect(dots(parent)).toEqual([false, false]);
        expect(switchButton(parent, 1).hasAttribute("aria-description")).toBe(false);

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
