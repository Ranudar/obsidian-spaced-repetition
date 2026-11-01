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

/** What a side is saved as: its typed text and its handwriting (null when it has no strokes) */
export type SideResult = {
    text: string;
    ink: { strokes: Stroke[]; penSize: number; changed: boolean } | null;
};

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
          /** Deletes the card from its note; a rejection keeps the editor open with a notice */
          delete(): Promise<void>;
      });

const DISCARD_ARM_MS = 3000;
/** Input on the sides that is swallowed while a card is being saved */
const LOCKED_EVENTS = ["pointerdown", "mousedown", "touchstart", "click", "keydown"];
/** With pen-only on, finger presses this soon after the pen was used count as the palm */
const PALM_GUARD_MS = 500;
/** Pen thickness steps of the toolbar button, as factors of the pen thickness setting */
const PEN_SIZE_STEPS = [
    { factor: 0.6, cls: "is-thin", label: "CARD_EDITOR_PEN_THIN" },
    { factor: 1, cls: "is-medium", label: "CARD_EDITOR_PEN_MEDIUM" },
    { factor: 1.6, cls: "is-thick", label: "CARD_EDITOR_PEN_THICK" },
] as const;
const DEFAULT_PEN_SIZE_STEP = 1;

/**
 * The card editor, used to add new cards and to edit existing ones.
 * It only collects the sides; all file and note writes happen in opts.save().
 */
export class CardEditorModal extends Modal {
    private settings: SRSettings;
    private opts: CardEditorOptions;
    private front!: SideEditor;
    private back: SideEditor | null = null;
    /** The side Clear acts on: the one last touched or focused */
    private activeSide: SideEditor | null = null;
    /** Ink changes, newest last; a cleared side also keeps its text (see clearSide()) */
    private undoStack: { side: SideEditor; prev: Stroke[]; prevText?: string }[] = [];
    private eraser = false;
    /** Index into PEN_SIZE_STEPS; kept for this editor only */
    private penSizeStep = DEFAULT_PEN_SIZE_STEP;
    private added = 0;
    private busy = false;
    /** Settles with true when the save in progress succeeded */
    private inFlight: Promise<boolean> | null = null;
    private isClosed = false;
    /** Set when the card on screen was saved or deleted: no draft on close */
    private dropDraft = false;
    private discardArmedAt = 0;
    private discardTimer: number | null = null;
    private cssChangeRef: EventRef | null = null;
    /** The pen is touching the screen */
    private penDown = false;
    /** When the pen was last used */
    private lastPenAt = 0;
    /** On mobile, the window size the editor's height was taken from (see keepSteadyHeight()) */
    private steadySize: { width: number; height: number } | null = null;

    private sidesEl!: HTMLElement;
    private counterEl: HTMLElement | null = null;
    private penSizeButton!: HTMLButtonElement;
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

    /** Every needed side has text or ink */
    private get ready(): boolean {
        return this.sides.every((side) => !side.isEmpty);
    }

    private get allEmpty(): boolean {
        return this.sides.every((side) => side.isEmpty);
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
        this.setActiveSide(this.front);
        // New strokes follow the toolbar's size, also on a card being edited (whose file has its
        // own size) and on a restored draft (saved with the size picked then); every stroke
        // already written keeps its own size
        const penSize = this.penSize;
        this.sides.forEach((side) => side.setPenSize(penSize));

        this.buildFooter(root);
        root.addEventListener("keydown", this.onKeyDown);
        this.modalEl.addEventListener("pointerdown", this.onPenActivity, true);
        this.modalEl.addEventListener("pointermove", this.onPenActivity, true);
        this.modalEl.addEventListener("pointerup", this.onPenActivity, true);
        this.modalEl.addEventListener("pointercancel", this.onPenActivity, true);
        this.guardBackground();
        this.keepSteadyHeight();

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
        if (this.steadySize !== null) activeWindow.removeEventListener("resize", this.onResize);
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
        const titleEl = header.createDiv({ cls: "sr-card-editor-title-wrap" });
        titleEl.createDiv({ cls: "sr-card-editor-title", text: this.opts.title });
        if (this.opts.kind === "add") {
            // Cards added in this session, as a small badge so it never pushes buttons away
            this.counterEl = titleEl.createDiv({
                cls: ["sr-card-editor-counter", "sr-is-hidden"],
            });
            this.counterEl.setAttr("role", "status");
        }

        this.penSizeButton = this.iconButton(header, null, t("CARD_EDITOR_PEN_SIZE"), () =>
            this.cyclePenSize(),
        );
        this.penSizeButton.addClass("sr-card-editor-pen-size");
        this.penSizeButton.createSpan({ cls: "sr-card-editor-pen-dot" });
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
        // Closing without saving is the ✕ in the header
        this.discardButton = this.textButton(footer, t("CARD_EDITOR_DISCARD"), () => {
            void this.discard();
        });
        this.discardButton.addClass("sr-card-editor-discard");
        footer.createDiv({ cls: "sr-card-editor-footer-spacer" });
        if (this.opts.kind === "add") {
            this.saveCloseButton = this.textButton(footer, t("CARD_EDITOR_SAVE_CLOSE"), () => {
                void this.saveAdd(true);
            });
            this.saveButton = this.textButton(footer, t("CARD_EDITOR_SAVE_NEXT"), () => {
                void this.saveAdd(false);
            });
        } else {
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

    private blankSide(): SideState {
        return { text: "", strokes: [], penSize: this.penSize };
    }

    /** Pen thickness for new ink: the setting, scaled by the toolbar's thin / medium / thick */
    private get penSize(): number {
        const size = this.settings.cardEditorPenSize * PEN_SIZE_STEPS[this.penSizeStep].factor;
        return Math.round(size * 10) / 10;
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
            onInkCommit: (prev, prevText) => {
                this.undoStack.push({ side, prev, prevText });
                this.setActiveSide(side);
            },
            isPalm: (evt) => this.isPalm(evt),
        });
        side.setEraser(this.eraser);
        side.el.addEventListener("pointerdown", (evt) => {
            // With pen-only on, a finger can't draw in the ink field: such a touch is the hand
            // resting on the screen, not a choice of side
            const inInk = side.inkEl?.contains(evt.target as Node) ?? false;
            const ignored =
                this.isPalm(evt) ||
                (this.settings.cardEditorPenOnly && evt.pointerType === "touch" && inInk);
            if (ignored) return;
            this.setActiveSide(side);
            // The ink field takes the focus off the text area: the soft keyboard closes before
            // the pen writes, and Ctrl/Cmd+Z undoes the ink, not the typing
            if (inInk) side.focusInk();
        });
        side.el.addEventListener("focusin", () => this.setActiveSide(side));
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

    /**
     * On phones and tablets the soft keyboard makes the window lower while it is open: tapping a
     * text area opens it, writing in an ink field closes it. An editor sized to the window
     * would then grow and shrink, and both sides with it. Instead it keeps the height of the
     * window without keyboard, and scrolls while the keyboard covers its lower part.
     * A window that gets wider or narrower (rotation, split screen) or higher starts over.
     */
    private keepSteadyHeight() {
        if (!Platform.isMobile) return;
        this.containerEl.addClass("sr-card-editor-container");
        this.steadySize = { width: 0, height: 0 };
        this.onResize();
        activeWindow.addEventListener("resize", this.onResize);
    }

    private onResize = () => {
        const size = this.steadySize;
        if (size === null) return;
        const { innerWidth: width, innerHeight: height } = activeWindow;
        // Only lower: the keyboard opened
        if (width === size.width && height <= size.height) return;
        this.steadySize = { width, height };
        this.modalEl.setCssProps({ "--sr-card-editor-height": `${height}px` });
    };

    // MARK: actions

    /**
     * Medium → thick → thin. Applies to the strokes written from now on; every stroke keeps the
     * thickness it was written with.
     */
    private cyclePenSize() {
        if (this.busy) return;
        this.penSizeStep = (this.penSizeStep + 1) % PEN_SIZE_STEPS.length;
        const size = this.penSize;
        this.sides.forEach((side) => side.setPenSize(size));
        this.updateButtons();
    }

    private setEraser(on: boolean) {
        this.eraser = on;
        this.sides.forEach((side) => side.setEraser(on));
        this.updateButtons();
    }

    /**
     * Undoes the last ink change, on whichever side it was. Undoing "Clear side" restores the
     * side's text as well, unless something was typed since; typing is undone by the text area
     * itself.
     */
    private undo() {
        if (this.busy) return;
        const step = this.undoStack.pop();
        if (!step) return;
        step.side.setStrokes(step.prev);
        // Not over text typed since the clear: setText would lose it for good
        if (step.prevText !== undefined && step.side.text === "") step.side.setText(step.prevText);
        this.setActiveSide(step.side);
    }

    /** Clears text and ink of the active side, as one undo step */
    private clearSide() {
        if (this.busy) return;
        this.activeSide?.clear();
    }

    private setActiveSide(side: SideEditor) {
        if (side === this.activeSide) return;
        this.activeSide = side;
        this.updateButtons();
    }

    /**
     * The first tap arms the Delete button, a second one within 3 s deletes the card: a new one is
     * dropped, an existing one removed from its note
     */
    private async discard() {
        if (this.busy || !this.discardButton) return;
        // A new card with nothing on it: nothing to lose, no second tap
        if (this.opts.kind === "add" && this.allEmpty) {
            this.dropDraft = true;
            this.close();
            return;
        }
        if (Date.now() - this.discardArmedAt < DISCARD_ARM_MS) {
            this.disarmDiscard();
            if (this.opts.kind === "edit") {
                const opts = this.opts;
                this.busy = true;
                this.updateButtons();
                try {
                    await opts.delete();
                } catch (err) {
                    console.error("SR: deleting the card failed", err);
                    new Notice(t("CARD_EDITOR_DELETE_FAILED", { error: String(err) }));
                    return;
                } finally {
                    this.busy = false;
                    if (!this.isClosed) this.updateButtons();
                }
            }
            this.dropDraft = true;
            if (!this.isClosed) this.close();
            return;
        }
        this.disarmDiscard();
        this.discardArmedAt = Date.now();
        this.discardButton.setText(t("CARD_EDITOR_DISCARD_CONFIRM"));
        this.discardButton.addClass("is-armed");
        this.discardTimer = activeWindow.setTimeout(() => this.disarmDiscard(), DISCARD_ARM_MS);
    }

    /** Back to an unarmed Delete button: after the timeout and for every new card */
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
        this.undoStack = [];
        this.disarmDiscard();
        this.sides.forEach((side) => side.reset(this.blankSide()));
        this.setActiveSide(this.front);
        this.updateButtons();
        this.focusFront();
    }

    /**
     * Focuses the front text area. Not on mobile: the soft keyboard would open, and close again
     * under the pen when the user writes by hand. There a text area that still has the focus
     * (e.g. typed in before "Save & next") loses it instead, closing the keyboard.
     */
    private focusFront() {
        if (!Platform.isMobile) {
            this.front.focus();
            return;
        }
        const focused = this.sidesEl.ownerDocument.activeElement;
        if (focused?.instanceOf(HTMLTextAreaElement) && this.sidesEl.contains(focused)) {
            focused.blur();
        }
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
        // Cloze cards have no ink field
        const hasInk = this.back !== null;
        const step = PEN_SIZE_STEPS[this.penSizeStep];
        this.penSizeButton.disabled = this.busy || !hasInk;
        for (const s of PEN_SIZE_STEPS) this.penSizeButton.toggleClass(s.cls, s === step);
        this.penSizeButton.setAttr("aria-label", `${t("CARD_EDITOR_PEN_SIZE")}: ${t(step.label)}`);
        this.eraserButton.disabled = !hasInk;
        this.eraserButton.toggleClass("is-active", this.eraser);
        this.eraserButton.setAttr("aria-pressed", this.eraser);
        this.undoButton.disabled = this.busy || this.undoStack.length === 0;
        this.clearButton.disabled = this.busy || (this.activeSide?.isEmpty ?? true);

        // Callbacks from the sides can arrive while the footer is still being built
        if (!this.saveButton) return;
        this.saveButton.disabled = this.busy || !this.ready;
        // An empty card is closed with ✕, Esc or Delete, not with a button that looks like saving
        if (this.saveCloseButton) this.saveCloseButton.disabled = this.busy || !this.ready;
        if (this.discardButton) this.discardButton.disabled = this.busy;
        if (this.counterEl) {
            this.counterEl.setText(
                this.added > 0 ? t("CARD_EDITOR_ADDED_BADGE", { count: this.added }) : "",
            );
            this.counterEl.toggleClass("sr-is-hidden", this.added === 0);
        }
    }

    private iconButton(
        parent: HTMLElement,
        icon: string | null,
        label: string,
        onClick: () => void,
    ): HTMLButtonElement {
        const button = parent.createEl("button", {
            cls: ["sr-card-editor-icon-button", "clickable-icon"],
        });
        button.setAttr("aria-label", label);
        button.setAttr("type", "button");
        if (icon !== null) setIcon(button, icon);
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
    const { text, strokes, penSize } = side.state;
    return {
        text,
        ink: strokes.length > 0 ? { strokes, penSize, changed: side.inkChanged } : null,
    };
}
