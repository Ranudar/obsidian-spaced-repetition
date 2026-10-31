import "obsidian";

import { Point, Stroke } from "src/card-editor/core/strokes";
import { InkField, InkFieldOptions, visibleBox } from "src/card-editor/ink-field";

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

describe("InkField visible area", () => {
    function rect(left: number, top: number, width: number, height: number): DOMRect {
        return {
            left,
            top,
            width,
            height,
            right: left + width,
            bottom: top + height,
            x: left,
            y: top,
            toJSON: () => ({}),
        };
    }

    /** A field whose canvas is at (left, top) on screen, inside a clipping box */
    function placed(canvasRect: DOMRect, clipRect?: DOMRect) {
        const clipper = document.body.createDiv();
        if (clipRect) {
            clipper.style.overflow = "hidden";
            clipper.getBoundingClientRect = () => clipRect;
        }
        const onChange = jest.fn();
        let eraser = false;
        const field = new InkField(clipper, {
            placeholder: "Write",
            style: { size: 2 },
            guide: "none",
            guideSpacing: 0,
            penOnly: false,
            eraserActive: () => eraser,
            onChange,
        });
        Object.defineProperty(field.el, "offsetParent", { get: () => document.body });
        const canvas = field.el.querySelector("canvas");
        let canvasAt = canvasRect;
        canvas.getBoundingClientRect = () => canvasAt;
        return {
            field,
            canvas,
            onChange,
            setEraser: (on: boolean) => (eraser = on),
            move: (r: DOMRect) => (canvasAt = r),
        };
    }

    const xy = (s: Stroke) => s.points.map(([x, y]) => [x, y]);

    test("a stroke that leaves the field ends at the edge, nothing outside is stored", () => {
        const { field, canvas, onChange } = placed(rect(0, 0, 200, 100));
        draw(canvas, [
            [100, 50],
            [150, 50],
            [250, 50],
            [300, 80],
        ]);
        expect(field.strokes.map(xy)).toEqual([
            [
                [100, 50],
                [150, 50],
                [200, 50],
            ],
        ]);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test("coming back while still down starts a new stroke at the crossing, one undo step", () => {
        const { field, canvas, onChange } = placed(rect(0, 0, 200, 100));
        draw(canvas, [
            [180, 20],
            [220, 60],
            [260, 60],
            [180, 80],
        ]);
        // Left at x = 200 halfway to (220, 60); came back at x = 200 three quarters of the way back
        expect(field.strokes.map(xy)).toEqual([
            [
                [180, 20],
                [200, 40],
            ],
            [
                [200, 75],
                [180, 80],
            ],
        ]);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(field, []);
    });

    test("a move that only passes through the field leaves the part inside", () => {
        const { field, canvas } = placed(rect(0, 0, 200, 100));
        draw(canvas, [
            [100, -50],
            [100, 150],
        ]);
        expect(field.strokes.map(xy)).toEqual([
            [
                [100, 0],
                [100, 100],
            ],
        ]);
    });

    test("a gesture entirely outside adds nothing and is no change", () => {
        const { field, canvas, onChange } = placed(rect(0, 0, 200, 100));
        draw(canvas, [
            [250, 50],
            [300, 50],
        ]);
        expect(field.strokes).toEqual([]);
        expect(onChange).not.toHaveBeenCalled();
        expect(field.el.hasClass("is-empty")).toBe(true);
    });

    test("the part of the canvas an ancestor cuts off takes no ink", () => {
        // The canvas reaches 40 px below its clipping box, as when it overflows the side box
        const { field, canvas } = placed(rect(0, 100, 200, 100), rect(0, 0, 200, 160));
        draw(canvas, [
            [50, 120],
            [50, 180],
        ]);
        // Canvas coordinates: the box ends 60 px into the canvas
        expect(field.strokes.map(xy)).toEqual([
            [
                [50, 20],
                [50, 60],
            ],
        ]);
    });

    test("the part under the soft keyboard (outside the visual viewport) takes no ink", () => {
        const vv = Object.assign(new EventTarget(), {
            offsetLeft: 0,
            offsetTop: 0,
            width: 400,
            height: 300,
        });
        Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
        try {
            const { field, canvas } = placed(rect(0, 200, 400, 200));
            draw(canvas, [
                [50, 250],
                [50, 350],
            ]);
            expect(field.strokes.map(xy)).toEqual([
                [
                    [50, 50],
                    [50, 100],
                ],
            ]);
        } finally {
            delete (window as unknown as { visualViewport?: unknown }).visualViewport;
        }
    });

    test("visibleBox: ancestors without layout, body and the window", () => {
        const host = document.body.createDiv();
        host.style.overflow = "hidden";
        const el = host.createDiv();
        // The host has no layout (jsdom): skipped; the window cuts the right side
        expect(visibleBox(el, rect(1000, 10, 100, 50), window)).toEqual({
            minX: 1000,
            minY: 10,
            maxX: window.innerWidth,
            maxY: 60,
        });
        expect(visibleBox(el, rect(0, 0, 0, 0), window)).toBeNull();
    });

    test("a scroll mid-stroke measures the field again and starts a new stroke", () => {
        const { field, canvas, move, onChange } = placed(rect(0, 0, 200, 100));
        pointer(canvas, "pointerdown", 10, 10);
        pointer(canvas, "pointermove", 30, 10);
        // The modal scrolled the field up by 30 px (e.g. the soft keyboard closed)
        move(rect(0, -30, 200, 100));
        document.dispatchEvent(new Event("scroll"));
        pointer(canvas, "pointermove", 50, 10);
        pointer(canvas, "pointermove", 70, 10);
        pointer(canvas, "pointerup", 70, 10);
        // No line joins (30, 10) to (50, 40): the halves are separate strokes, one undo step
        expect(field.strokes.map(xy)).toEqual([
            [
                [10, 10],
                [30, 10],
            ],
            [
                [50, 40],
                [70, 40],
            ],
        ]);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test("a scroll without a move of the field keeps the stroke whole", () => {
        const { field, canvas } = placed(rect(0, 0, 200, 100));
        pointer(canvas, "pointerdown", 10, 10);
        document.dispatchEvent(new Event("scroll"));
        pointer(canvas, "pointermove", 50, 10);
        pointer(canvas, "pointerup", 50, 10);
        expect(field.strokes.map(xy)).toEqual([
            [
                [10, 10],
                [50, 10],
            ],
        ]);
    });

    test("a scroll mid-erase doesn't erase along the jump", () => {
        const { field, canvas, move, setEraser } = placed(rect(0, 0, 200, 100));
        const line = {
            points: [[100, 0, 0.5] as Point, [100, 100, 0.5] as Point],
            pressure: false,
        };
        field.setStrokes([line]);
        setEraser(true);
        pointer(canvas, "pointerdown", 50, 20);
        // The field moved left by 100 px: the eraser is now at x = 150 on the canvas
        move(rect(-100, 0, 200, 100));
        document.dispatchEvent(new Event("scroll"));
        pointer(canvas, "pointermove", 50, 20);
        pointer(canvas, "pointerup", 50, 20);
        expect(field.strokes).toEqual([line]);
    });

    test("the eraser erases only inside and its circle hides outside", () => {
        const { field, canvas, setEraser } = placed(rect(0, 0, 200, 100));
        const cursor = field.el.querySelector<HTMLElement>(".sr-ink-eraser-cursor");
        // A line just outside the right edge, as left by an older version
        const outside = hline(230, 300, 50);
        field.setStrokes([outside]);
        setEraser(true);
        pointer(canvas, "pointermove", 150, 50, { buttons: 0 });
        expect(cursor.hasClass("is-visible")).toBe(true);
        pointer(canvas, "pointermove", 260, 50, { buttons: 0 });
        expect(cursor.hasClass("is-visible")).toBe(false);

        draw(canvas, [
            [260, 50],
            [290, 50],
        ]);
        expect(field.strokes).toEqual([outside]);
        expect(cursor.hasClass("is-visible")).toBe(false);
    });
});
