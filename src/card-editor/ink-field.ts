import {
    Box,
    clipSegment,
    eraserRadius,
    eraseStrokes,
    inBox,
    Point,
    Stroke,
    strokePath,
    strokeSize,
    StrokeStyle,
} from "src/card-editor/core/strokes";
import { CardEditorGuide } from "src/data/settings";

export interface InkFieldOptions {
    /** Shown inside the field while it is empty */
    placeholder: string;
    style: StrokeStyle;
    guide: CardEditorGuide;
    guideSpacing: number;
    /** Ignore finger touches so the palm can rest on the screen */
    penOnly: boolean;
    /** Returns true while the toolbar eraser is switched on */
    eraserActive: () => boolean;
    /** Called after every change with the strokes before the change (for undo) */
    onChange: (field: InkField, previous: Stroke[]) => void;
}

const MIN_GUIDE_SPACING = 8;

/**
 * A writing area with guide lines. No Obsidian runtime dependency besides the DOM helpers.
 * Pen draws; the pen's side button (or the eraser end of a stylus, or the toolbar eraser) erases
 * the ink under it (pixel eraser: strokes are cut, not removed whole), shown by a circle cursor
 * (an element over the canvas, so a hovering pen doesn't repaint the strokes).
 *
 * Ink is only taken where the field can be seen: inside the canvas, every ancestor that clips it
 * and the (visual) viewport. Pointer capture keeps sending the pen's moves after it left that
 * area, so no stroke is lost, but a stroke ends where the pen crosses out of the area and a new
 * one starts where it comes back in; nothing outside is stored.
 *
 * To stay light on battery, the guides are a CSS background, the canvas only redraws once per
 * animation frame, finished strokes are cached as Path2D and a hidden field does not draw at all.
 */
export class InkField {
    readonly el: HTMLDivElement;
    strokes: Stroke[] = [];

    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private current: Stroke | null = null;
    /** Strokes of the gesture in progress that ended at the edge of the visible area */
    private parts: Stroke[] = [];
    /** The gesture's last sample, inside the visible area or not */
    private lastSample: Point | null = null;
    private gesturePressure = false;
    private erasing = false;
    private eraseSnapshot: Stroke[] | null = null;
    /** Last eraser position of the gesture, the next move erases the stretch from here */
    private eraseFrom: Point | null = null;
    /**
     * The eraser circle (while erasing or hovering in eraser mode). An element on top of the
     * canvas, so moving it doesn't repaint the strokes.
     */
    private cursorEl: HTMLDivElement;
    private cursorShown = false;
    /**
     * The canvas' position on screen and its visible part (in canvas coordinates; null when the
     * canvas is not laid out), read once per gesture or hover instead of on every move, and
     * again after anything that can move the field: resize, scroll, the soft keyboard.
     */
    private view: { left: number; top: number; box: Box | null } | null = null;
    /**
     * The view the gesture's last sample was taken in. When the field moves mid-gesture, the
     * samples before and after are in different coordinates and must not be joined.
     */
    private gestureView: { left: number; top: number } | null = null;
    private win: Window;
    private activePointer: number | null = null;
    private frame = 0;
    /** Finished strokes as Path2D, with the size they were built for */
    private paths = new WeakMap<Stroke, { size: number; path: Path2D }>();
    private inkColor: string | null = null;
    private resizeObserver: ResizeObserver | null = null;

    constructor(
        parent: HTMLElement,
        private opts: InkFieldOptions,
    ) {
        this.el = parent.createDiv({ cls: "sr-ink-field" });
        // Focusable, so writing in it can move the focus off the text area (see SideEditor)
        this.el.setAttr("tabindex", 0);
        this.el.createDiv({ cls: "sr-ink-placeholder", text: opts.placeholder });
        this.canvas = this.el.createEl("canvas", { cls: "sr-ink-canvas" });
        this.cursorEl = this.el.createDiv({ cls: "sr-ink-eraser-cursor" });
        const ctx = this.canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");
        this.ctx = ctx;
        this.applyGuides();
        this.win = this.el.ownerDocument.defaultView ?? activeWindow;

        this.canvas.addEventListener("pointerdown", this.onDown);
        this.canvas.addEventListener("pointermove", this.onMove);
        this.canvas.addEventListener("pointerup", this.onUp);
        this.canvas.addEventListener("pointercancel", this.onCancel);
        this.canvas.addEventListener("pointerleave", this.onLeave);
        this.canvas.addEventListener("pointerenter", this.onEnter);
        // Long-press with the pen must not open a context menu
        this.canvas.addEventListener("contextmenu", this.onContextMenu);

        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.el);
        }
        // Scrolls don't bubble: caught on the way down, from any scrolling ancestor
        this.el.ownerDocument.addEventListener("scroll", this.invalidateView, SCROLL_OPTIONS);
        this.win.addEventListener("resize", this.invalidateView);
        this.win.visualViewport?.addEventListener("resize", this.invalidateView);
        this.win.visualViewport?.addEventListener("scroll", this.invalidateView);
        this.updateEmpty();
    }

    get isEmpty(): boolean {
        return this.strokes.length === 0;
    }

    /**
     * Changes the pen thickness. New strokes are written with it (each stroke keeps the size it
     * was written with); strokes without their own size, e.g. those read back from a file, are
     * drawn with it too. Cached paths are rebuilt only for strokes whose size changes.
     */
    setStyle(style: StrokeStyle): void {
        if (style.size === this.opts.style.size) return;
        this.opts.style = style;
        this.schedule();
    }

    setStrokes(strokes: Stroke[]): void {
        this.strokes = strokes;
        this.updateEmpty();
        this.schedule();
    }

    clear(): void {
        if (this.isEmpty) return;
        const prev = this.strokes;
        this.setStrokes([]);
        this.opts.onChange(this, prev);
    }

    destroy(): void {
        this.resizeObserver?.disconnect();
        this.el.ownerDocument.removeEventListener("scroll", this.invalidateView, SCROLL_OPTIONS);
        this.win.removeEventListener("resize", this.invalidateView);
        this.win.visualViewport?.removeEventListener("resize", this.invalidateView);
        this.win.visualViewport?.removeEventListener("scroll", this.invalidateView);
        if (this.frame) activeWindow.cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.canvas.removeEventListener("pointerdown", this.onDown);
        this.canvas.removeEventListener("pointermove", this.onMove);
        this.canvas.removeEventListener("pointerup", this.onUp);
        this.canvas.removeEventListener("pointercancel", this.onCancel);
        this.canvas.removeEventListener("pointerleave", this.onLeave);
        this.canvas.removeEventListener("pointerenter", this.onEnter);
        this.canvas.removeEventListener("contextmenu", this.onContextMenu);
        // WebKit frees a canvas' memory only on garbage collection and caps the total of all
        // canvases; once over the cap, no new canvas gets a context. Free it right away.
        this.canvas.width = 0;
        this.canvas.height = 0;
    }

    // MARK: input

    private point(e: PointerEvent): Point {
        const v = (this.view ??= this.measure());
        const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
        return [e.clientX - v.left, e.clientY - v.top, pressure];
    }

    private invalidateView = () => {
        this.view = null;
    };

    /** The visible part of the canvas: see visibleBox() */
    private measure() {
        const r = this.canvas.getBoundingClientRect();
        const box = visibleBox(this.canvas, r, this.win);
        if (box === null) return { left: r.left, top: r.top, box: null };
        return {
            left: r.left,
            top: r.top,
            box: {
                minX: box.minX - r.left,
                minY: box.minY - r.top,
                maxX: box.maxX - r.left,
                maxY: box.maxY - r.top,
            },
        };
    }

    /** Whether a point (canvas coordinates, as from point()) can be seen */
    private visible(p: Point): boolean {
        const box = (this.view ??= this.measure()).box;
        return box === null || inBox(box, p[0], p[1]);
    }

    /** The part of the move from a to b that can be seen, null when none of it */
    private clip(a: Point, b: Point): [Point, Point] | null {
        const box = (this.view ??= this.measure()).box;
        return box === null ? [a, b] : clipSegment(a, b, box);
    }

    private wantsErase(e: PointerEvent): boolean {
        // buttons: 2 = barrel/side button, 32 = eraser end
        return (
            this.opts.eraserActive() ||
            (e.buttons & 2) !== 0 ||
            (e.buttons & 32) !== 0 ||
            e.button === 5
        );
    }

    private onContextMenu = (e: Event) => e.preventDefault();

    private onDown = (e: PointerEvent) => {
        if (this.opts.penOnly && e.pointerType === "touch") return;
        if (this.activePointer !== null) return;
        e.preventDefault();
        this.activePointer = e.pointerId;
        // The field may have moved since the last gesture (e.g. the soft keyboard closed)
        this.view = null;
        try {
            this.canvas.setPointerCapture(e.pointerId);
        } catch {
            // Some synthetic or already-released pointers cannot be captured; drawing still works
        }

        if (this.wantsErase(e)) {
            this.erasing = true;
            this.eraseSnapshot = this.strokes;
            const p = this.point(e);
            this.gestureView = this.view;
            this.eraseFrom = p;
            this.eraseTo(p);
        } else {
            this.hideCursor();
            this.gesturePressure = e.pointerType === "pen";
            this.parts = [];
            const p = this.point(e);
            this.gestureView = this.view;
            this.lastSample = p;
            if (this.visible(p)) this.current = this.newStroke(p);
            this.updateEmpty();
        }
        this.schedule();
    };

    private onMove = (e: PointerEvent) => {
        if (this.activePointer === null) return this.hover(e);
        if (e.pointerId !== this.activePointer) return;
        e.preventDefault();
        if (this.erasing) {
            // The eraser cuts along the whole path between moves, so coalesced samples add little;
            // the canvas is only redrawn when ink was erased
            const p = this.point(e);
            if (this.fieldMoved()) this.eraseFrom = null;
            this.eraseTo(p);
        } else if (this.lastSample) {
            const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
            const samples = events.length > 0 ? events : [e];
            for (const ev of samples) {
                const p = this.point(ev);
                if (this.fieldMoved()) {
                    this.endStroke();
                    this.lastSample = null;
                }
                this.addSample(p);
            }
            this.updateEmpty();
            this.schedule();
        }
    };

    /**
     * Whether the field moved on screen (scroll, soft keyboard) since the gesture's last sample.
     * The pen didn't jump, so the next sample starts afresh instead of drawing a line from where
     * the last one is in the old coordinates.
     */
    private fieldMoved(): boolean {
        const prev = this.gestureView;
        const v = this.view;
        if (v === null || v === prev) return false;
        this.gestureView = v;
        return prev !== null && (v.left !== prev.left || v.top !== prev.top);
    }

    /**
     * Continues the gesture to p, keeping only what can be seen: leaving the visible area ends
     * the stroke at the edge, coming back starts a new one at the edge.
     */
    private addSample(p: Point) {
        const prev = this.lastSample ?? p;
        this.lastSample = p;
        const seg = this.clip(prev, p);
        if (seg === null) return this.endStroke();
        const [from, to] = seg;
        if (this.current === null) this.current = this.newStroke(from);
        const pts = this.current.points;
        if (pts[pts.length - 1] !== to) pts.push(to);
        // Clipped: the pen left the visible area on the way to p
        if (to !== p) this.endStroke();
    }

    private newStroke(p: Point): Stroke {
        return { points: [p], pressure: this.gesturePressure, size: this.opts.style.size };
    }

    /** The stroke in progress reached the edge of the visible area */
    private endStroke() {
        if (this.current === null) return;
        this.parts.push(this.current);
        this.current = null;
    }

    /** The gesture's strokes, those ended at an edge and the one in progress */
    private gestureStrokes(): Stroke[] {
        return this.current ? [...this.parts, this.current] : this.parts;
    }

    /**
     * A hovering pen (or mouse) in eraser mode shows where it would erase. Only the cursor
     * element moves; the strokes are not redrawn.
     */
    private hover(e: PointerEvent) {
        if (e.pointerType === "touch") return;
        if (this.wantsErase(e)) {
            const p = this.point(e);
            if (this.visible(p)) this.showCursor(p[0], p[1]);
            else this.hideCursor();
        } else {
            this.hideCursor();
        }
    }

    private onEnter = () => {
        this.view = null;
    };

    private onLeave = (e: PointerEvent) => {
        if (this.activePointer !== null) return;
        if (e.pointerType === "touch") return;
        this.hideCursor();
    };

    private onUp = (e: PointerEvent) => {
        if (e.pointerId !== this.activePointer) return;
        this.activePointer = null;
        if (this.erasing) {
            this.erasing = false;
            this.eraseFrom = null;
            this.gestureView = null;
            this.hideCursor();
            const prev = this.eraseSnapshot;
            this.eraseSnapshot = null;
            // One undo step for the whole gesture
            if (prev && prev !== this.strokes) this.opts.onChange(this, prev);
        } else {
            const added = this.gestureStrokes();
            this.resetGesture();
            // One undo step for the whole gesture, however often it left the visible area
            if (added.length > 0) {
                const prev = this.strokes;
                this.strokes = [...this.strokes, ...added];
                this.opts.onChange(this, prev);
            }
        }
        this.updateEmpty();
        this.schedule();
    };

    /** The browser took the pointer over (e.g. to scroll): the unfinished stroke is dropped */
    private onCancel = (e: PointerEvent) => {
        if (e.pointerId !== this.activePointer) return;
        // What was erased so far was already shown gone, so it stays erased
        if (this.erasing) return this.onUp(e);
        this.activePointer = null;
        this.resetGesture();
        this.updateEmpty();
        this.schedule();
    };

    private resetGesture() {
        this.current = null;
        this.parts = [];
        this.lastSample = null;
        this.gestureView = null;
    }

    /** Erases the ink along the eraser's way from the last position to p, where it can be seen */
    private eraseTo(p: Point) {
        const seg = this.clip(this.eraseFrom ?? p, p);
        this.eraseFrom = p;
        if (this.visible(p)) this.showCursor(p[0], p[1]);
        else this.hideCursor();
        if (seg === null) return;
        const size = this.opts.style.size;
        const kept = eraseStrokes(this.strokes, seg[0], seg[1], eraserRadius(size), size);
        if (kept !== this.strokes) {
            this.strokes = kept;
            this.updateEmpty();
            this.schedule();
        }
    }

    private showCursor(x: number, y: number) {
        const r = eraserRadius(this.opts.style.size);
        this.cursorEl.setCssProps({
            "--sr-ink-eraser-size": `${2 * r}px`,
            "--sr-ink-eraser-x": `${x - r}px`,
            "--sr-ink-eraser-y": `${y - r}px`,
        });
        if (!this.cursorShown) {
            this.cursorShown = true;
            this.cursorEl.addClass("is-visible");
        }
    }

    private hideCursor() {
        if (!this.cursorShown) return;
        this.cursorShown = false;
        this.cursorEl.removeClass("is-visible");
    }

    // MARK: drawing

    private updateEmpty() {
        this.el.toggleClass("is-empty", this.isEmpty && !this.current && this.parts.length === 0);
    }

    /** The ink color follows the theme: read it again and redraw */
    themeChanged(): void {
        this.inkColor = null;
        this.schedule();
    }

    /** The guides are drawn by CSS, so the canvas never has to repaint them */
    private applyGuides() {
        const { guide, guideSpacing } = this.opts;
        const shown = guide !== "none" && guideSpacing >= MIN_GUIDE_SPACING;
        this.el.addClass(`sr-ink-guide-${shown ? guide : "none"}`);
        this.el.setCssProps({ "--sr-ink-guide-spacing": `${guideSpacing}px` });
    }

    private schedule() {
        if (this.frame) return;
        this.frame = activeWindow.requestAnimationFrame(() => {
            this.frame = 0;
            this.redraw();
        });
    }

    private resize() {
        const dpr = activeWindow.devicePixelRatio || 1;
        const { width, height } = this.el.getBoundingClientRect();
        // Hidden (e.g. not laid out yet): keep the old bitmap, nothing to draw
        if (width === 0 || height === 0) return;
        const w = Math.max(1, Math.round(width * dpr));
        const h = Math.max(1, Math.round(height * dpr));
        this.view = null;
        if (w !== this.canvas.width || h !== this.canvas.height) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        // Also shown again after being hidden: strokes may have changed and the theme too
        this.inkColor = null;
        this.redraw();
    }

    private path(stroke: Stroke): Path2D {
        const size = strokeSize(stroke, this.opts.style);
        const cached = this.paths.get(stroke);
        if (cached && cached.size === size) return cached.path;
        const path = new Path2D(strokePath(stroke, this.opts.style));
        this.paths.set(stroke, { size, path });
        return path;
    }

    redraw(): void {
        if (!this.el.isConnected || this.el.offsetParent === null) return;
        const dpr = activeWindow.devicePixelRatio || 1;
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.strokes.length === 0 && !this.current && this.parts.length === 0) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.inkColor ??= cssVar(this.el, "--text-normal", "#222");
        ctx.fillStyle = this.inkColor;
        for (const s of this.strokes) ctx.fill(this.path(s));
        // Finished parts of the gesture don't change any more
        for (const s of this.parts) ctx.fill(this.path(s));
        // The stroke in progress changes every frame, so it is not cached
        if (this.current) ctx.fill(new Path2D(strokePath(this.current, this.opts.style)));
    }
}

const SCROLL_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

/**
 * The part of an element's box (`rect`, on screen) that can be seen: cut to every ancestor that
 * clips its content (overflow other than visible, up to but without body, whose overflow is the
 * window's), the window and the visual viewport (pinch zoom, soft keyboard). Ancestors that are
 * not laid out are skipped; null when the element itself is not laid out.
 */
export function visibleBox(el: Element, rect: DOMRect, win: Window): Box | null {
    if (rect.width <= 0 || rect.height <= 0) return null;
    const box: Box = { minX: rect.left, minY: rect.top, maxX: rect.right, maxY: rect.bottom };
    const cut = (minX: number, minY: number, maxX: number, maxY: number) => {
        box.minX = Math.max(box.minX, minX);
        box.minY = Math.max(box.minY, minY);
        box.maxX = Math.min(box.maxX, maxX);
        box.maxY = Math.min(box.maxY, maxY);
    };
    const doc = el.ownerDocument;
    for (
        let a = el.parentElement;
        a && a !== doc.body && a !== doc.documentElement;
        a = a.parentElement
    ) {
        const style = win.getComputedStyle(a);
        const clipsX = clips(style.overflowX || style.overflow);
        const clipsY = clips(style.overflowY || style.overflow);
        const r = a.getBoundingClientRect();
        if ((clipsX || clipsY) && r.width > 0 && r.height > 0) {
            // Content is clipped at the padding box: inside the borders
            const px = (v: string) => parseFloat(v) || 0;
            cut(
                clipsX ? r.left + px(style.borderLeftWidth) : -Infinity,
                clipsY ? r.top + px(style.borderTopWidth) : -Infinity,
                clipsX ? r.right - px(style.borderRightWidth) : Infinity,
                clipsY ? r.bottom - px(style.borderBottomWidth) : Infinity,
            );
        }
    }
    cut(0, 0, win.innerWidth, win.innerHeight);
    const vv = win.visualViewport;
    if (vv) cut(vv.offsetLeft, vv.offsetTop, vv.offsetLeft + vv.width, vv.offsetTop + vv.height);
    return box;
}

function clips(overflow: string): boolean {
    return overflow !== "" && overflow !== "visible";
}

function cssVar(el: HTMLElement, name: string, fallback: string): string {
    const v = activeWindow.getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
}
