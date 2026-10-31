import {
    eraserRadius,
    eraseStrokes,
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
    /** Last eraser position of the gesture, the next move erases the stretch from here */
    private eraseFrom: [number, number] | null = null;
    /**
     * The eraser circle (while erasing or hovering in eraser mode). An element on top of the
     * canvas, so moving it doesn't repaint the strokes.
     */
    private cursorEl: HTMLDivElement;
    private cursorShown = false;
    /** The canvas' position on screen, read once per gesture or hover instead of on every move */
    private rect: DOMRect | null = null;
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
        // Focusable, so switching a side to pen can move the focus off the text area
        this.el.setAttr("tabindex", 0);
        this.el.createDiv({ cls: "sr-ink-placeholder", text: opts.placeholder });
        this.canvas = this.el.createEl("canvas", { cls: "sr-ink-canvas" });
        this.cursorEl = this.el.createDiv({ cls: "sr-ink-eraser-cursor" });
        const ctx = this.canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");
        this.ctx = ctx;
        this.applyGuides();

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
        const r = (this.rect ??= this.canvas.getBoundingClientRect());
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
        // The field may have moved since the last gesture (e.g. the soft keyboard closed)
        this.rect = null;
        try {
            this.canvas.setPointerCapture(e.pointerId);
        } catch {
            // Some synthetic or already-released pointers cannot be captured; drawing still works
        }

        if (this.wantsErase(e)) {
            this.erasing = true;
            this.eraseSnapshot = this.strokes;
            const p = this.point(e);
            this.eraseFrom = [p[0], p[1]];
            this.eraseTo(p);
        } else {
            this.hideCursor();
            this.current = {
                points: [this.point(e)],
                pressure: e.pointerType === "pen",
                size: this.opts.style.size,
            };
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
            this.eraseTo(this.point(e));
        } else if (this.current) {
            const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
            const samples = events.length > 0 ? events : [e];
            for (const ev of samples) this.current.points.push(this.point(ev));
            this.schedule();
        }
    };

    /**
     * A hovering pen (or mouse) in eraser mode shows where it would erase. Only the cursor
     * element moves; the strokes are not redrawn.
     */
    private hover(e: PointerEvent) {
        if (e.pointerType === "touch") return;
        if (this.wantsErase(e)) {
            const [x, y] = this.point(e);
            this.showCursor(x, y);
        } else {
            this.hideCursor();
        }
    }

    private onEnter = () => {
        this.rect = null;
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
            this.hideCursor();
            const prev = this.eraseSnapshot;
            this.eraseSnapshot = null;
            // One undo step for the whole gesture
            if (prev && prev !== this.strokes) this.opts.onChange(this, prev);
        } else if (this.current) {
            const prev = this.strokes;
            this.strokes = [...this.strokes, this.current];
            this.current = null;
            this.opts.onChange(this, prev);
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
        this.current = null;
        this.updateEmpty();
        this.schedule();
    };

    /** Erases the ink along the eraser's way from the last position to p */
    private eraseTo([x, y]: Point) {
        const from = this.eraseFrom ?? [x, y];
        const size = this.opts.style.size;
        const kept = eraseStrokes(this.strokes, from, [x, y], eraserRadius(size), size);
        this.eraseFrom = [x, y];
        this.showCursor(x, y);
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
        this.el.toggleClass("is-empty", this.isEmpty && !this.current);
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
        // Hidden (e.g. the side is in text mode): keep the old bitmap, nothing to draw
        if (width === 0 || height === 0) return;
        const w = Math.max(1, Math.round(width * dpr));
        const h = Math.max(1, Math.round(height * dpr));
        this.rect = null;
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
