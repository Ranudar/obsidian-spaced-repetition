import "src/card-editor/card-editor.css";

import { Stroke } from "src/card-editor/core/strokes";
import { InkField } from "src/card-editor/ink-field";
import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
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
    initial: SideState;
    /** false for cloze cards: text only, no ink field */
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
}

/**
 * One side of a card: a text area of a few lines on top, for typing, and an ink field filling the
 * rest of the box, for the pen. Both are saved. The text area has a fixed height and scrolls
 * inside itself, so nothing moves while typing or writing.
 */
export class SideEditor {
    readonly el: HTMLDivElement;

    private opts: SideEditorOptions;
    private initial: SideState;
    private penSize: number;
    private eraser = false;
    private textArea: HTMLTextAreaElement;
    private ink: InkField | null = null;

    constructor(parent: HTMLElement, opts: SideEditorOptions) {
        this.opts = opts;
        this.initial = withOwnSizes(opts.initial);
        this.penSize = opts.initial.penSize;

        this.el = parent.createDiv({ cls: "sr-card-editor-side" });
        this.el.toggleClass("is-text-only", !opts.allowInk);
        const header = this.el.createDiv({ cls: "sr-card-editor-side-header" });
        header.createDiv({ cls: "sr-card-editor-side-label", text: opts.label });

        const body = this.el.createDiv({ cls: "sr-card-editor-side-body" });
        this.textArea = body.createEl("textarea", { cls: "sr-card-editor-text" });
        this.textArea.placeholder = t("CARD_EDITOR_TEXT_PLACEHOLDER");
        this.textArea.value = opts.initial.text;
        this.textArea.setAttr("aria-label", opts.label);
        if (opts.textDirection === TextDirection.Rtl) this.textArea.setAttr("dir", "rtl");
        this.textArea.addEventListener("input", this.onTextInput);
        this.textArea.addEventListener("keydown", this.onTextKeyDown);
        this.textArea.addEventListener("pointerdown", this.onTextPointerDown);

        if (opts.allowInk) {
            const s = opts.settings;
            const inkHost = body.createDiv({ cls: "sr-card-editor-ink" });
            this.ink = new InkField(inkHost, {
                placeholder: t("CARD_EDITOR_INK_PLACEHOLDER"),
                style: { size: this.penSize },
                guide: s.cardEditorGuide,
                guideSpacing: s.cardEditorGuideSpacing,
                eraserActive: () => this.eraser,
                onChange: (prev) => this.onInkChange(prev),
            });
            this.ink.setStrokes(this.initial.strokes);
        }
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

    /** The element ink is written on, null without ink (cloze) */
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
        if (this.ink) {
            this.ink.setStyle({ size: state.penSize });
            this.ink.setStrokes(state.strokes);
        }
        this.opts.onChange();
    }

    setEraser(on: boolean): void {
        this.eraser = on;
    }

    /** Re-reads the theme's colors, e.g. after switching to dark mode */
    themeChanged(): void {
        this.ink?.themeChanged();
    }

    /** Focuses the text area (on mobile this opens the soft keyboard) */
    focus(): void {
        this.textArea.focus();
    }

    /** Focuses the ink field, moving the focus off the text area without scrolling */
    focusInk(): void {
        this.ink?.el.focus({ preventScroll: true });
    }

    destroy(): void {
        this.textArea.removeEventListener("input", this.onTextInput);
        this.textArea.removeEventListener("keydown", this.onTextKeyDown);
        this.textArea.removeEventListener("pointerdown", this.onTextPointerDown);
        this.ink?.destroy();
        this.el.remove();
    }

    // MARK: helpers

    private onInkChange(prev: Stroke[]) {
        this.opts.onInkCommit(prev);
        this.opts.onChange();
    }

    private onTextInput = () => {
        this.opts.onChange();
    };

    private onTextKeyDown = (evt: KeyboardEvent) => {
        if (evt.key === "Tab" && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
            evt.preventDefault();
            insertText(this.textArea, "\t");
            this.onTextInput();
        }
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
