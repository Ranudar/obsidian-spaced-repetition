import "src/card-editor/card-editor.css";

import { Stroke } from "src/card-editor/core/strokes";
import { InkField, renderHint } from "src/card-editor/ink-field";
import { SRSettings } from "src/data/settings";
import { TextDirection } from "src/utils/strings";

/** Content of one side: typed text and handwriting, both saved */
export interface SideState {
    text: string;
    strokes: Stroke[];
    /** Pen thickness the strokes are drawn and saved with */
    penSize: number;
}

export interface SideEditorOptions {
    label: string;
    /** Which side this is; it is marked on the left edge of its fields (front) or the right (back) */
    face: "front" | "back";
    /** Shown in the pen zone while it is empty; a **word** is bold */
    inkHint: string;
    /** Shown in the text zone while it is empty; a **word** is bold */
    textHint: string;
    initial: SideState;
    /** false for cloze cards and with pen mode off: text only, no pen zone */
    allowInk: boolean;
    settings: SRSettings;
    textDirection: TextDirection;
    /** Called after any change of text or strokes */
    onChange(): void;
    /**
     * Called after every ink change with the strokes before it (for undo). Clearing the side
     * reports the text before it too, so one undo step restores both.
     */
    onInkCommit(prev: Stroke[], prevText?: string): void;
    /** Whether a press is the palm resting on the screen (pen-only on); it is then ignored */
    isPalm?(evt: PointerEvent): boolean;
    /** Returns the eraser's radius, in pixels */
    eraserRadius?: () => number;
    /** The pen's side button was pressed while the pen hovers over the pen zone */
    onSideButton?: () => void;
    /** Returns when the pen last touched or left the screen anywhere (Date.now()) */
    lastPenContact?: () => number;
    /** Called when text is typed, not when it is set (e.g. by undo or "Clear side") */
    onType?(): void;
    /** The preview (see setPreview()) was tapped */
    onPreviewTap?(): void;
}

/** How long a side is outlined when saving needs it filled in */
const FLASH_MS = 900;

/**
 * One side of a card: a pen zone of fixed height and, below it, a text zone. Both are saved.
 * The side's element doesn't take part in the layout (display: contents): the two zones are
 * placed in the editor's grid, so both sides take exactly the same place and only the side
 * shown is laid out.
 */
export class SideEditor {
    readonly el: HTMLDivElement;
    readonly label: string;

    private opts: SideEditorOptions;
    private initial: SideState;
    private penSize: number;
    private eraser = false;
    private textWrap: HTMLElement;
    private textArea: HTMLTextAreaElement;
    private previewEl: HTMLElement;
    /** The press on the preview is the palm (see SideEditorOptions.isPalm) */
    private previewPalm = false;
    private ink: InkField | null = null;
    private flashTimer: number | null = null;

    constructor(parent: HTMLElement, opts: SideEditorOptions) {
        this.opts = opts;
        this.label = opts.label;
        this.initial = withOwnSizes(opts.initial);
        this.penSize = opts.initial.penSize;

        this.el = parent.createDiv({ cls: ["sr-card-editor-side", `is-${opts.face}`] });
        this.el.toggleClass("is-text-only", !opts.allowInk);

        if (opts.allowInk) {
            const s = opts.settings;
            const inkHost = this.el.createDiv({ cls: "sr-card-editor-ink" });
            // Also on the zone's border, around the canvas: the text area keeps the focus
            inkHost.addEventListener("pointerdown", (evt) => evt.preventDefault());
            this.ink = new InkField(inkHost, {
                placeholder: opts.inkHint,
                style: { size: this.penSize },
                guide: s.cardEditorGuide,
                guideSpacing: s.cardEditorGuideSpacing,
                eraserActive: () => this.eraser,
                eraserRadius: opts.eraserRadius,
                onSideButton: opts.onSideButton,
                lastPenContact: opts.lastPenContact,
                onChange: (prev) => this.onInkChange(prev),
            });
            this.ink.setStrokes(this.initial.strokes);
        }

        // The hint is an element over the text area, not its placeholder, which can't be bold
        this.textWrap = this.el.createDiv({ cls: "sr-card-editor-text-wrap" });
        // On the wrap, so the hint follows the text's direction too
        if (opts.textDirection === TextDirection.Rtl) this.textWrap.setAttr("dir", "rtl");
        this.textArea = this.textWrap.createEl("textarea", { cls: "sr-card-editor-text" });
        this.textArea.value = opts.initial.text;
        this.textArea.setAttr("aria-label", opts.label);
        this.textArea.addEventListener("input", this.onTextInput);
        this.textArea.addEventListener("keydown", this.onTextKeyDown);
        this.textArea.addEventListener("pointerdown", this.onTextPointerDown);
        renderHint(this.textWrap.createDiv({ cls: "sr-card-editor-text-hint" }), opts.textHint);
        this.previewEl = this.textWrap.createDiv({ cls: "sr-card-editor-preview" });
        this.previewEl.addEventListener("pointerdown", this.onPreviewPointerDown);
        this.previewEl.addEventListener("click", this.onPreviewClick);
        this.updateTextEmpty();
    }

    get strokes(): Stroke[] {
        return this.ink ? this.ink.strokes : [];
    }

    get text(): string {
        return this.textArea.value;
    }

    get state(): SideState {
        return { text: this.text, strokes: this.strokes, penSize: this.penSize };
    }

    /** Nothing to save: blank text and no strokes */
    get isEmpty(): boolean {
        return this.text.trim() === "" && this.strokes.length === 0;
    }

    /** The strokes differ from the ones the side was opened with */
    get inkChanged(): boolean {
        return !sameStrokes(this.strokes, this.initial.strokes);
    }

    /** The element ink is written on, null without ink (cloze, pen mode off) */
    get inkEl(): HTMLElement | null {
        return this.ink?.el ?? null;
    }

    setStrokes(strokes: Stroke[]): void {
        if (!this.ink) return;
        this.ink.setStrokes(strokes);
        this.opts.onChange();
    }

    /** Replaces the text, e.g. on undo of "Clear side"; the text area's own undo starts over */
    setText(text: string): void {
        if (text === this.text) return;
        this.textArea.value = text;
        this.updateTextEmpty();
        this.opts.onChange();
    }

    /** Pen thickness of new strokes on this side; strokes already written keep theirs */
    setPenSize(size: number): void {
        if (size === this.penSize) return;
        this.penSize = size;
        this.ink?.setStyle({ size });
    }

    /** Clears text and ink, reported to onInkCommit as one step so it can be undone */
    clear(): void {
        if (this.text === "" && this.strokes.length === 0) return;
        const prevStrokes = this.strokes;
        const prevText = this.text;
        this.textArea.value = "";
        this.updateTextEmpty();
        // Not ink.clear(): that would report the ink alone
        this.ink?.setStrokes([]);
        this.opts.onInkCommit(prevStrokes, prevText);
        this.opts.onChange();
    }

    /** Starts over with new content, e.g. the next card after "Save & next" */
    reset(state: SideState): void {
        state = withOwnSizes(state);
        this.initial = state;
        this.penSize = state.penSize;
        this.textArea.value = state.text;
        this.updateTextEmpty();
        if (this.ink) {
            this.ink.setStyle({ size: state.penSize });
            this.ink.setStrokes(state.strokes);
        }
        this.opts.onChange();
    }

    setEraser(on: boolean): void {
        this.eraser = on;
    }

    /** Only one side is shown at a time; a hidden pen zone doesn't draw */
    show(shown: boolean): void {
        this.el.toggleClass("sr-is-hidden", !shown);
    }

    /** Outlines the side's fields for a moment, e.g. when saving needs it filled in */
    flash(): void {
        if (this.flashTimer !== null) activeWindow.clearTimeout(this.flashTimer);
        this.el.removeClass("is-flashing");
        // Read the layout, so the animation starts over when the class comes back
        this.textWrap.getBoundingClientRect();
        this.el.addClass("is-flashing");
        this.flashTimer = activeWindow.setTimeout(() => {
            this.flashTimer = null;
            this.el.removeClass("is-flashing");
        }, FLASH_MS);
    }

    /** Re-reads the theme's colors, e.g. after switching to dark mode */
    themeChanged(): void {
        this.ink?.themeChanged();
    }

    /** Focuses the text area (on mobile this opens the soft keyboard, which then stays open) */
    focus(): void {
        this.textArea.focus({ preventScroll: true });
    }

    /** Focuses the text area with the cursor at the end of the text */
    focusEnd(): void {
        this.focus();
        const end = this.textArea.value.length;
        this.textArea.setSelectionRange(end, end);
    }

    /** The text selected in the text area; "" with only a cursor */
    get selectedText(): string {
        const ta = this.textArea;
        return ta.value.substring(ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
    }

    /**
     * Puts open and close around the selected text, like typing it: the cursor then goes after
     * close, or between the two when nothing was selected
     */
    wrapSelection(open: string, close: string): void {
        const ta = this.textArea;
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? start;
        ta.setRangeText(open + ta.value.substring(start, end) + close, start, end, "end");
        if (start === end) ta.setSelectionRange(start + open.length, start + open.length);
        this.onTextInput();
    }

    /**
     * Shows what render() puts into the text zone in place of the text area (e.g. the text
     * rendered); null: back to the text area. The text area keeps the focus, so the soft keyboard
     * and the editor's keys stay, but is read-only meanwhile: nothing is typed into hidden text.
     */
    setPreview(render: ((el: HTMLElement) => void) | null): void {
        this.previewEl.empty();
        this.textWrap.toggleClass("is-preview", render !== null);
        this.textArea.readOnly = render !== null;
        if (render !== null) render(this.previewEl);
    }

    destroy(): void {
        if (this.flashTimer !== null) activeWindow.clearTimeout(this.flashTimer);
        this.textArea.removeEventListener("input", this.onTextInput);
        this.textArea.removeEventListener("keydown", this.onTextKeyDown);
        this.textArea.removeEventListener("pointerdown", this.onTextPointerDown);
        this.previewEl.removeEventListener("pointerdown", this.onPreviewPointerDown);
        this.previewEl.removeEventListener("click", this.onPreviewClick);
        this.ink?.destroy();
        this.el.remove();
    }

    // MARK: helpers

    private updateTextEmpty() {
        this.textWrap.toggleClass("is-empty", this.textArea.value === "");
    }

    private onInkChange(prev: Stroke[]) {
        this.opts.onInkCommit(prev);
        this.opts.onChange();
    }

    private onTextInput = () => {
        this.updateTextEmpty();
        this.opts.onType?.();
        this.opts.onChange();
    };

    private onTextKeyDown = (evt: KeyboardEvent) => {
        if (evt.key === "Tab" && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
            evt.preventDefault();
            insertText(this.textArea, "\t");
            this.onTextInput();
        }
    };

    private onPreviewPointerDown = (evt: PointerEvent) => {
        // The text area keeps the focus, the tap then goes back to typing in it
        evt.preventDefault();
        this.previewPalm = this.opts.isPalm?.(evt) ?? false;
    };

    /** A tap on the preview goes back to typing; not the palm's */
    private onPreviewClick = () => {
        const palm = this.previewPalm;
        this.previewPalm = false;
        if (!palm) this.opts.onPreviewTap?.();
    };

    /** The palm must not focus the text area: the soft keyboard would open under the pen */
    private onTextPointerDown = (evt: PointerEvent) => {
        if (this.opts.isPalm?.(evt) ?? false) evt.preventDefault();
    };
}

function insertText(textArea: HTMLTextAreaElement, text: string) {
    const start = textArea.selectionStart ?? textArea.value.length;
    const end = textArea.selectionEnd ?? start;
    textArea.setRangeText(text, start, end, "end");
}

/**
 * Strokes without their own size (e.g. made before strokes had one) get the side's pen size, so
 * they keep their thickness when the pen size changes for new strokes.
 */
function withOwnSizes(state: SideState): SideState {
    if (state.strokes.every((s) => s.size !== undefined)) return state;
    const strokes = state.strokes.map((s) =>
        s.size === undefined ? { ...s, size: state.penSize } : s,
    );
    return { ...state, strokes };
}

function sameStrokes(a: Stroke[], b: Stroke[]): boolean {
    return a.length === b.length && a.every((s, i) => s === b[i]);
}
