import { getStroke } from "perfect-freehand";

/** One input sample: x, y in CSS pixels relative to the field, pressure 0..1 */
export type Point = [number, number, number];

export interface Stroke {
    points: Point[];
    /** true when the pressure values came from a real pen */
    pressure: boolean;
}

export interface StrokeStyle {
    size: number;
}

export function strokeOutline(stroke: Stroke, style: StrokeStyle): number[][] {
    return getStroke(stroke.points, {
        size: style.size,
        thinning: stroke.pressure ? 0.6 : 0.5,
        smoothing: 0.5,
        streamline: 0.4,
        simulatePressure: !stroke.pressure,
        last: true,
    });
}

const avg = (a: number, b: number) => (a + b) / 2;
const f = (n: number) => n.toFixed(2);

/** Converts a perfect-freehand outline polygon to a closed SVG path (from the library's README). */
export function outlineToPath(points: number[][]): string {
    const len = points.length;
    if (len < 4) return "";
    let a = points[0];
    let b = points[1];
    const c = points[2];
    let d = `M${f(a[0])},${f(a[1])} Q${f(b[0])},${f(b[1])} ${f(avg(b[0], c[0]))},${f(avg(b[1], c[1]))} T`;
    for (let i = 2, max = len - 1; i < max; i++) {
        a = points[i];
        b = points[i + 1];
        d += `${f(avg(a[0], b[0]))},${f(avg(a[1], b[1]))} `;
    }
    return d + "Z";
}

export function strokePath(stroke: Stroke, style: StrokeStyle): string {
    return outlineToPath(strokeOutline(stroke, style));
}

export interface Box {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export function outlineBounds(outlines: number[][][]): Box | null {
    let box: Box | null = null;
    for (const outline of outlines) {
        for (const [x, y] of outline) {
            if (!box) box = { minX: x, minY: y, maxX: x, maxY: y };
            else {
                box.minX = Math.min(box.minX, x);
                box.minY = Math.min(box.minY, y);
                box.maxX = Math.max(box.maxX, x);
                box.maxY = Math.max(box.maxY, y);
            }
        }
    }
    return box;
}

/** True when the eraser at (x, y) with the given radius touches the stroke. */
export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
    const pts = stroke.points;
    const r2 = radius * radius;
    if (pts.length === 1) {
        const dx = pts[0][0] - x;
        const dy = pts[0][1] - y;
        return dx * dx + dy * dy <= r2;
    }
    for (let i = 0; i < pts.length - 1; i++) {
        if (segmentDist2(x, y, pts[i], pts[i + 1]) <= r2) return true;
    }
    return false;
}

function segmentDist2(px: number, py: number, a: Point, b: Point): number {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy;
    let t = len2 === 0 ? 0 : ((px - a[0]) * vx + (py - a[1]) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const dx = a[0] + t * vx - px;
    const dy = a[1] + t * vy - py;
    return dx * dx + dy * dy;
}
