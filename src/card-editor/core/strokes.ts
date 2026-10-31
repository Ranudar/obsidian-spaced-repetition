import { getStroke } from "perfect-freehand";

/** One input sample: x, y in CSS pixels relative to the field, pressure 0..1 */
export type Point = [number, number, number];

export interface Stroke {
    points: Point[];
    /** true when the pressure values came from a real pen */
    pressure: boolean;
    /**
     * Pen thickness this stroke was written with. Missing for strokes read back from a file
     * (they all share the file's size), then the field's current style applies.
     */
    size?: number;
}

export interface StrokeStyle {
    size: number;
}

/** The thickness a stroke is drawn with: its own, else the style's */
export function strokeSize(stroke: Stroke, style: StrokeStyle): number {
    return stroke.size ?? style.size;
}

/** How much pressure (real or simulated from speed) changes the stroke's thickness */
function strokeThinning(stroke: Stroke): number {
    return stroke.pressure ? 0.6 : 0.5;
}

/**
 * The largest distance the stroke's outline can reach from its center line: perfect-freehand's
 * radius `size * (0.5 - thinning * (0.5 - pressure))` at full pressure. More than half the size.
 */
export function strokeMaxRadius(stroke: Stroke, style: StrokeStyle): number {
    return strokeSize(stroke, style) * (0.5 + strokeThinning(stroke) * 0.5);
}

export function strokeOutline(stroke: Stroke, style: StrokeStyle): number[][] {
    return getStroke(stroke.points, {
        size: strokeSize(stroke, style),
        thinning: strokeThinning(stroke),
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

/** True when the eraser at (x, y) with the given radius touches the stroke's center line. */
export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
    const pts = stroke.points;
    const r2 = radius * radius;
    if (pts.length === 1) return pointSegmentDist2(x, y, pts[0], pts[0]) <= r2;
    for (let i = 0; i < pts.length - 1; i++) {
        if (pointSegmentDist2(x, y, pts[i], pts[i + 1]) <= r2) return true;
    }
    return false;
}

// MARK: pixel eraser

/** Eraser radius in CSS pixels for a pen size: a thicker pen gets a bigger eraser */
export function eraserRadius(penSize: number): number {
    return Math.max(8, 3 * penSize);
}

/** An x, y position; points with pressure fit too */
type XY = readonly [number, number, ...number[]];

/** Point bounds of finished strokes; strokes are never changed in place, so caching is safe */
const boundsCache = new WeakMap<Stroke, { n: number; box: Box }>();

function strokeBounds(stroke: Stroke): Box {
    const pts = stroke.points;
    const cached = boundsCache.get(stroke);
    if (cached && cached.n === pts.length) return cached.box;
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [x, y] of pts) {
        if (x < box.minX) box.minX = x;
        if (y < box.minY) box.minY = y;
        if (x > box.maxX) box.maxX = x;
        if (y > box.maxY) box.maxY = y;
    }
    boundsCache.set(stroke, { n: pts.length, box });
    return box;
}

/**
 * Pixel eraser: removes the parts of the strokes that the eraser covered while moving from
 * `from` to `to` (a capsule: the segment widened by `radius`). A stroke counts as covered where
 * its center line comes within `radius` plus the widest its outline gets (strokeMaxRadius()),
 * so no ink is left showing inside the eraser. Strokes cut through are split into the remaining runs, which stay vector
 * strokes with their own pressure flag and size. Remnants too short to be seen are dropped.
 *
 * Strokes the eraser didn't touch are returned as the same objects, and when nothing was
 * erased the same array is returned, so callers can keep caches and detect "no change".
 *
 * @param defaultSize the thickness of strokes without their own size
 */
export function eraseStrokes(
    strokes: Stroke[],
    from: XY,
    to: XY,
    radius: number,
    defaultSize: number,
): Stroke[] {
    let result: Stroke[] | null = null;
    const style = { size: defaultSize };
    for (let i = 0; i < strokes.length; i++) {
        const s = strokes[i];
        const pieces = eraseStroke(s, from, to, radius + strokeMaxRadius(s, style), defaultSize);
        if (pieces === null) {
            result?.push(s);
            continue;
        }
        result ??= strokes.slice(0, i);
        result.push(...pieces);
    }
    return result ?? strokes;
}

/** null: untouched; otherwise the pieces that remain (possibly none) */
function eraseStroke(stroke: Stroke, from: XY, to: XY, r: number, defaultSize: number) {
    const pts = stroke.points;
    if (pts.length === 0) return null;

    // Quick rejection by bounding boxes
    const b = strokeBounds(stroke);
    if (
        b.maxX < Math.min(from[0], to[0]) - r ||
        b.minX > Math.max(from[0], to[0]) + r ||
        b.maxY < Math.min(from[1], to[1]) - r ||
        b.minY > Math.max(from[1], to[1]) + r
    ) {
        return null;
    }

    const r2 = r * r;
    if (pts.length === 1) {
        return pointSegmentDist2(pts[0][0], pts[0][1], from, to) <= r2 ? [] : null;
    }

    // Only segments that reach into the eraser are resampled, finely enough for a clean cut
    const step = Math.max(0.5, r / 4);
    const dense: Point[] = [];
    let near = false;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const c = pts[i + 1];
        dense.push(a);
        if (segmentSegmentDist2(a, c, from, to) > r2) continue;
        near = true;
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const n = Math.ceil(len / step);
        for (let k = 1; k < n; k++) {
            const t = k / n;
            dense.push([
                a[0] + (c[0] - a[0]) * t,
                a[1] + (c[1] - a[1]) * t,
                a[2] + (c[2] - a[2]) * t,
            ]);
        }
    }
    if (!near) return null;
    dense.push(pts[pts.length - 1]);

    const size = stroke.size ?? defaultSize;
    const minLength = Math.max(1, size / 2);
    const pieces: Stroke[] = [];
    let run: Point[] = [];
    let erased = false;
    const flush = () => {
        if (run.length >= 2 && polylineLength(run) >= minLength) {
            const piece: Stroke = { points: run, pressure: stroke.pressure };
            if (stroke.size !== undefined) piece.size = stroke.size;
            pieces.push(piece);
        }
        run = [];
    };
    for (const p of dense) {
        if (pointSegmentDist2(p[0], p[1], from, to) <= r2) {
            erased = true;
            flush();
        } else {
            run.push(p);
        }
    }
    if (!erased) return null;
    flush();
    return pieces;
}

function polylineLength(pts: Point[]): number {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return len;
}

function pointSegmentDist2(px: number, py: number, a: XY, b: XY): number {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy;
    let t = len2 === 0 ? 0 : ((px - a[0]) * vx + (py - a[1]) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const dx = a[0] + t * vx - px;
    const dy = a[1] + t * vy - py;
    return dx * dx + dy * dy;
}

const cross = (o: XY, a: XY, b: XY) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Squared distance between the segments ab and cd */
function segmentSegmentDist2(a: XY, b: XY, c: XY, d: XY): number {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return 0;
    }
    return Math.min(
        pointSegmentDist2(a[0], a[1], c, d),
        pointSegmentDist2(b[0], b[1], c, d),
        pointSegmentDist2(c[0], c[1], a, b),
        pointSegmentDist2(d[0], d[1], a, b),
    );
}
