import {
    eraserRadius,
    eraseStrokes,
    Point,
    Stroke,
    strokeMaxRadius,
    strokeOutline,
    strokeSize,
} from "src/card-editor/core/strokes";

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

describe("eraser radius", () => {
    test("grows with the pen size, with a minimum", () => {
        expect(eraserRadius(1)).toBe(8);
        expect(eraserRadius(2.5)).toBe(8);
        expect(eraserRadius(4)).toBe(12);
    });
});

describe("stroke size", () => {
    test("a stroke's own size wins over the style", () => {
        expect(strokeSize(line([[0, 0, 0.5]]), { size: 3 })).toBe(3);
        expect(strokeSize(line([[0, 0, 0.5]], { size: 1.5 }), { size: 3 })).toBe(1.5);
    });

    test("the outline uses the stroke's own size", () => {
        const pts: Point[] = [
            [0, 0, 0.5],
            [50, 0, 0.5],
        ];
        const height = (s: Stroke) => {
            const ys = strokeOutline(s, { size: 2 }).map((p) => p[1]);
            return Math.max(...ys) - Math.min(...ys);
        };
        expect(height(line(pts, { size: 8 }))).toBeGreaterThan(height(line(pts)) * 2);
    });
});

describe("stroke reach", () => {
    test("the outline never reaches further than strokeMaxRadius from the center line", () => {
        for (const pressure of [true, false]) {
            const pts: Point[] = [];
            for (let x = 0; x <= 100; x += 5) pts.push([x, 0, 1]);
            const s = line(pts, { pressure, size: 10 });
            const reach = Math.max(...strokeOutline(s, { size: 10 }).map((p) => Math.abs(p[1])));
            expect(reach).toBeLessThanOrEqual(strokeMaxRadius(s, { size: 10 }) + 1e-6);
            expect(strokeMaxRadius(s, { size: 10 })).toBeGreaterThan(5);
        }
    });

    test("a pressure stroke at full pressure leaves no sliver inside the eraser", () => {
        // Thick pen 4 at full pressure, eraser radius 12: the center line 14.5 away still shows
        // ink inside the circle (outline reaches 0.8 * 4 = 3.2), so it must be cut
        const s = hline(0, 100, 14.5, 10, { size: 4, pressure: true });
        expect(eraseStrokes([s], [50, 0], [50, 0], 12, 4)).not.toEqual([s]);
    });
});

describe("pixel eraser", () => {
    test("nothing near: the same array and strokes come back", () => {
        const a = hline(0, 100);
        const b = hline(0, 100, 50);
        const strokes = [a, b];
        expect(eraseStrokes(strokes, [0, 200], [100, 200], 8, 2)).toBe(strokes);
        // Within the bounding box but not within reach of a segment
        const diag = line([
            [0, 0, 0.5],
            [100, 100, 0.5],
        ]);
        expect(eraseStrokes([diag], [90, 10], [90, 10], 8, 2)).toEqual([diag]);
    });

    test("a tap in the middle cuts a stroke in two", () => {
        const s = hline(0, 100, 0, 10, { size: 2, pressure: true });
        const result = eraseStrokes([s], [50, 0], [50, 0], 8, 4);
        expect(result).toHaveLength(2);
        const [left, right] = result;
        // The covered reach is radius + the widest the pressure outline gets: 8 + 0.8 * 2 = 9.6
        expect(Math.max(...xs(left))).toBeLessThan(41);
        expect(Math.max(...xs(left))).toBeGreaterThan(38);
        expect(Math.min(...xs(right))).toBeGreaterThan(59);
        expect(Math.min(...xs(right))).toBeLessThan(62);
        expect(xs(left)[0]).toBe(0);
        expect(xs(right)[right.points.length - 1]).toBe(100);
        for (const piece of result) {
            expect(piece.pressure).toBe(true);
            expect(piece.size).toBe(2);
        }
    });

    test("long segments are resampled so the cut is precise", () => {
        const s = line([
            [0, 0, 0.2],
            [200, 0, 0.8],
        ]);
        const [left, right] = eraseStrokes([s], [100, 0], [100, 0], 8, 2);
        // Reach 8 + 0.75 * 2 = 9.5; resampled every 9.5/4 pixels at most
        const reach = 9.5;
        expect(Math.max(...xs(left))).toBeGreaterThan(100 - reach - reach / 4 - 0.01);
        expect(Math.max(...xs(left))).toBeLessThan(100 - reach);
        expect(Math.min(...xs(right))).toBeLessThan(100 + reach + reach / 4 + 0.01);
        expect(Math.min(...xs(right))).toBeGreaterThan(100 + reach);
        // Pressure is interpolated along the segment
        const last = left.points[left.points.length - 1];
        expect(last[2]).toBeCloseTo(0.2 + 0.6 * (last[0] / 200), 5);
        // Untouched ends keep their original points
        expect(left.points[0]).toBe(s.points[0]);
        expect(right.points[right.points.length - 1]).toBe(s.points[1]);
    });

    test("a swipe across erases the whole stretch it covered", () => {
        const s = hline(0, 300);
        // Moves from (100, -50) to (100, 50) cross the line; then a drag along it
        const crossed = eraseStrokes([s], [100, -50], [100, 50], 8, 2);
        expect(crossed).toHaveLength(2);
        const along = eraseStrokes([s], [100, 0], [200, 0], 8, 2);
        expect(along).toHaveLength(2);
        expect(Math.max(...xs(along[0]))).toBeLessThan(91);
        expect(Math.min(...xs(along[1]))).toBeGreaterThan(209);
    });

    test("a fast swipe crossing a segment between its points still cuts it", () => {
        const s = line([
            [0, 0, 0.5],
            [200, 0, 0.5],
        ]);
        // Both eraser positions are far from the line, the path between them crosses it
        const result = eraseStrokes([s], [100, -100], [100, 100], 8, 2);
        expect(result).toHaveLength(2);
    });

    test("erasing the end of a stroke shortens it, all of it removes it", () => {
        const s = hline(0, 100);
        const [rest] = eraseStrokes([s], [100, 0], [100, 0], 8, 2);
        expect(Math.max(...xs(rest))).toBeLessThan(91);
        expect(xs(rest)[0]).toBe(0);
        expect(eraseStrokes([s], [-20, 0], [120, 0], 8, 2)).toEqual([]);
    });

    test("remnants too short to see are dropped", () => {
        // A short stroke whose middle is erased leaves two crumbs of less than half the size
        const s = hline(0, 20, 0, 1, { size: 4 });
        expect(eraseStrokes([s], [10, 0], [10, 0], 8, 2)).toEqual([]);
    });

    test("dots: erased when touched, kept otherwise", () => {
        const dot = line([[10, 10, 0.5]]);
        expect(eraseStrokes([dot], [10, 25], [10, 25], 8, 2)).toEqual([dot]);
        expect(eraseStrokes([dot], [10, 18], [10, 18], 8, 2)).toEqual([]);
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
    });

    test("thicker strokes are reached from further away", () => {
        const thin = hline(0, 100, 0, 10, { size: 1 });
        const thick = hline(0, 100, 0, 10, { size: 10 });
        // 11 away: beyond 8 + 0.5, within 8 + 5
        expect(eraseStrokes([thin], [50, 11], [50, 11], 8, 2)).toEqual([thin]);
        expect(eraseStrokes([thick], [50, 11], [50, 11], 8, 2)).toHaveLength(2);
        // Without its own size, the default size counts
        const plain = hline(0, 100);
        expect(eraseStrokes([plain], [50, 11], [50, 11], 8, 10)).toHaveLength(2);
    });

    test("pieces without their own size don't get one", () => {
        const [piece] = eraseStrokes([hline(0, 100)], [100, 0], [100, 0], 8, 2);
        expect("size" in piece).toBe(false);
    });
});
