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
        expect(onChange).toHaveBeenCalledWith([s]);
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
});

describe("InkField cancelled stroke", () => {
    test("a stroke the browser cancels keeps what was drawn, and the pen isn't stuck", () => {
        const { field, canvas, onChange } = setup();
        pointer(canvas, "pointerdown", 10, 10);
        pointer(canvas, "pointermove", 30, 10);
        pointer(canvas, "pointercancel", 30, 10);
        expect(field.strokes).toHaveLength(1);
        expect(onChange).toHaveBeenCalledTimes(1);

        // The pointer was let go: the next touch draws normally
        draw(canvas, [
            [0, 0],
            [20, 0],
        ]);
        expect(field.strokes).toHaveLength(2);
        expect(onChange).toHaveBeenCalledTimes(2);
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

    test("a stroke ends at the edge; coming back while down starts a new one, one undo step", () => {
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
        expect(onChange).toHaveBeenCalledWith([]);
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

    /** Runs the animation frames requested so far, as the browser does between moves */
    function nextFrame() {
        const callbacks = raf.mock.calls.map(([cb]) => cb as FrameRequestCallback);
        raf.mockClear();
        callbacks.forEach((cb) => cb(0));
    }

    test("the soft keyboard closing mid-stroke splits it, no point keeps the old offset", () => {
        const vv = Object.assign(new EventTarget(), {
            offsetLeft: 0,
            offsetTop: 0,
            width: 400,
            height: 300,
        });
        Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
        try {
            const { field, canvas, move, onChange } = placed(rect(0, 100, 400, 150));
            pointer(canvas, "pointerdown", 10, 110);
            pointer(canvas, "pointermove", 20, 120);
            pointer(canvas, "pointermove", 30, 130);
            // The keyboard closed: the field moved 60 px down and the viewport grew
            move(rect(0, 160, 400, 150));
            vv.height = 600;
            vv.dispatchEvent(new Event("resize"));
            pointer(canvas, "pointermove", 40, 200);
            pointer(canvas, "pointermove", 50, 210);
            pointer(canvas, "pointerup", 50, 210);

            expect(field.strokes.map(xy)).toEqual([
                [
                    [10, 10],
                    [20, 20],
                    [30, 30],
                ],
                [
                    [40, 40],
                    [50, 50],
                ],
            ]);
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith([]);
        } finally {
            delete (window as unknown as { visualViewport?: unknown }).visualViewport;
        }
    });

    test("a shift no event reports is caught once a frame, without a measure per move", () => {
        const { field, canvas, move, onChange } = placed(rect(0, 0, 200, 100));
        const measured = jest.spyOn(canvas, "getBoundingClientRect");
        pointer(canvas, "pointerdown", 10, 10);
        pointer(canvas, "pointermove", 20, 10);
        pointer(canvas, "pointermove", 30, 10);
        // Measured once for the whole gesture so far
        expect(measured).toHaveBeenCalledTimes(1);

        nextFrame();
        move(rect(0, 40, 200, 100));
        pointer(canvas, "pointermove", 40, 50);
        pointer(canvas, "pointermove", 50, 50);
        pointer(canvas, "pointerup", 50, 50);

        expect(field.strokes.map(xy)).toEqual([
            [
                [10, 10],
                [20, 10],
                [30, 10],
            ],
            [
                [40, 10],
                [50, 10],
            ],
        ]);
        expect(onChange).toHaveBeenCalledTimes(1);
        // One more for the frame's check; the new view reuses that rect
        expect(measured).toHaveBeenCalledTimes(2);
    });

    test("the eraser doesn't cut across a shift no event reports", () => {
        const { field, canvas, move, setEraser, onChange } = placed(rect(0, 0, 200, 100));
        const line = {
            points: [[100, 0, 0.5] as Point, [100, 100, 0.5] as Point],
            pressure: false,
        };
        field.setStrokes([line]);
        setEraser(true);
        pointer(canvas, "pointerdown", 50, 20);
        nextFrame();
        // The field moved left by 100 px: the eraser is now at x = 150 on the canvas
        move(rect(-100, 0, 200, 100));
        pointer(canvas, "pointermove", 50, 20);
        pointer(canvas, "pointermove", 40, 20);
        pointer(canvas, "pointerup", 40, 20);
        expect(field.strokes).toEqual([line]);
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe("InkField focus", () => {
    test("the pen writes without taking the focus from a text area", () => {
        const { field, canvas } = setup();
        const textArea = document.body.createEl("textarea");
        textArea.focus();
        const down = pointer(canvas, "pointerdown", 10, 10);
        expect(down.defaultPrevented).toBe(true);
        pointer(canvas, "pointermove", 30, 10);
        pointer(canvas, "pointerup", 30, 10);
        expect(field.strokes).toHaveLength(1);
        expect(document.activeElement).toBe(textArea);
    });

    test("pen-only: a finger draws nothing and leaves the text area focused", () => {
        const { field, canvas, onChange } = setup();
        const textArea = document.body.createEl("textarea");
        textArea.focus();
        const touch = { pointerType: "touch" };
        expect(pointer(canvas, "pointerdown", 10, 10, touch).defaultPrevented).toBe(true);
        pointer(canvas, "pointermove", 50, 10, touch);
        pointer(canvas, "pointerup", 50, 10, touch);
        expect(field.strokes).toEqual([]);
        expect(onChange).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(textArea);

        draw(canvas, [
            [0, 0],
            [20, 0],
        ]);
        expect(field.strokes).toHaveLength(1);
    });
});

describe("InkField eraser size", () => {
    test("the eraser cuts with the radius it is given", () => {
        const line = {
            points: [[0, 50, 0.5] as Point, [200, 50, 0.5] as Point],
            pressure: false,
        };
        for (const [radius, cut] of [
            [5, false],
            [15, true],
        ] as const) {
            const { field, canvas, setEraser } = setup({ eraserRadius: () => radius });
            jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
                new DOMRect(0, 0, 200, 100),
            );
            field.setStrokes([line]);
            setEraser(true);
            // 12 px off the line, with a stroke of width 2
            draw(canvas, [
                [100, 62],
                [101, 62],
            ]);
            expect(field.strokes[0] !== line).toBe(cut);
        }
    });
});
