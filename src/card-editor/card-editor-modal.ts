import { App, EventRef, Modal, Notice, Platform, setIcon } from "obsidian";

import { Stroke } from "src/card-editor/core/strokes";
import { SideEditor, SideState } from "src/card-editor/side-editor";
import { CardType } from "src/data/data-structures/card/questions/question";
import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import { TextDirection } from "src/utils/strings";

/** Content of the editor; back is null for cloze cards */
export interface CardEditorSides {
    front: SideState;
    back: SideState | null;
}

/** What a side is saved as: the mode visible at save time wins */
export type SideResult =
    | { mode: "text"; text: string }
    | { mode: "ink"; strokes: Stroke[]; penSize: number; changed: boolean };

export interface CardEditorResult {
    front: SideResult;
    back: SideResult | null;
}

interface CommonOptions {
    title: string;
    textDirection?: TextDirection;
    /** Writes the card; a rejection keeps the editor open and shows a notice */
    save(result: CardEditorResult): Promise<void>;
    /** Called once after the editor has closed, saved or not */
    closed(): void;
}

export type CardEditorOptions =
    | (CommonOptions & {
          kind: "add";
          draft: CardEditorSides | null;
          /** Receives the unsaved card on close, or null when there is nothing to keep */
          keepDraft(draft: CardEditorSides | null): void;
      })
    | (CommonOptions & {
          kind: "edit";
          initial: CardEditorSides;
          cardType: CardType;
      });

const DISCARD_ARM_MS = 3000;
/** Input on the sides that is swallowed while a card is being saved */
const LOCKED_EVENTS = ["pointerdown", "mousedown", "touchstart", "click", "keydown"];
/** With pen-only on, finger presses this soon after the pen was used count as the palm */
const PALM_GUARD_MS = 500;

/**
 * The card editor, used to add new cards and to edit existing ones.
 * It only collects the sides; all file and note writes happen in opts.save().
 */
export class CardEditorModal extends Modal {
    private settings: SRSettings;
    private opts: CardEditorOptions;
    private front!: SideEditor;
    private back: SideEditor | null = null;
    /** The side the pen tools act on: the one last touched or focused */
    private activeSide: SideEditor | null = null;
    private undoStack: { side: SideEditor; prev: Stroke[] }[] = [];
    private eraser = false;
    private added = 0;
    private busy = false;
    /** Settles with true when the save in progress succeeded */
    private inFlight: Promise<boolean> | null = null;
    private isClosed = false;
    /** Set when the card on screen was saved or discarded: no draft on close */
    private dropDraft = false;
    private discardArmedAt = 0;
    private discardTimer: number | null = null;
    private cssChangeRef: EventRef | null = null;
    /** The pen is touching the screen */
    private penDown = false;
    /** When the pen was last used */
    private lastPenAt = 0;

    private sidesEl!: HTMLElement;
    private counterEl: HTMLElement | null = null;
    private eraserButton!: HTMLButtonElement;
    private undoButton!: HTMLButtonElement;
    private clearButton!: HTMLButtonElement;
    private saveButton!: HTMLButtonElement;
    private saveCloseButton: HTMLButtonElement | null = null;
    private discardButton: HTMLButtonElement | null = null;

    constructor(app: App, settings: SRSettings, opts: CardEditorOptions) {
        super(app);
        this.settings = settings;
        this.opts = opts;
    }

    private get sides(): SideEditor[] {
        return this.back ? [this.front, this.back] : [this.front];
    }

    private get isAdd(): boolean {
        return this.opts.kind === "add";
    }

    /** Every needed side has content in its visible mode */
    private get ready(): boolean {
        return this.sides.every((side) => !side.isEmpty);
    }

    private get allEmpty(): boolean {
        return this.sides.every((side) => side.isEmpty && !side.replacesOther);
    }

    onOpen(): void {
        this.modalEl.addClass("sr-card-editor-modal");
        this.hideModalChrome();

        const root = this.contentEl;
        root.empty();
        root.addClass("sr-card-editor");

        this.buildHeader(root);

        const sidesEl = (this.sidesEl = root.createDiv({ cls: "sr-card-editor-sides" }));
        // Capturing, so this runs before the sides' own listeners
        for (const type of LOCKED_EVENTS) sidesEl.addEventListener(type, this.onLockedInput, true);
        const initial = this.initialSides();
        const cloze = initial.back === null;
        this.front = this.createSide(
            sidesEl,
            cloze ? t("CARD_EDITOR_CLOZE") : t("CARD_EDITOR_FRONT"),
            initial.front,
            !cloze,
        );
        if (initial.back) {
            this.back = this.createSide(sidesEl, t("CARD_EDITOR_BACK"), initial.back, true);
        }
        this.activeSide = this.front;

        this.buildFooter(root);
        root.addEventListener("keydown", this.onKeyDown);
        this.modalEl.addEventListener("pointerdown", this.onPenActivity, true);
        this.modalEl.addEventListener("pointermove", this.onPenActivity, true);
        this.modalEl.addEventListener("pointerup", this.onPenActivity, true);
        this.modalEl.addEventListener("pointercancel", this.onPenActivity, true);
        this.guardBackground();

        // A theme change (e.g. to dark mode at night) changes the ink color
        this.cssChangeRef = this.app.workspace.on("css-change", () =>
            this.sides.forEach((side) => side.themeChanged()),
        );

        this.updateButtons();
        this.focusFront();
    }

    onClose(): void {
        this.isClosed = true;
        this.contentEl.removeEventListener("keydown", this.onKeyDown);
        this.modalEl.removeEventListener("pointerdown", this.onPenActivity, true);
        this.modalEl.removeEventListener("pointermove", this.onPenActivity, true);
        this.modalEl.removeEventListener("pointerup", this.onPenActivity, true);
        this.modalEl.removeEventListener("pointercancel", this.onPenActivity, true);
        for (const type of LOCKED_EVENTS) {
            this.sidesEl.removeEventListener(type, this.onLockedInput, true);
        }
        if (this.cssChangeRef !== null) this.app.workspace.offref(this.cssChangeRef);
        this.disarmDiscard();

        const opts = this.opts;
        const draft =
            opts.kind === "add" && !this.dropDraft && !this.allEmpty ? this.currentSides() : null;
        const finish = (saved: boolean) => {
            // A card that was being saved while closing is only kept if saving failed
            if (opts.kind === "add") opts.keepDraft(saved ? null : draft);
            opts.closed();
        };
        if (this.inFlight !== null) void this.inFlight.then(finish);
        else finish(false);

        this.sides.forEach((side) => side.destroy());
        this.contentEl.empty();
    }

    // MARK: building

    private buildHeader(root: HTMLElement) {
        const header = root.createDiv({ cls: "sr-card-editor-header" });
        header.createDiv({ cls: "sr-card-editor-title", text: this.opts.title });

        this.eraserButton = this.iconButton(header, "eraser", t("CARD_EDITOR_ERASER"), () =>
            this.setEraser(!this.eraser),
        );
        this.undoButton = this.iconButton(header, "undo-2", t("CARD_EDITOR_UNDO"), () =>
            this.undo(),
        );
        this.clearButton = this.iconButton(header, "trash-2", t("CARD_EDITOR_CLEAR_SIDE"), () =>
            this.clearSide(),
        );
        this.iconButton(header, "x", t("CARD_EDITOR_CLOSE"), () => this.close()).addClass(
            "sr-card-editor-close",
        );
    }

    private buildFooter(root: HTMLElement) {
        const footer = root.createDiv({ cls: "sr-card-editor-footer" });
        if (this.opts.kind === "add") {
            this.discardButton = this.textButton(footer, t("CARD_EDITOR_DISCARD"), () =>
                this.discard(),
            );
            this.discardButton.addClass("sr-card-editor-discard");
            this.counterEl = footer.createDiv({
                cls: ["sr-card-editor-footer-spacer", "sr-card-editor-counter"],
            });
            this.saveCloseButton = this.textButton(footer, t("CARD_EDITOR_SAVE_CLOSE"), () => {
                void this.saveAdd(true);
            });
            this.saveButton = this.textButton(footer, t("CARD_EDITOR_SAVE_NEXT"), () => {
                void this.saveAdd(false);
            });
        } else {
            this.textButton(footer, t("CANCEL"), () => this.close()).addClass(
                "sr-card-editor-cancel",
            );
            footer.createDiv({ cls: "sr-card-editor-footer-spacer" });
            this.saveButton = this.textButton(footer, t("SAVE"), () => {
                void this.saveEdit();
            });
        }
        this.saveButton.addClass("mod-cta", "sr-card-editor-save");
    }

    private initialSides(): CardEditorSides {
        if (this.opts.kind === "edit") {
            const { initial, cardType } = this.opts;
            return cardType === CardType.Cloze ? { front: initial.front, back: null } : initial;
        }
        return this.opts.draft ?? { front: this.blankSide(), back: this.blankSide() };
    }

    private blankSide(mode = this.settings.cardEditorDefaultMode): SideState {
        return { mode, text: "", strokes: [], penSize: this.settings.cardEditorPenSize };
    }

    private createSide(
        parent: HTMLElement,
        label: string,
        initial: SideState,
        allowInk: boolean,
    ): SideEditor {
        const side: SideEditor = new SideEditor(parent, {
            label,
            initial,
            allowInk,
            settings: this.settings,
            textDirection: this.opts.textDirection ?? TextDirection.Ltr,
            onChange: () => this.updateButtons(),
            onInkCommit: (prev) => {
                this.undoStack.push({ side, prev });
                this.activeSide = side;
            },
            isPalm: (evt) => this.isPalm(evt),
        });
        side.setEraser(this.eraser);
        side.el.addEventListener("pointerdown", (evt) => {
            // With pen-only on, a finger can't draw on an ink side: such a touch is the hand
            // resting on the screen, not a choice of side
            const ignored =
                this.isPalm(evt) ||
                (this.settings.cardEditorPenOnly &&
                    evt.pointerType === "touch" &&
                    side.mode === "ink");
            if (!ignored) this.activeSide = side;
        });
        side.el.addEventListener("focusin", () => (this.activeSide = side));
        return side;
    }

    /**
     * The editor has its own close button, so Obsidian's header and close button are hidden.
     * Some Obsidian mobile versions draw them outside the modal box, so siblings of the modal are
     * hidden too (only the background stays).
     */
    private hideModalChrome() {
        const hide = (el: Element) => el.addClass("sr-card-editor-chrome-hidden");
        Array.from(this.modalEl.children).forEach((el) => {
            if (el !== this.contentEl) hide(el);
        });
        Array.from(this.containerEl.children).forEach((el) => {
            if (el !== this.modalEl && !el.hasClass("modal-bg")) hide(el);
        });
    }

    /**
     * Obsidian closes a modal when its background is clicked. With pen-only on, or right after
     * the pen was used, that click is the palm or a stray tap next to the editor, which would
     * close it halfway through a card; the editor is closed with ✕, Esc or its buttons then.
     */
    private guardBackground() {
        const bg = this.containerEl.querySelector(".modal-bg");
        if (bg === null) return;
        let blocked = false;
        const block = (evt: Event) => {
            if (evt.type === "pointerdown") {
                blocked =
                    this.settings.cardEditorPenOnly ||
                    this.penDown ||
                    Date.now() - this.lastPenAt < PALM_GUARD_MS;
            }
            if (!blocked) return;
            evt.preventDefault();
            evt.stopImmediatePropagation();
        };
        // Capturing, so this runs before Obsidian's own listeners
        for (const type of ["pointerdown", "mousedown", "click"]) {
            bg.addEventListener(type, block, true);
        }
    }

    // MARK: actions

    private setEraser(on: boolean) {
        this.eraser = on;
        this.sides.forEach((side) => side.setEraser(on));
        this.updateButtons();
    }

    /** Undoes the last ink change, on whichever side it was */
    private undo() {
        if (this.busy) return;
        const step = this.undoStack.pop();
        if (!step) return;
        step.side.setMode("ink");
        step.side.setStrokes(step.prev);
        this.activeSide = step.side;
    }

    /** Clears the active ink side, or the first ink side if the active one is text */
    private clearSide() {
        if (this.busy) return;
        const side =
            this.activeSide?.mode === "ink"
                ? this.activeSide
                : this.sides.find((s) => s.mode === "ink");
        side?.clear();
    }

    /** The first tap arms the button, a second one within 3 s discards the card */
    private discard() {
        if (this.busy || !this.discardButton) return;
        if (Date.now() - this.discardArmedAt < DISCARD_ARM_MS) {
            this.dropDraft = true;
            this.close();
            return;
        }
        this.disarmDiscard();
        this.discardArmedAt = Date.now();
        this.discardButton.setText(t("CARD_EDITOR_DISCARD_CONFIRM"));
        this.discardButton.addClass("is-armed");
        this.discardTimer = activeWindow.setTimeout(() => this.disarmDiscard(), DISCARD_ARM_MS);
    }

    /** Back to an unarmed Discard button: after the timeout and for every new card */
    private disarmDiscard() {
        if (this.discardTimer !== null) activeWindow.clearTimeout(this.discardTimer);
        this.discardTimer = null;
        this.discardArmedAt = 0;
        this.discardButton?.setText(t("CARD_EDITOR_DISCARD"));
        this.discardButton?.removeClass("is-armed");
    }

    private async saveAdd(close: boolean) {
        if (this.busy) return;
        const saved = await this.runSave();
        if (!saved || this.isClosed) return;
        this.added++;
        if (close) {
            this.dropDraft = true;
            this.close();
            return;
        }
        // Next card: same input mode per side, so pen users keep writing
        this.undoStack = [];
        this.disarmDiscard();
        this.sides.forEach((side) => side.reset(this.blankSide(side.mode)));
        this.activeSide = this.front;
        this.updateButtons();
        this.focusFront();
    }

    /**
     * Focuses the front side. On mobile a text side is not focused: the soft keyboard would
     * open, and close again under the pen (moving the sides) when the user writes by hand.
     */
    private focusFront() {
        if (Platform.isMobile && this.front.mode === "text") return;
        this.front.focus();
    }

    private async saveEdit() {
        if (this.busy) return;
        const saved = await this.runSave();
        if (saved && !this.isClosed) this.close();
    }

    /** Calls opts.save() once at a time; resolves to whether it succeeded */
    private async runSave(): Promise<boolean> {
        if (!this.ready) {
            new Notice(t("CARD_EDITOR_SIDES_EMPTY"));
            return false;
        }
        this.busy = true;
        this.lockSides(true);
        this.updateButtons();
        const result = this.result();
        this.inFlight = this.opts.save(result).then(
            () => true,
            (err) => {
                console.error("SR: saving the card failed", err);
                new Notice(t("CARD_EDITOR_SAVE_FAILED", { error: String(err) }));
                return false;
            },
        );
        const ok = await this.inFlight;
        this.inFlight = null;
        this.busy = false;
        if (!this.isClosed) {
            this.lockSides(false);
            this.updateButtons();
        }
        return ok;
    }

    /**
     * While a card is being saved its sides can't be changed: the saved content is what Save &
     * next clears afterwards, and what Save & close closes the editor over.
     */
    private lockSides(locked: boolean) {
        this.sidesEl.toggleClass("is-locked", locked);
        this.sidesEl.setAttr("aria-busy", locked);
        this.sidesEl.querySelectorAll("textarea").forEach((ta) => (ta.readOnly = locked));
    }

    /** Swallows input on the sides while they are locked (see lockSides()) */
    private onLockedInput = (evt: Event) => {
        if (!this.busy) return;
        if (evt.type === "keydown") {
            // Esc still closes the editor, and shortcuts reach onKeyDown, which ignores them
            // while saving; a read-only text area takes no typing
            const { key, ctrlKey, metaKey } = evt as KeyboardEvent;
            if (key === "Escape" || ctrlKey || metaKey) return;
            evt.stopPropagation();
            return;
        }
        evt.preventDefault();
        evt.stopPropagation();
    };

    private onKeyDown = (evt: KeyboardEvent) => {
        const mod = evt.ctrlKey || evt.metaKey;
        if (!mod || evt.altKey) return;
        if (evt.key === "Enter") {
            evt.preventDefault();
            if (this.isAdd) void this.saveAdd(false);
            else void this.saveEdit();
        } else if (evt.key.toLowerCase() === "z" && !evt.shiftKey) {
            // Text areas keep their own undo
            // (instanceOf works across windows, e.g. an editor opened in a popout)
            if ((evt.target as Node | null)?.instanceOf(HTMLTextAreaElement)) return;
            evt.preventDefault();
            this.undo();
        }
    };

    // MARK: state

    private currentSides(): CardEditorSides {
        return { front: this.front.state, back: this.back?.state ?? null };
    }

    private result(): CardEditorResult {
        return { front: sideResult(this.front), back: this.back ? sideResult(this.back) : null };
    }

    private updateButtons() {
        const anyInk = this.sides.some((side) => side.mode === "ink");
        if (!anyInk && this.eraser) {
            this.eraser = false;
            this.sides.forEach((side) => side.setEraser(false));
        }
        this.eraserButton.disabled = !anyInk;
        this.eraserButton.toggleClass("is-active", this.eraser);
        this.eraserButton.setAttr("aria-pressed", this.eraser);
        this.undoButton.disabled = this.busy || !anyInk || this.undoStack.length === 0;
        this.clearButton.disabled =
            this.busy || !this.sides.some((side) => side.mode === "ink" && !side.isEmpty);

        // Callbacks from the sides can arrive while the footer is still being built
        if (!this.saveButton) return;
        this.saveButton.disabled = this.busy || !this.ready;
        // An empty card is closed with ✕, Esc or Discard, not with a button that looks like saving
        if (this.saveCloseButton) this.saveCloseButton.disabled = this.busy || !this.ready;
        if (this.discardButton) this.discardButton.disabled = this.busy;
        if (this.counterEl) {
            this.counterEl.setText(
                this.added > 0 ? t("CARD_EDITOR_CARDS_ADDED", { count: this.added }) : "",
            );
        }
    }

    private iconButton(
        parent: HTMLElement,
        icon: string,
        label: string,
        onClick: () => void,
    ): HTMLButtonElement {
        const button = parent.createEl("button", {
            cls: ["sr-card-editor-icon-button", "clickable-icon"],
        });
        button.setAttr("aria-label", label);
        button.setAttr("type", "button");
        setIcon(button, icon);
        const isPalm = this.palmGuard(button);
        button.addEventListener("click", (evt) => {
            evt.stopPropagation();
            if (!isPalm()) onClick();
        });
        return button;
    }

    private textButton(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
        const button = parent.createEl("button", { text });
        button.setAttr("type", "button");
        const isPalm = this.palmGuard(button);
        button.addEventListener("click", () => {
            if (!isPalm()) onClick();
        });
        return button;
    }

    /**
     * Records pen use anywhere in the editor, for isPalm(). Only contact counts: a pen hovering
     * over the screen also sends pointermove events, and would block finger taps all along.
     */
    private onPenActivity = (evt: PointerEvent) => {
        if (evt.pointerType !== "pen") return;
        if (evt.type === "pointermove" && !this.penDown && evt.buttons === 0) return;
        this.penDown = evt.type === "pointerdown" || (this.penDown && evt.type === "pointermove");
        this.lastPenAt = Date.now();
    };

    /**
     * With pen-only on, a finger press while the pen is down or was just used is the palm resting
     * on the screen, not a tap.
     */
    private isPalm(evt: PointerEvent): boolean {
        return (
            this.settings.cardEditorPenOnly &&
            evt.pointerType === "touch" &&
            (this.penDown || Date.now() - this.lastPenAt < PALM_GUARD_MS)
        );
    }

    /** Returns whether the button's current click comes from a palm press (see isPalm()) */
    private palmGuard(button: HTMLButtonElement): () => boolean {
        let palm = false;
        button.addEventListener("pointerdown", (evt) => (palm = this.isPalm(evt)));
        return () => {
            const result = palm;
            // A click from the keyboard has no pointerdown before it
            palm = false;
            return result;
        };
    }
}

function sideResult(side: SideEditor): SideResult {
    const { mode, text, strokes, penSize } = side.state;
    return mode === "ink" ? { mode, strokes, penSize, changed: side.inkChanged } : { mode, text };
}
