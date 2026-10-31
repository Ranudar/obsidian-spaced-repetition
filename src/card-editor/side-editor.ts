import "src/card-editor/card-editor.css";
import { Platform, setIcon } from "obsidian";

import { Stroke } from "src/card-editor/core/strokes";
import { InkField } from "src/card-editor/ink-field";
import { CardEditorInputMode, SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import { TextDirection } from "src/utils/strings";

export type InputMode = CardEditorInputMode;

/** Content of one side: both drafts are kept, `mode` says which one is shown (and saved) */
export interface SideState {
    mode: InputMode;
    text: string;
    strokes: Stroke[];
    /** Pen thickness the strokes are drawn and saved with */
    penSize: number;
}

export interface SideEditorOptions {
    label: string;
    initial: SideState;
    /** false for cloze cards: text only, no mode switch */
    allowInk: boolean;
    settings: SRSettings;
    textDirection: TextDirection;
    /** Called after any change of text, strokes or mode */
    onChange(): void;
    /** Called after every ink change with the strokes before it (for undo) */
    onInkCommit(prev: Stroke[]): void;
    /** Whether a press is the palm resting on the screen (pen-only on); it is then ignored */
    isPalm?(evt: PointerEvent): boolean;
}

const MODE_ICONS: Record<InputMode, string> = { text: "keyboard", ink: "pen-line" };

/**
 * One side of a card: a text area or an ink field, with a switch between the two.
 * Switching keeps both drafts; the mode visible at save time wins. A dot on the switch shows that
 * the hidden mode holds a draft, which saving would replace.
 *
 * Both modes fill the same box and switching only swaps its content, so nothing moves.
 */
export class SideEditor {
    readonly el: HTMLDivElement;

    private opts: SideEditorOptions;
    private initial: SideState;
    private currentMode: InputMode;
    private penSize: number;
    private eraser = false;
    private textArea: HTMLTextAreaElement;
    private inkHost: HTMLDivElement;
    private ink: InkField | null = null;
    /** Strokes while the ink field has not been created yet */
    private pendingStrokes: Stroke[];
    private switchButtons = new Map<InputMode, HTMLButtonElement>();

    constructor(parent: HTMLElement, opts: SideEditorOptions) {
        this.opts = opts;
        this.initial = withOwnSizes(opts.initial);
        this.currentMode = opts.allowInk ? opts.initial.mode : "text";
        this.penSize = opts.initial.penSize;
        this.pendingStrokes = this.initial.strokes;

        this.el = parent.createDiv({ cls: "sr-card-editor-side" });
        const header = this.el.createDiv({ cls: "sr-card-editor-side-header" });
        header.createDiv({ cls: "sr-card-editor-side-label", text: opts.label });
        if (opts.allowInk) {
            const modeSwitch = header.createDiv({ cls: "sr-card-editor-mode-switch" });
            modeSwitch.setAttr("role", "group");
            modeSwitch.setAttr("aria-label", opts.label);
            this.addSwitchButton(modeSwitch, "text", t("CARD_EDITOR_MODE_TEXT"));
            this.addSwitchButton(modeSwitch, "ink", t("CARD_EDITOR_MODE_INK"));
        }

        const body = this.el.createDiv({ cls: "sr-card-editor-side-body" });
        this.textArea = body.createEl("textarea", { cls: "sr-card-editor-text" });
        this.textArea.placeholder = t("CARD_EDITOR_TEXT_PLACEHOLDER");
        this.textArea.value = opts.initial.text;
        if (opts.textDirection === TextDirection.Rtl) this.textArea.setAttr("dir", "rtl");
        this.textArea.addEventListener("input", this.onTextInput);
        this.textArea.addEventListener("keydown", this.onTextKeyDown);
        this.textArea.addEventListener("pointerdown", this.onTextPointerDown);

        this.inkHost = body.createDiv({ cls: "sr-card-editor-ink" });

        this.showMode();
    }

    get mode(): InputMode {
        return this.currentMode;
    }

    get strokes(): Stroke[] {
        return this.ink ? this.ink.strokes : this.pendingStrokes;
    }

    get text(): string {
        return this.textArea.value;
    }

    get state(): SideState {
        return {
            mode: this.currentMode,
            text: this.text,
            strokes: this.strokes,
            penSize: this.penSize,
        };
    }

    /** Nothing to save in the visible mode */
    get isEmpty(): boolean {
        return this.currentMode === "ink" ? this.strokes.length === 0 : this.text.trim() === "";
    }

    /** The strokes differ from the ones the side was opened with */
    get inkChanged(): boolean {
        return !sameStrokes(this.strokes, this.initial.strokes);
    }

    /** Saving would drop the draft of the hidden mode */
    get replacesOther(): boolean {
        return this.currentMode === "ink" ? this.text.trim() !== "" : this.strokes.length > 0;
    }

    setMode(mode: InputMode): void {
        if (mode === "ink" && !this.opts.allowInk) return;
        if (mode === this.currentMode) return;
        this.currentMode = mode;
        this.showMode();
        this.opts.onChange();
    }

    setStrokes(strokes: Stroke[]): void {
        if (this.ink) this.ink.setStrokes(strokes);
        else this.pendingStrokes = strokes;
        this.updateDraftDot();
        this.opts.onChange();
    }

    /** Pen thickness of new strokes on this side; strokes already written keep theirs */
    setPenSize(size: number): void {
        if (size === this.penSize) return;
        this.penSize = size;
        this.ink?.setStyle({ size });
    }

    /** Clears the visible mode; ink clearing is reported to onInkCommit so it can be undone */
    clear(): void {
        if (this.currentMode === "ink") {
            if (this.ink) this.ink.clear();
            else if (this.pendingStrokes.length > 0) {
                const prev = this.pendingStrokes;
                this.pendingStrokes = [];
                this.onInkChange(prev);
            }
        } else if (this.text !== "") {
            this.textArea.value = "";
            this.onTextInput();
        }
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
        } else {
            this.pendingStrokes = state.strokes;
        }
        this.currentMode = this.opts.allowInk ? state.mode : "text";
        this.showMode();
        this.opts.onChange();
    }

    setEraser(on: boolean): void {
        this.eraser = on;
    }

    /** Re-reads the theme's colors, e.g. after switching to dark mode */
    themeChanged(): void {
        this.ink?.themeChanged();
    }

    focus(): void {
        if (this.currentMode === "ink") this.ink?.el.focus();
        else this.textArea.focus();
    }

    destroy(): void {
        this.textArea.removeEventListener("input", this.onTextInput);
        this.textArea.removeEventListener("keydown", this.onTextKeyDown);
        this.textArea.removeEventListener("pointerdown", this.onTextPointerDown);
        this.ink?.destroy();
        this.el.remove();
    }

    // MARK: helpers

    private addSwitchButton(parent: HTMLElement, mode: InputMode, label: string) {
        const button = parent.createEl("button", { cls: "sr-card-editor-mode-button" });
        button.setAttr("type", "button");
        setIcon(button.createSpan({ cls: "sr-card-editor-mode-icon" }), MODE_ICONS[mode]);
        button.createSpan({ cls: "sr-card-editor-mode-label", text: label });
        // Absolutely positioned, so showing it moves nothing
        button.createSpan({ cls: "sr-card-editor-mode-dot" });
        let palm = false;
        button.addEventListener("pointerdown", (evt) => (palm = this.isPalm(evt)));
        button.addEventListener("click", () => {
            // A click from the keyboard has no pointerdown before it
            const ignore = palm;
            palm = false;
            if (ignore) return;
            this.switchTo(mode);
        });
        this.switchButtons.set(mode, button);
    }

    /**
     * Switch button. On mobile it never focuses the text area, so the soft keyboard doesn't pop
     * up; tapping the text area itself does. On desktop, Text focuses the text area so typing can
     * start right away. A focused text area is let go when it is hidden.
     */
    private switchTo(mode: InputMode) {
        if (mode === "ink" && this.textArea.ownerDocument.activeElement === this.textArea) {
            this.textArea.blur();
        }
        this.setMode(mode);
        if (this.currentMode === "ink") this.ink?.el.focus({ preventScroll: true });
        else if (!Platform.isMobile) this.textArea.focus();
    }

    /** The ink field (and its canvas) is only created once the side is first shown as ink */
    private ensureInk(): InkField {
        if (this.ink) return this.ink;
        const s = this.opts.settings;
        this.ink = new InkField(this.inkHost, {
            placeholder: t("CARD_EDITOR_INK_PLACEHOLDER"),
            style: { size: this.penSize },
            guide: s.cardEditorGuide,
            guideSpacing: s.cardEditorGuideSpacing,
            penOnly: s.cardEditorPenOnly,
            eraserActive: () => this.eraser,
            onChange: (_, prev) => this.onInkChange(prev),
        });
        this.ink.setStrokes(this.pendingStrokes);
        return this.ink;
    }

    private showMode() {
        const ink = this.currentMode === "ink";
        if (ink) this.ensureInk();
        this.el.toggleClass("is-ink", ink);
        this.el.toggleClass("is-text", !ink);
        this.textArea.toggleClass("sr-is-hidden", ink);
        this.inkHost.toggleClass("sr-is-hidden", !ink);
        for (const [mode, button] of this.switchButtons) {
            button.toggleClass("is-active", mode === this.currentMode);
            button.setAttr("aria-pressed", mode === this.currentMode);
        }
        this.updateDraftDot();
    }

    /** Marks the switch button of the hidden mode while that mode holds a draft */
    private updateDraftDot() {
        const replaces = this.replacesOther;
        for (const [mode, button] of this.switchButtons) {
            const dot = replaces && mode !== this.currentMode;
            button.toggleClass("has-draft", dot);
            if (dot) {
                button.setAttr(
                    "aria-description",
                    mode === "text"
                        ? t("CARD_EDITOR_HINT_REPLACES_TEXT")
                        : t("CARD_EDITOR_HINT_REPLACES_INK"),
                );
            } else {
                button.removeAttribute("aria-description");
            }
        }
    }

    private onInkChange(prev: Stroke[]) {
        this.updateDraftDot();
        this.opts.onInkCommit(prev);
        this.opts.onChange();
    }

    private onTextInput = () => {
        this.updateDraftDot();
        this.opts.onChange();
    };

    private onTextKeyDown = (evt: KeyboardEvent) => {
        if (evt.key === "Tab" && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
            evt.preventDefault();
            insertText(this.textArea, "\t");
            this.onTextInput();
        }
    };

    private isPalm(evt: PointerEvent): boolean {
        return this.opts.isPalm?.(evt) ?? false;
    }

    /** The palm must not focus the text area: the soft keyboard would open under the pen */
    private onTextPointerDown = (evt: PointerEvent) => {
        if (this.isPalm(evt)) evt.preventDefault();
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
