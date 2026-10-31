import "obsidian";

import { Point, Stroke } from "src/card-editor/core/strokes";
import { InkField, InkFieldOptions } from "src/card-editor/ink-field";

/** Records what the field draws; jsdom has no canvas */
const ctx = {
    setTransform: jest.fn(),
    clearRect: jest.fn(),
    fill: jest.fn(),
    fillStyle: "",
};

const path2d = jest.fn();
let raf: jest.SpyInstance;

beforeAll(() => {
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        () => ctx as unknown as CanvasRenderingContext2D,
    );
    (globalThis as unknown as { Path2D: unknown }).Path2D = path2d;
    raf = jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
});

afterAll(() => {
    jest.restoreAllMocks();
});

beforeEach(() => {
    jest.clearAllMocks();
    document.body.replaceChildren();
});

function setup(o: Partial<InkFieldOptions> = {}) {
    const onChange = jest.fn();
    let eraser = false;
    const field = new InkField(document.body, {
        placeholder: "Write",
        style: { size: 2 },
        guide: "none",
        guideSpacing: 0,
        penOnly: false,
        eraserActive: () => eraser,
        onChange,
        ...o,
    });
    // jsdom does no layout: pretend the field is shown so it draws
    Object.defineProperty(field.el, "offsetParent", { get: () => document.body });
    const canvas = field.el.querySelector("canvas");
    return {
        field,
        canvas,
        onChange,
        setEraser: (on: boolean) => (eraser = on),
    };
}

function pointer(
    target: HTMLElement,
    type: string,
    x: number,
    y: number,
    o: { buttons?: number; pointerType?: string } = {},
) {
    const evt = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        buttons: o.buttons ?? 1,
    });
    Object.assign(evt, { pointerType: o.pointerType ?? "pen", pointerId: 1, pressure: 0.5 });
    target.dispatchEvent(evt);
    return evt;
}

function draw(canvas: HTMLElement, points: [number, number][]) {
    const [first, ...rest] = points;
    pointer(canvas, "pointerdown", ...first);
    for (const p of rest) pointer(canvas, "pointermove", ...p);
    pointer(canvas, "pointerup", ...points[points.length - 1]);
}

function hline(x0: number, x1: number, y: number): Stroke {
    const points: Point[] = [];
    for (let x = x0; x <= x1; x += 10) points.push([x, y, 0.5]);
    return { points, pressure: false };
}

describe("InkField pen size", () => {
    test("new strokes are written with the current size, old ones keep theirs", () => {
        const { field, canvas } = setup();
        draw(canvas, [
            [0, 0],
            [50, 0],
        ]);
        field.setStyle({ size: 4 });
        draw(canvas, [
            [0, 50],
            [50, 50],
        ]);
        expect(field.strokes.map((s) => s.size)).toEqual([2, 4]);
    });

    test("only strokes whose size changes get a new path", () => {
        const { field } = setup();
        const own: Stroke = { ...hline(0, 50, 0), size: 3 };
        const plain = hline(0, 50, 50);
        field.setStrokes([own, plain]);
        field.redraw();
        expect(path2d).toHaveBeenCalledTimes(2);

        field.redraw();
        expect(path2d).toHaveBeenCalledTimes(2);

        field.setStyle({ size: 5 });
        field.redraw();
        // The stroke without its own size follows the style
        expect(path2d).toHaveBeenCalledTimes(3);
    });
});

describe("InkField pixel eraser", () => {
    test("the pen's side button erases only the ink under it, as one change", () => {
        const { field, canvas, onChange } = setup();
        const s = hline(0, 200, 0);
        field.setStrokes([s]);

        pointer(canvas, "pointerdown", 100, -40, { buttons: 2 });
        pointer(canvas, "pointermove", 100, 0, { buttons: 2 });
        pointer(canvas, "pointermove", 100, 40, { buttons: 2 });
        expect(field.strokes).toHaveLength(2);
        expect(onChange).not.toHaveBeenCalled();
        pointer(canvas, "pointerup", 100, 40, { buttons: 0 });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(field, [s]);
        const [left, right] = field.strokes;
        expect(left.points[0][0]).toBe(0);
        expect(right.points[right.points.length - 1][0]).toBe(200);
    });

    test("the eraser toggle erases with the pen tip, the radius grows with the pen size", () => {
        const { field, canvas, onChange, setEraser } = setup();
        setEraser(true);
        const s = hline(0, 200, 0);
        field.setStrokes([s]);
        // Size 2: radius 8 + 1, 10 away misses
        draw(canvas, [
            [100, 10],
            [110, 10],
        ]);
        expect(field.strokes).toEqual([s]);
        expect(onChange).not.toHaveBeenCalled();

        field.setStyle({ size: 4 });
        // Size 4: radius 12, plus half the size of the line (it has none of its own: 4)
        draw(canvas, [
            [100, 10],
            [110, 10],
        ]);
        expect(field.strokes).toHaveLength(2);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test("erased strokes keep the paths of the untouched ones", () => {
        const { field, canvas, setEraser } = setup();
        field.setStrokes([hline(0, 100, 0), hline(0, 100, 100)]);
        field.redraw();
        expect(path2d).toHaveBeenCalledTimes(2);
        setEraser(true);
        draw(canvas, [[50, 100]]);
        field.redraw();
        // Two new pieces of the second line; the first line is reused
        expect(path2d).toHaveBeenCalledTimes(4);
    });

    test("an interrupted erase keeps what was erased", () => {
        const { field, canvas, onChange, setEraser } = setup();
        setEraser(true);
        field.setStrokes([hline(0, 100, 0)]);
        pointer(canvas, "pointerdown", 50, 0);
        pointer(canvas, "pointercancel", 50, 0);
        expect(field.strokes).toHaveLength(2);
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe("InkField eraser cursor", () => {
    const cursorOf = (field: InkField) =>
        field.el.querySelector<HTMLElement>(".sr-ink-eraser-cursor");
    const shown = (field: InkField) => cursorOf(field).hasClass("is-visible");
    const at = (field: InkField) => {
        const style = cursorOf(field).style;
        return [
            style.getPropertyValue("--sr-ink-eraser-x"),
            style.getPropertyValue("--sr-ink-eraser-y"),
            style.getPropertyValue("--sr-ink-eraser-size"),
        ];
    };

    test("a circle follows the eraser while erasing and goes away after", () => {
        const { field, canvas } = setup({ style: { size: 4 } });
        // Size 4: radius 12
        pointer(canvas, "pointerdown", 30, 40, { buttons: 2 });
        expect(shown(field)).toBe(true);
        expect(at(field)).toEqual(["18px", "28px", "24px"]);

        pointer(canvas, "pointermove", 60, 40, { buttons: 2 });
        expect(at(field)).toEqual(["48px", "28px", "24px"]);

        pointer(canvas, "pointerup", 60, 40, { buttons: 0 });
        expect(shown(field)).toBe(false);
    });

    test("a hovering pen shows the circle in eraser mode only", () => {
        const { field, canvas, setEraser } = setup();
        pointer(canvas, "pointermove", 10, 10, { buttons: 0 });
        expect(shown(field)).toBe(false);

        // Side button held while hovering
        pointer(canvas, "pointermove", 10, 10, { buttons: 2 });
        expect(shown(field)).toBe(true);

        pointer(canvas, "pointerleave", 10, 10, { buttons: 0 });
        expect(shown(field)).toBe(false);

        setEraser(true);
        pointer(canvas, "pointermove", 20, 20, { buttons: 0 });
        expect(shown(field)).toBe(true);
        setEraser(false);
        pointer(canvas, "pointermove", 20, 20, { buttons: 0 });
        expect(shown(field)).toBe(false);
    });

    test("hovering and erasing nothing don't repaint the strokes", () => {
        const { field, canvas, setEraser } = setup();
        field.setStrokes([hline(0, 100, 0)]);
        raf.mockClear();
        setEraser(true);
        for (let x = 0; x < 100; x += 10) pointer(canvas, "pointermove", x, 80, { buttons: 0 });
        pointer(canvas, "pointerdown", 50, 80);
        raf.mockClear();
        pointer(canvas, "pointermove", 60, 80);
        expect(raf).not.toHaveBeenCalled();
        // The canvas position is read once per hover / gesture, not on every move
        const rect = jest.spyOn(canvas, "getBoundingClientRect");
        pointer(canvas, "pointermove", 70, 80);
        pointer(canvas, "pointermove", 80, 80);
        expect(rect).not.toHaveBeenCalled();
    });

    test("no circle while writing, and fingers don't hover", () => {
        const { field, canvas, setEraser } = setup();
        setEraser(true);
        pointer(canvas, "pointermove", 10, 10, { pointerType: "touch", buttons: 0 });
        expect(shown(field)).toBe(false);
        setEraser(false);
        draw(canvas, [
            [0, 0],
            [20, 0],
        ]);
        expect(shown(field)).toBe(false);
    });
});

describe("InkField cancelled stroke", () => {
    test("a pen touch the browser cancels leaves no stroke and no stuck pen", () => {
        const { field, canvas, onChange } = setup();
        pointer(canvas, "pointerdown", 10, 10);
        pointer(canvas, "pointermove", 30, 10);
        expect(field.el.hasClass("is-empty")).toBe(false);
        pointer(canvas, "pointercancel", 30, 10);
        expect(field.strokes).toEqual([]);
        expect(onChange).not.toHaveBeenCalled();
        expect(field.el.hasClass("is-empty")).toBe(true);

        // The pointer was let go: the next touch draws normally
        draw(canvas, [
            [0, 0],
            [20, 0],
        ]);
        expect(field.strokes).toHaveLength(1);
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
