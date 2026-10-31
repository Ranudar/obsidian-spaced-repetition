import { INK_FILE_PREFIX } from "src/card-editor/core/card-text";
import {
    outlineBounds,
    outlineToPath,
    Stroke,
    strokeOutline,
    StrokeStyle,
} from "src/card-editor/core/strokes";

/** Ink is always stored dark; the plugin's CSS inverts it in dark themes. */
export const INK_COLOR = "#1f1f1f";

export interface SvgResult {
    svg: string;
    width: number;
    height: number;
}

/**
 * Renders strokes to a standalone SVG, cropped to the ink plus padding.
 * The SVG keeps the on-screen pixel size (no scaling), so small writing stays small on the card.
 * The raw strokes are stored in <metadata> so a card can be re-edited later.
 */
export function strokesToSvg(
    strokes: Stroke[],
    style: StrokeStyle,
    padding = 12,
): SvgResult | null {
    if (strokes.length === 0) return null;
    const outlines = strokes.map((s) => strokeOutline(s, style));
    const box = outlineBounds(outlines);
    if (!box) return null;

    const ox = box.minX - padding;
    const oy = box.minY - padding;
    const width = Math.ceil(box.maxX - box.minX + 2 * padding);
    const height = Math.ceil(box.maxY - box.minY + 2 * padding);

    const paths = outlines
        .map(outlineToPath)
        .filter((d) => d.length > 0)
        .map((d) => `<path d="${d}"/>`)
        .join("");

    const meta = escapeXml(
        JSON.stringify({
            v: 1,
            size: style.size,
            offset: [round(ox), round(oy)],
            strokes: strokes.map((s) => ({
                p: s.pressure ? 1 : 0,
                pts: s.points.map(([x, y, pr]) => [round(x), round(y), Math.round(pr * 100) / 100]),
            })),
        }),
    );

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${f(ox)} ${f(oy)} ${width} ${height}">` +
        `<metadata id="sr-ink">${meta}</metadata>` +
        `<g fill="${INK_COLOR}" stroke="none">${paths}</g>` +
        "</svg>\n";

    return { svg, width, height };
}

const round = (n: number) => Math.round(n * 10) / 10;
const f = (n: number) => round(n).toString();

function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface ParsedInk {
    strokes: Stroke[];
    size: number;
}

/** Reads the pen strokes stored in an ink SVG; null for any other image. */
export function svgToStrokes(svg: string): ParsedInk | null {
    const m = svg.match(/<metadata id="sr-ink">([\s\S]*?)<\/metadata>/);
    if (!m) return null;
    try {
        const raw = m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
        const data = JSON.parse(raw) as {
            v: number;
            size: number;
            strokes: { p: number; pts: [number, number, number][] }[];
        };
        if (data.v !== 1 || !Array.isArray(data.strokes)) return null;
        return {
            size: data.size,
            strokes: data.strokes.map((s) => ({ pressure: s.p === 1, points: s.pts })),
        };
    } catch {
        return null;
    }
}

export type InkSide = "front" | "back";

const INK_FILE_NAME_REGEX = new RegExp(`^${INK_FILE_PREFIX}(.+)-(front|back)\\.svg$`);

/** File name of the ink image of one side, e.g. "sr-ink-20261031-141502123-back.svg". */
export function inkFileName(stem: string, side: InkSide): string {
    return `${INK_FILE_PREFIX}${stem}-${side}.svg`;
}

/** Inverse of inkFileName; null for file names that don't follow the scheme. */
export function parseInkFileName(name: string): { stem: string; side: InkSide } | null {
    const m = name.match(INK_FILE_NAME_REGEX);
    if (!m) return null;
    return { stem: m[1], side: m[2] as InkSide };
}

/** Stem for new ink files, e.g. "20261031-141502123" (local time, to the millisecond). */
export function timestampName(date: Date): string {
    const p = (n: number, w = 2) => n.toString().padStart(w, "0");
    return (
        `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
        `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}${p(date.getMilliseconds(), 3)}`
    );
}
