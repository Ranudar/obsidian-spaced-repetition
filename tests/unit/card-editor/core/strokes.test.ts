import { clipSegment, eraseStrokes, Point, Stroke } from "src/card-editor/core/strokes";

const line = (points: Point[], extra: Partial<Stroke> = {}): Stroke => ({
    points,
    pressure: false,
    ...extra,
});

/** A horizontal line from x0 to x1 at height y with points every `step` pixels */
function hline(x0: number, x1: number, y = 0, step = 10, extra: Partial<Stroke> = {}): Stroke {
    const pts: Point[] = [];
    for (let x = x0; x <= x1; x += step) pts.push([x, y, 0.5]);
    return line(pts, extra);
}

const xs = (s: Stroke) => s.points.map((p) => p[0]);

describe("pixel eraser", () => {
    test("a tap in the middle cuts a stroke in two", () => {
        const s = hline(0, 100, 0, 10, { size: 2, pressure: true });
        const result = eraseStrokes([s], [50, 0], [50, 0], 8, 4);
        expect(result).toHaveLength(2);
        const [left, right] = result;
        expect(Math.max(...xs(left))).toBeLessThan(41);
        expect(Math.min(...xs(right))).toBeGreaterThan(59);
        expect(xs(left)[0]).toBe(0);
        expect(xs(right)[right.points.length - 1]).toBe(100);
        for (const piece of result) {
            expect(piece.pressure).toBe(true);
            expect(piece.size).toBe(2);
        }
    });

    test("a swipe erases the whole stretch it covered, also between far apart points", () => {
        const along = eraseStrokes([hline(0, 300)], [100, 0], [200, 0], 8, 2);
        expect(along).toHaveLength(2);
        expect(Math.max(...xs(along[0]))).toBeLessThan(91);
        expect(Math.min(...xs(along[1]))).toBeGreaterThan(209);
        // Both eraser positions are far from the line, the path between them crosses it
        const s = line([
            [0, 0, 0.5],
            [200, 0, 0.5],
        ]);
        expect(eraseStrokes([s], [100, -100], [100, 100], 8, 2)).toHaveLength(2);
    });

    test("erasing the end of a stroke shortens it, all of it removes it", () => {
        const s = hline(0, 100);
        const [rest] = eraseStrokes([s], [100, 0], [100, 0], 8, 2);
        expect(Math.max(...xs(rest))).toBeLessThan(91);
        expect(xs(rest)[0]).toBe(0);
        expect(eraseStrokes([s], [-20, 0], [120, 0], 8, 2)).toEqual([]);
    });

    test("only the touched strokes change, the others keep their identity and order", () => {
        const a = hline(0, 100, 0);
        const b = hline(0, 100, 100);
        const c = hline(0, 100, 200);
        const result = eraseStrokes([a, b, c], [50, 100], [50, 100], 8, 2);
        expect(result).toHaveLength(4);
        expect(result[0]).toBe(a);
        expect(result[3]).toBe(c);
        expect(result[1].points[0][1]).toBe(100);
        expect(result[2].points[0][1]).toBe(100);
        // Nothing near: the same array comes back
        const strokes = [a, c];
        expect(eraseStrokes(strokes, [50, 100], [50, 100], 8, 2)).toBe(strokes);
    });
});

describe("clipping to the visible area", () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

    test("a segment is cut at the box edges, the pressure interpolated", () => {
        const a: Point = [10, 10, 0.5];
        const b: Point = [90, 40, 0.5];
        const [from, to] = clipSegment(a, b, box);
        expect(from).toBe(a);
        expect(to).toBe(b);
        expect(clipSegment([50, 25, 0.2], [150, 25, 0.6], box)[1]).toEqual([100, 25, 0.4]);
        expect(clipSegment([-10, 25, 0.5], [110, 25, 0.5], box)).toEqual([
            [0, 25, 0.5],
            [100, 25, 0.5],
        ]);
    });

    test("a segment that misses the box gives nothing", () => {
        expect(clipSegment([-10, -10, 0.5], [-10, 60, 0.5], box)).toBeNull();
        expect(clipSegment([90, -40, 0.5], [140, 20, 0.5], box)).toBeNull();
    });
});
