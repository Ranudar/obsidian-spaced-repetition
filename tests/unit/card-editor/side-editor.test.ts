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
        face: "front",
        inkHint: "Draw on **front**",
        textHint: "Type the **question**",
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

describe("SideEditor", () => {
    test("text and strokes are kept side by side", () => {
        const strokes = [stroke(0)];
        const { side, parent, onChange } = setup(state({ text: "Hello", strokes }));
        expect(textArea(parent).value).toBe("Hello");
        expect(inkField(parent).hasClass("is-empty")).toBe(false);
        type(parent, "typed");
        expect(side.state).toEqual({ text: "typed", strokes, penSize: 5 });
        side.setStrokes([...strokes, stroke(20)]);
        expect(side.state.text).toBe("typed");
        expect(side.state.strokes).toHaveLength(2);
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    test("the side shows as one pen zone and one text zone with their hints", () => {
        const { side, parent } = setup(state());
        expect(side.el.hasClass("is-front")).toBe(true);
        expect(parent.querySelector(".sr-card-editor-ink .sr-ink-field")).not.toBeNull();
        expect(parent.querySelector(".sr-card-editor-text-hint").innerHTML).toBe(
            "Type the <b>question</b>",
        );
        side.show(false);
        expect(side.el.hasClass("sr-is-hidden")).toBe(true);
        side.show(true);
        expect(side.el.hasClass("sr-is-hidden")).toBe(false);
    });

    test("without ink (cloze) there is only the text area", () => {
        const { side, parent } = setup(state({ text: "a ==b==" }), { allowInk: false });
        expect(inkField(parent)).toBeNull();
        side.setStrokes([stroke(0)]);
        expect(side.state.strokes).toEqual([]);
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

    test("the palm pressing on the text area doesn't focus it, a finger does", () => {
        const { parent } = setup(state(), { isPalm: () => true });
        expect(pointerDown(textArea(parent), "touch").defaultPrevented).toBe(true);
        const finger = setup(state());
        expect(pointerDown(textArea(finger.parent), "touch").defaultPrevented).toBe(false);
    });

    test("reset replaces text, strokes and the initial state", () => {
        const { side, parent } = setup(state({ strokes: [stroke(0)], text: "x" }));
        side.setStrokes([stroke(0), stroke(1)]);
        side.reset(state({ penSize: 7 }));
        expect(side.state).toEqual({ text: "", strokes: [], penSize: 7 });
        expect(textArea(parent).value).toBe("");
        expect(side.inkChanged).toBe(false);
    });

    test("isEmpty: blank text and no strokes", () => {
        const { side, parent } = setup(state());
        type(parent, "  \n ");
        expect(side.isEmpty).toBe(true);
        side.setStrokes([stroke(0)]);
        expect(side.isEmpty).toBe(false);
        type(parent, "typed");
        side.setStrokes([]);
        expect(side.isEmpty).toBe(false);
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

    test("an empty side: nothing to undo", () => {
        const { side, onInkCommit, onChange } = setup(state());
        side.clear();
        expect(onInkCommit).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe("SideEditor inkChanged", () => {
    test("typing is no ink change; added or removed strokes are", () => {
        const a = stroke(0);
        const b = stroke(20);
        const { side, parent } = setup(state({ strokes: [a, b] }));
        type(parent, "typed");
        expect(side.inkChanged).toBe(false);
        side.setStrokes([a, b, stroke(40)]);
        expect(side.inkChanged).toBe(true);
        side.setStrokes([a]);
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
});
