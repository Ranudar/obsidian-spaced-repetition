import "src/card-editor/card-editor.css";

import { Stroke } from "src/card-editor/core/strokes";
import { InkField, renderHint } from "src/card-editor/ink-field";
import { SRSettings } from "src/data/settings";
import { TextDirection } from "src/utils/strings";

/** How a side is filled in: typed or drawn, never both */
export type SideInput = "text" | "pen";

/** Content of one side: its text when typed, its strokes when drawn (see input) */
export interface SideState {
    text: string;
    strokes: Stroke[];
    /** Pen thickness the strokes are drawn and saved with */
    penSize: number;
    input: SideInput;
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
    /** false for cloze cards and with pen mode off: always typed, no pen field */
    allowInk: boolean;
    settings: SRSettings;
    textDirection: TextDirection;
    /** Called after any change of text or strokes */
    onChange(): void;
    /**
     * Called after every ink change with the strokes before it (for undo). Clearing the side
     * reports the text before it too, so undo restores a typed side's text.
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
 * One side of a card, typed or drawn: its text zone or its pen zone, one at a time, in the same
 * place. The side's element doesn't take part in the layout (display: contents): its zones are
 * placed in the editor's grid, so both sides take exactly the same place and only the side shown
 * is laid out.
 */
export class SideEditor {
    readonly el: HTMLDivElement;
    readonly label: string;
    readonly face: "front" | "back";

    private opts: SideEditorOptions;
    private initial: SideState;
    private penSize: number;
    private _input: SideInput;
    private eraser = false;
    private textWrap: HTMLElement;
    private textArea: HTMLTextAreaElement;
    private previewEl: HTMLElement;
    /** The press on the preview is the palm (see SideEditorOptions.isPalm) */
    private previewPalm = false;
    /** Locked while the card is saved (see setLocked()) */
    private locked = false;
    private ink: InkField | null = null;
    private inkHost: HTMLElement | null = null;
    private flashTimer: number | null = null;

    constructor(parent: HTMLElement, opts: SideEditorOptions) {
        this.opts = opts;
        this.label = opts.label;
        this.face = opts.face;
        this.initial = withOwnSizes(opts.initial);
        this.penSize = opts.initial.penSize;
        this._input = opts.allowInk ? opts.initial.input : "text";

        this.el = parent.createDiv({ cls: ["sr-card-editor-side", `is-${opts.face}`] });

        if (opts.allowInk) {
            const s = opts.settings;
            const inkHost = (this.inkHost = this.el.createDiv({ cls: "sr-card-editor-ink" }));
            // Takes the focus while drawing (see focus()), so the editor's keys still work
            inkHost.tabIndex = -1;
            // Also on the zone's border, around the canvas: the focus stays where it is
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
        this.updateInput();
    }

    /** Typed or drawn; always typed without a pen field (cloze, pen mode off) */
    get input(): SideInput {
        return this._input;
    }

    get strokes(): Stroke[] {
        return this.ink ? this.ink.strokes : [];
    }

    get text(): string {
        return this.textArea.value;
    }

    get state(): SideState {
        return { text: this.text, strokes: this.strokes, penSize: this.penSize, input: this.input };
    }

    /** Nothing to save: blank text when typed, no strokes when drawn */
    get isEmpty(): boolean {
        return this.input === "pen" ? this.strokes.length === 0 : this.text.trim() === "";
    }

    /** The strokes differ from the ones the side was opened with */
    get inkChanged(): boolean {
        return !sameStrokes(this.strokes, this.initial.strokes);
    }

    /** The text zone (text area, hint, preview), e.g. for a button in its corner */
    get textZoneEl(): HTMLElement {
        return this.textWrap;
    }

    /** The element ink is written on, null without a pen field (cloze, pen mode off) */
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

    /**
     * Switches between typing and drawing; the side's content is deleted (the editor asks first),
     * not as an undo step. Without a pen field the side stays typed.
     */
    setInput(input: SideInput): void {
        if (input === this.input || this.ink === null) return;
        this._input = input;
        this.textArea.value = "";
        this.updateTextEmpty();
        this.ink.setStrokes([]);
        this.updateInput();
        this.opts.onChange();
    }

    /**
     * Clears the side's content (its text or its strokes; the other is always empty), reported
     * to onInkCommit so it can be undone
     */
    clear(): void {
        if (this.text === "" && this.strokes.length === 0) return;
        const prevStrokes = this.strokes;
        const prevText = this.text;
        this.textArea.value = "";
        this.updateTextEmpty();
        // Not ink.clear(): that would report the ink without the text
        this.ink?.setStrokes([]);
        this.opts.onInkCommit(prevStrokes, prevText);
        this.opts.onChange();
    }

    /** Starts over with new content, e.g. the next card after "Save & next" */
    reset(state: SideState): void {
        state = withOwnSizes(state);
        this.initial = state;
        this.penSize = state.penSize;
        if (this.ink) this._input = state.input;
        this.textArea.value = state.text;
        this.updateTextEmpty();
        this.updateInput();
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

    /**
     * Typed, focuses the text area (on mobile this opens the soft keyboard, which then stays
     * open); drawn, the pen zone, which closes the soft keyboard
     */
    focus(): void {
        if (this.input === "pen") this.inkHost?.focus({ preventScroll: true });
        else this.textArea.focus({ preventScroll: true });
    }

    /** Typed, focuses the text area with the cursor at the end of the text */
    focusEnd(): void {
        this.focus();
        if (this.input === "pen") return;
        const end = this.textArea.value.length;
        this.textArea.setSelectionRange(end, end);
    }

    /** The text selected in the text area; "" with only a cursor */
    get selectedText(): string {
        const ta = this.textArea;
        return ta.value.substring(ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
    }

    /**
     * Wraps the selection in open/close. Without a selection, the word the cursor is in (or right
     * after) is wrapped, so a tap in a word is enough; outside a word, an empty pair is inserted
     * with the cursor inside.
     */
    wrapSelection(open: string, close: string): void {
        const ta = this.textArea;
        let start = ta.selectionStart ?? ta.value.length;
        let end = ta.selectionEnd ?? start;
        if (start === end) {
            const word = wordAt(ta.value, start);
            if (word !== null) [start, end] = word;
        }
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
        this.updateReadOnly();
        if (render !== null) render(this.previewEl);
    }

    /** While the card is saved its text can't be changed; the preview keeps it read-only too */
    setLocked(locked: boolean): void {
        this.locked = locked;
        this.updateReadOnly();
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

    /** Shows the zone of the side's input, hides the other */
    private updateInput() {
        this.el.toggleClass("is-pen", this.input === "pen");
        this.el.toggleClass("is-text", this.input === "text");
    }

    private updateReadOnly() {
        this.textArea.readOnly = this.locked || this.textWrap.hasClass("is-preview");
    }

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
            // Read-only (preview, saving): nothing is typed into the text, not even a tab
            if (this.textArea.readOnly) return;
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

/** The word at position pos (inside it or right after it), as [start, end]; null outside a word */
export function wordAt(text: string, pos: number): [number, number] | null {
    const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_'-]/u.test(c);
    let start = pos;
    let end = pos;
    while (isWordChar(text[start - 1])) start--;
    while (isWordChar(text[end])) end++;
    return start === end ? null : [start, end];
}
