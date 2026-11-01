import {
    inkFileName,
    parseInkFileName,
    strokesToSvg,
    svgToStrokes,
} from "src/card-editor/core/ink-svg";
import { Point, Stroke } from "src/card-editor/core/strokes";

const line = (points: Point[], pressure = false): Stroke => ({ points, pressure });

describe("ink SVG", () => {
    test("SVG round trip keeps strokes and their own thickness", () => {
        const strokes = [
            line(
                [
                    [10, 20, 0.4],
                    [30.25, 40, 0.8],
                ],
                true,
            ),
            { ...line([[5, 5, 0.5]]), size: 1.5 },
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
                size: 6,
            },
            { pressure: false, points: [[5, 5, 0.5]], size: 1.5 },
        ]);
        expect(strokesToSvg([], { size: 5 })).toBeNull();
    });

    test("other or malformed SVGs are not ink", () => {
        const meta = (json: string) => `<svg><metadata id="sr-ink">${json}</metadata></svg>`;
        expect(svgToStrokes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBeNull();
        for (const json of [
            "{broken",
            '{"v":2,"strokes":[]}',
            '{"v":1,"size":5,"strokes":[{"p":1,"pts":[[1,2]]}]}',
            '{"v":1,"size":0,"strokes":[{"p":1,"pts":[[1,2,0.5]]}]}',
        ]) {
            expect(svgToStrokes(meta(json))).toBeNull();
        }
    });
});

describe("ink file names", () => {
    test("file name and stem", () => {
        expect(inkFileName("20261031-141502123", "back")).toEqual(
            "sr-ink-20261031-141502123-back.svg",
        );
        expect(parseInkFileName("sr-ink-20261031-141502123-front.svg")).toEqual({
            stem: "20261031-141502123",
            side: "front",
        });
        expect(parseInkFileName("sr-ink-x-side.svg")).toBeNull();
    });
});
