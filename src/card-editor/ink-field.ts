import { Point, Stroke, strokeHit, strokePath, StrokeStyle } from "src/card-editor/core/strokes";
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

const ERASER_RADIUS = 14;
const MIN_GUIDE_SPACING = 8;

/**
 * A writing area with guide lines. No Obsidian runtime dependency besides the DOM helpers.
 * Pen draws; the pen's side button (or the eraser end of a stylus, or the toolbar eraser) erases.
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
    private erasing = false;
    private eraseSnapshot: Stroke[] | null = null;
    private activePointer: number | null = null;
    private frame = 0;
    private paths = new WeakMap<Stroke, Path2D>();
    private inkColor: string | null = null;
    private resizeObserver: ResizeObserver | null = null;

    constructor(
        parent: HTMLElement,
        private opts: InkFieldOptions,
    ) {
        this.el = parent.createDiv({ cls: "sr-ink-field" });
        // Focusable, so typing while the field is focused can be noticed
        this.el.setAttr("tabindex", 0);
        this.el.createDiv({ cls: "sr-ink-placeholder", text: opts.placeholder });
        this.canvas = this.el.createEl("canvas", { cls: "sr-ink-canvas" });
        const ctx = this.canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");
        this.ctx = ctx;
        this.applyGuides();

        this.canvas.addEventListener("pointerdown", this.onDown);
        this.canvas.addEventListener("pointermove", this.onMove);
        this.canvas.addEventListener("pointerup", this.onUp);
        this.canvas.addEventListener("pointercancel", this.onUp);
        // Long-press with the pen must not open a context menu
        this.canvas.addEventListener("contextmenu", this.onContextMenu);

        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.el);
        }
        this.updateEmpty();
    }

    get isEmpty(): boolean {
        return this.strokes.length === 0;
    }

    /** Changes the pen thickness (used when re-opening a card written with another size) */
    setStyle(style: StrokeStyle): void {
        this.opts.style = style;
        this.paths = new WeakMap();
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

    /**
     * Starts a stroke from a pointerdown that hit another element, e.g. the text area that turned
     * into this field when the pen touched it. The canvas captures the pointer from here on.
     */
    beginStroke(e: PointerEvent): void {
        this.resize();
        this.onDown(e);
    }

    destroy(): void {
        this.resizeObserver?.disconnect();
        if (this.frame) activeWindow.cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.canvas.removeEventListener("pointerdown", this.onDown);
        this.canvas.removeEventListener("pointermove", this.onMove);
        this.canvas.removeEventListener("pointerup", this.onUp);
        this.canvas.removeEventListener("pointercancel", this.onUp);
        this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    }

    // MARK: input

    private point(e: PointerEvent): Point {
        const r = this.canvas.getBoundingClientRect();
        const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
        return [e.clientX - r.left, e.clientY - r.top, pressure];
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
        try {
            this.canvas.setPointerCapture(e.pointerId);
        } catch {
            // Some synthetic or already-released pointers cannot be captured; drawing still works
        }

        if (this.wantsErase(e)) {
            this.erasing = true;
            this.eraseSnapshot = this.strokes;
            this.eraseAt(this.point(e));
        } else {
            this.current = { points: [this.point(e)], pressure: e.pointerType === "pen" };
            this.updateEmpty();
        }
        this.schedule();
    };

    private onMove = (e: PointerEvent) => {
        if (e.pointerId !== this.activePointer) return;
        e.preventDefault();
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        const samples = events.length > 0 ? events : [e];
        for (const ev of samples) {
            const p = this.point(ev);
            if (this.erasing) this.eraseAt(p);
            else if (this.current) this.current.points.push(p);
        }
        this.schedule();
    };

    private onUp = (e: PointerEvent) => {
        if (e.pointerId !== this.activePointer) return;
        this.activePointer = null;
        if (this.erasing) {
            this.erasing = false;
            const prev = this.eraseSnapshot;
            this.eraseSnapshot = null;
            if (prev && prev.length !== this.strokes.length) this.opts.onChange(this, prev);
        } else if (this.current) {
            const prev = this.strokes;
            this.strokes = [...this.strokes, this.current];
            this.current = null;
            this.opts.onChange(this, prev);
        }
        this.updateEmpty();
        this.schedule();
    };

    private eraseAt([x, y]: Point) {
        const kept = this.strokes.filter((s) => !strokeHit(s, x, y, ERASER_RADIUS));
        if (kept.length !== this.strokes.length) {
            this.strokes = kept;
            this.updateEmpty();
        }
    }

    // MARK: drawing

    private updateEmpty() {
        this.el.toggleClass("is-empty", this.isEmpty && !this.current);
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
        // Hidden (e.g. the side is in text mode): keep the old bitmap, nothing to draw
        if (width === 0 || height === 0) return;
        const w = Math.max(1, Math.round(width * dpr));
        const h = Math.max(1, Math.round(height * dpr));
        if (w !== this.canvas.width || h !== this.canvas.height) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        // Also shown again after being hidden: strokes may have changed and the theme too
        this.inkColor = null;
        this.redraw();
    }

    private path(stroke: Stroke): Path2D {
        let p = this.paths.get(stroke);
        if (!p) {
            p = new Path2D(strokePath(stroke, this.opts.style));
            this.paths.set(stroke, p);
        }
        return p;
    }

    redraw(): void {
        if (!this.el.isConnected || this.el.offsetParent === null) return;
        const dpr = activeWindow.devicePixelRatio || 1;
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.strokes.length === 0 && !this.current) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.inkColor ??= cssVar(this.el, "--text-normal", "#222");
        ctx.fillStyle = this.inkColor;
        for (const s of this.strokes) ctx.fill(this.path(s));
        // The stroke in progress changes every frame, so it is not cached
        if (this.current) ctx.fill(new Path2D(strokePath(this.current, this.opts.style)));
    }
}

function cssVar(el: HTMLElement, name: string, fallback: string): string {
    const v = activeWindow.getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
}
