import {
    inkFileName,
    parseInkFileName,
    strokesToSvg,
    svgToStrokes,
    timestampName,
} from "src/card-editor/core/ink-svg";
import {
    outlineBounds,
    outlineToPath,
    Point,
    Stroke,
    strokeHit,
    strokePath,
} from "src/card-editor/core/strokes";

const line = (points: Point[], pressure = false): Stroke => ({ points, pressure });

describe("strokes", () => {
    test("Eraser hit test on a line", () => {
        const s = line([
            [0, 0, 0.5],
            [100, 0, 0.5],
        ]);
        expect(strokeHit(s, 50, 10, 14)).toBe(true);
        expect(strokeHit(s, 50, 30, 14)).toBe(false);
        // Beyond the end of the segment, the distance to the end point counts
        expect(strokeHit(s, 110, 0, 14)).toBe(true);
        expect(strokeHit(s, 120, 0, 14)).toBe(false);
    });

    test("Eraser hit test on a dot and on repeated points", () => {
        expect(strokeHit(line([[10, 10, 0.5]]), 15, 15, 8)).toBe(true);
        expect(strokeHit(line([[10, 10, 0.5]]), 20, 20, 8)).toBe(false);
        const repeated = line([
            [10, 10, 0.5],
            [10, 10, 0.5],
        ]);
        expect(strokeHit(repeated, 12, 12, 5)).toBe(true);
    });

    test("Outline to path and bounds", () => {
        expect(outlineToPath([])).toEqual("");
        const path = outlineToPath([
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
        ]);
        expect(path.startsWith("M0.00,0.00 Q10.00,0.00 10.00,5.00 T")).toBe(true);
        expect(path.endsWith("Z")).toBe(true);

        expect(outlineBounds([])).toBeNull();
        expect(
            outlineBounds([
                [
                    [5, 1],
                    [-2, 7],
                ],
                [[3, 9]],
            ]),
        ).toEqual({ minX: -2, minY: 1, maxX: 5, maxY: 9 });
    });

    test("Stroke path for pen and simulated pressure", () => {
        const points: Point[] = [
            [0, 0, 0.3],
            [20, 10, 0.6],
            [40, 0, 0.9],
        ];
        expect(strokePath(line(points, true), { size: 5 })).toMatch(/^M.+Z$/);
        expect(strokePath(line(points, false), { size: 5 })).toMatch(/^M.+Z$/);
    });
});

describe("ink SVG", () => {
    test("SVG is cropped and keeps the real size", () => {
        const strokes = [
            line([
                [100, 100, 0.5],
                [150, 120, 0.5],
                [200, 100, 0.5],
            ]),
        ];
        const r = strokesToSvg(strokes, { size: 5 }, 10);
        expect(r.width).toBeGreaterThan(100);
        expect(r.width).toBeLessThan(130);
        expect(r.height).toBeGreaterThan(20);
        expect(r.height).toBeLessThan(60);
        expect(r.svg).toMatch(
            /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+"/,
        );
        expect(r.svg).toContain('<metadata id="sr-ink">{"v":1');
        expect(r.svg).toContain('<g fill="#1f1f1f" stroke="none"><path d="M');
        expect(strokesToSvg([], { size: 5 })).toBeNull();
    });

    test("SVG round trip keeps strokes", () => {
        const strokes = [
            line(
                [
                    [10, 20, 0.4],
                    [30.25, 40, 0.8],
                ],
                true,
            ),
            line([[5, 5, 0.5]]),
        ];
        const back = svgToStrokes(strokesToSvg(strokes, { size: 6 }).svg);
        expect(back.size).toEqual(6);
        expect(back.strokes).toEqual([
            {
                pressure: true,
                points: [
                    [10, 20, 0.4],
                    [30.3, 40, 0.8],
                ],
            },
            { pressure: false, points: [[5, 5, 0.5]] },
        ]);
    });

    test("Other SVGs have no strokes", () => {
        expect(svgToStrokes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBeNull();
        expect(svgToStrokes('<svg><metadata id="sr-ink">{broken</metadata></svg>')).toBeNull();
        expect(
            svgToStrokes('<svg><metadata id="sr-ink">{"v":2,"strokes":[]}</metadata></svg>'),
        ).toBeNull();
    });

    test("Malformed stroke metadata is not ink", () => {
        const meta = (json: string) => `<svg><metadata id="sr-ink">${json}</metadata></svg>`;
        const ok = '{"p":1,"pts":[[1,2,0.5]]}';
        for (const json of [
            '{"v":1,"size":5,"strokes":[{}]}',
            '{"v":1,"size":5,"strokes":[{"p":1,"pts":null}]}',
            '{"v":1,"size":5,"strokes":[{"p":1,"pts":[]}]}',
            '{"v":1,"size":5,"strokes":[{"p":1,"pts":[[1,2]]}]}',
            '{"v":1,"size":5,"strokes":[{"p":1,"pts":[[1,"2",0.5]]}]}',
            '{"v":1,"size":5,"strokes":[{"p":1,"pts":[[1,2,null]]}]}',
            '{"v":1,"size":5,"strokes":[{"p":"yes","pts":[[1,2,0.5]]}]}',
            `{"v":1,"size":5,"strokes":[${ok},null]}`,
            `{"v":1,"strokes":[${ok}]}`,
            `{"v":1,"size":0,"strokes":[${ok}]}`,
            `{"v":1,"size":-3,"strokes":[${ok}]}`,
            `{"v":1,"size":"5","strokes":[${ok}]}`,
            "null",
            "[1]",
        ]) {
            expect(svgToStrokes(meta(json))).toBeNull();
        }
        expect(svgToStrokes(meta(`{"v":1,"size":5,"strokes":[${ok}]}`))).toEqual({
            size: 5,
            strokes: [{ pressure: true, points: [[1, 2, 0.5]] }],
        });
    });

    test("Metadata is escaped and unescaped", () => {
        const svg =
            '<svg><metadata id="sr-ink">{"v":1,"size":4,"x":"&lt;&amp;&gt;","strokes":[]}</metadata></svg>';
        expect(svgToStrokes(svg)).toEqual({ size: 4, strokes: [] });
    });
});

describe("ink file names", () => {
    test("File name and stem", () => {
        expect(inkFileName("20261031-141502123", "back")).toEqual(
            "sr-ink-20261031-141502123-back.svg",
        );
        expect(parseInkFileName("sr-ink-20261031-141502123-front.svg")).toEqual({
            stem: "20261031-141502123",
            side: "front",
        });
        expect(parseInkFileName("sr-ink-front.svg")).toBeNull();
        expect(parseInkFileName("sr-ink-x-side.svg")).toBeNull();
        expect(parseInkFileName("sr-ink-x-front.png")).toBeNull();
    });

    test("Timestamp name", () => {
        expect(timestampName(new Date(2026, 9, 31, 14, 5, 2, 7))).toEqual("20261031-140502007");
    });
});
