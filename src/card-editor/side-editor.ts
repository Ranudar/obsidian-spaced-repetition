import "src/card-editor/card-editor.css";

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

const MODE_ICONS: Record<InputMode, string> = { text: "⌨", ink: "✎" };

/**
 * One side of a card: a text area or an ink field, with a switch between the two.
 * Switching keeps both drafts; the mode visible at save time wins.
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
    private hintEl: HTMLDivElement;

    constructor(parent: HTMLElement, opts: SideEditorOptions) {
        this.opts = opts;
        this.initial = opts.initial;
        this.currentMode = opts.allowInk ? opts.initial.mode : "text";
        this.penSize = opts.initial.penSize;
        this.pendingStrokes = opts.initial.strokes;

        this.el = parent.createDiv({ cls: "sr-card-editor-side" });
        const header = this.el.createDiv({ cls: "sr-card-editor-side-header" });
        header.createDiv({ cls: "sr-card-editor-side-label", text: opts.label });
        if (opts.allowInk) {
            const modeSwitch = header.createDiv({ cls: "sr-card-editor-mode-switch" });
            this.addSwitchButton(modeSwitch, "text", t("CARD_EDITOR_SWITCH_TO_TEXT"));
            this.addSwitchButton(modeSwitch, "ink", t("CARD_EDITOR_SWITCH_TO_INK"));
        }

        const body = this.el.createDiv({ cls: "sr-card-editor-side-body" });
        this.textArea = body.createEl("textarea", { cls: "sr-card-editor-text" });
        this.textArea.placeholder = t("CARD_EDITOR_TEXT_PLACEHOLDER");
        this.textArea.value = opts.initial.text;
        if (opts.textDirection === TextDirection.Rtl) this.textArea.setAttr("dir", "rtl");
        this.textArea.addEventListener("input", this.onTextInput);
        this.textArea.addEventListener("keydown", this.onTextKeyDown);
        this.textArea.addEventListener("pointerdown", this.onTextPointerDown);
        // The browser decides at pointerdown whether a touch pans. Only horizontal panning is
        // turned off, so fingers still scroll the text and most pen strokes keep going in ink.
        this.textArea.toggleClass(
            "sr-pen-switch",
            opts.allowInk && opts.settings.cardEditorPenSwitchesToInk,
        );

        this.inkHost = body.createDiv({ cls: "sr-card-editor-ink" });
        this.hintEl = this.el.createDiv({ cls: "sr-card-editor-hint" });

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
        this.updateHint();
        this.opts.onChange();
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
        if (this.ink) {
            this.ink.el.removeEventListener("keydown", this.onInkKeyDown);
            this.ink.destroy();
        }
        this.el.remove();
    }

    // MARK: helpers

    private addSwitchButton(parent: HTMLElement, mode: InputMode, label: string) {
        const button = parent.createEl("button", {
            cls: "sr-card-editor-mode-button",
            text: MODE_ICONS[mode],
        });
        button.setAttr("aria-label", label);
        button.setAttr("type", "button");
        let palm = false;
        button.addEventListener("pointerdown", (evt) => (palm = this.isPalm(evt)));
        button.addEventListener("click", () => {
            // A click from the keyboard has no pointerdown before it
            const ignore = palm;
            palm = false;
            if (ignore) return;
            this.setMode(mode);
            this.focus();
        });
        this.switchButtons.set(mode, button);
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
        this.ink.el.addEventListener("keydown", this.onInkKeyDown);
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
        this.updateHint();
    }

    private updateHint() {
        let hint = "";
        if (this.replacesOther) {
            hint =
                this.currentMode === "ink"
                    ? t("CARD_EDITOR_HINT_REPLACES_TEXT")
                    : t("CARD_EDITOR_HINT_REPLACES_INK");
        }
        this.hintEl.setText(hint);
        this.hintEl.toggleClass("sr-is-hidden", hint === "");
    }

    private onInkChange(prev: Stroke[]) {
        this.updateHint();
        this.opts.onInkCommit(prev);
        this.opts.onChange();
    }

    private onTextInput = () => {
        this.updateHint();
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

    /** A pen touching the text area turns the side into ink and starts drawing right away */
    private onTextPointerDown = (evt: PointerEvent) => {
        // The palm must not focus the text area: the soft keyboard would open under the pen
        if (this.isPalm(evt)) {
            evt.preventDefault();
            return;
        }
        if (evt.pointerType !== "pen" || !this.opts.allowInk) return;
        if (!this.opts.settings.cardEditorPenSwitchesToInk) return;
        evt.preventDefault();
        // Blurred first: a focused text area that is hidden would close the soft keyboard on
        // its own, at a moment of the browser's choosing, while the stroke is being drawn
        this.textArea.blur();
        this.setMode("ink");
        this.ink?.el.focus({ preventScroll: true });
        this.ink?.beginStroke(evt);
    };

    /** Typing on a keyboard into an empty ink side switches it to text */
    private onInkKeyDown = (evt: KeyboardEvent) => {
        if (evt.key.length !== 1 || evt.ctrlKey || evt.metaKey || evt.altKey) return;
        if (this.strokes.length > 0) return;
        evt.preventDefault();
        this.setMode("text");
        this.textArea.focus();
        insertText(this.textArea, evt.key);
        this.onTextInput();
    };
}

function insertText(textArea: HTMLTextAreaElement, text: string) {
    const start = textArea.selectionStart ?? textArea.value.length;
    const end = textArea.selectionEnd ?? start;
    textArea.setRangeText(text, start, end, "end");
}

function sameStrokes(a: Stroke[], b: Stroke[]): boolean {
    return a.length === b.length && a.every((s, i) => s === b[i]);
}
