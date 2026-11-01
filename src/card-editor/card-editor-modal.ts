import { App, EventRef, Modal, Notice, Platform, setIcon } from "obsidian";

import { Stroke } from "src/card-editor/core/strokes";
import { SideEditor, SideEditorOptions, SideState } from "src/card-editor/side-editor";
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

const DELETE_ARM_MS = 3000;
/** Input on the sides that is swallowed while a card is being saved */
const LOCKED_EVENTS = ["pointerdown", "mousedown", "touchstart", "click", "keydown"];
/** Pointer events that tell when the pen is used, see onPenActivity() */
const PEN_EVENTS = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
/** With pen-only on, finger presses this soon after the pen was used count as the palm */
const PALM_GUARD_MS = 500;
/**
 * Pen thickness steps of the size button, as factors of the pen thickness setting, with the
 * diameter of the button's dot in pixels
 */
const PEN_SIZE_STEPS = [
    { factor: 0.6, dot: 6, label: "CARD_EDITOR_PEN_THIN" },
    { factor: 1, dot: 9, label: "CARD_EDITOR_PEN_MEDIUM" },
    { factor: 1.6, dot: 13, label: "CARD_EDITOR_PEN_THICK" },
] as const;
const DEFAULT_PEN_SIZE_STEP = 0;
/** Eraser radius steps of the size button, in pixels; the button's ring is exactly that size */
const ERASER_SIZE_STEPS = [
    { radius: 5, label: "CARD_EDITOR_ERASER_SMALL" },
    { radius: 9, label: "CARD_EDITOR_ERASER_MEDIUM" },
    { radius: 15, label: "CARD_EDITOR_ERASER_LARGE" },
] as const;
const DEFAULT_ERASER_SIZE_STEP = 1;

/** An ink change; a cleared side also keeps its text (see clearSide()) */
interface UndoStep {
    prev: Stroke[];
    prevText?: string;
}

/**
 * The card editor, used to add new cards and to edit existing ones.
 * It only collects the sides; all file and note writes happen in opts.save().
 *
 * One side is shown at a time, in fixed zones: the tool row, the pen zone of fixed height and the
 * text zone filling the rest; on the right the switch to the other side, beside the pen zone,
 * and the save buttons, beside the text zone. Nothing takes the focus from the text area, so on a
 * phone the soft keyboard stays open while typing and writing, and nothing moves.
 */
export class CardEditorModal extends Modal {
    private settings: SRSettings;
    private opts: CardEditorOptions;
    private front!: SideEditor;
    private back: SideEditor | null = null;
    /** The side shown; tools, undo and Clear act on it */
    private activeSide: SideEditor | null = null;
    /** Ink changes per side, newest last */
    private undoSteps = new Map<SideEditor, UndoStep[]>();
    private eraser = false;
    /** Index into PEN_SIZE_STEPS; kept for this editor only */
    private penSizeStep = DEFAULT_PEN_SIZE_STEP;
    /** Index into ERASER_SIZE_STEPS; kept for this editor only */
    private eraserSizeStep = DEFAULT_ERASER_SIZE_STEP;
    private added = 0;
    private busy = false;
    /** Settles with true when the save in progress succeeded */
    private inFlight: Promise<boolean> | null = null;
    private isClosed = false;
    /** Set when the card on screen was saved or deleted: no draft on close */
    private dropDraft = false;
    private deleteArmedAt = 0;
    private deleteTimer: number | null = null;
    private cssChangeRef: EventRef | null = null;
    /** The pen is touching the screen */
    private penDown = false;
    /** When the pen was last used */
    private lastPenAt = 0;
    /** On mobile, the window whose visible height the editor follows (see fitVisibleHeight()) */
    private fitWindow: Window | null = null;

    private mainEl!: HTMLElement;
    private sidesEl!: HTMLElement;
    private counterEl: HTMLElement | null = null;
    private deleteButton!: HTMLButtonElement;
    private sideLabelEl!: HTMLElement;
    private sizeButton!: HTMLButtonElement;
    private eraserButton!: HTMLButtonElement;
    private undoButton!: HTMLButtonElement;
    private clearButton!: HTMLButtonElement;
    private switchButton: HTMLButtonElement | null = null;
    private switchFrontEl: HTMLElement | null = null;
    private switchBackEl: HTMLElement | null = null;
    private saveButton!: HTMLButtonElement;
    private saveCloseButton: HTMLButtonElement | null = null;

    constructor(app: App, settings: SRSettings, opts: CardEditorOptions) {
        super(app);
        this.settings = settings;
        this.opts = opts;
    }

    private get sides(): SideEditor[] {
        return this.back ? [this.front, this.back] : [this.front];
    }

    /** A side has a pen zone */
    private get hasInk(): boolean {
        return this.sides.some((side) => side.inkEl !== null);
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
        const main = (this.mainEl = root.createDiv({ cls: "sr-card-editor-main" }));
        this.buildTools(main);

        const sidesEl = (this.sidesEl = main.createDiv({ cls: "sr-card-editor-sides" }));
        // Capturing, so this runs before the sides' own listeners
        for (const type of LOCKED_EVENTS) sidesEl.addEventListener(type, this.onLockedInput, true);
        const initial = this.initialSides();
        const cloze = initial.back === null;
        // With pen mode off, a side gets a pen zone only for the handwriting it already has, so
        // saving the card keeps it
        const ink = (side: SideState) => this.settings.cardEditorPenMode || side.strokes.length > 0;
        this.front = this.createSide(sidesEl, {
            face: "front",
            label: cloze ? t("CARD_EDITOR_CLOZE") : t("CARD_EDITOR_FRONT"),
            inkHint: t("CARD_EDITOR_DRAW_FRONT"),
            textHint: cloze ? t("CARD_EDITOR_TYPE_CLOZE") : t("CARD_EDITOR_TYPE_QUESTION"),
            initial: initial.front,
            allowInk: !cloze && ink(initial.front),
        });
        if (initial.back) {
            this.back = this.createSide(sidesEl, {
                face: "back",
                label: t("CARD_EDITOR_BACK"),
                inkHint: t("CARD_EDITOR_DRAW_BACK"),
                textHint: t("CARD_EDITOR_TYPE_ANSWER"),
                initial: initial.back,
                allowInk: ink(initial.back),
            });
        }
        // No pen zone anywhere: the text zone takes its place, the switch and the saves share
        // the right column
        this.modalEl.toggleClass("sr-card-editor-no-ink", !this.hasInk);
        // Cloze: one side, no switch
        main.toggleClass("sr-card-editor-one-side", this.back === null);
        // New strokes follow the size button, also on a card being edited (whose file has its
        // own size) and on a restored draft (saved with the size picked then); every stroke
        // already written keeps its own size
        const penSize = this.penSize;
        this.sides.forEach((side) => side.setPenSize(penSize));

        this.buildRightColumn(main);
        root.addEventListener("keydown", this.onKeyDown);
        for (const type of PEN_EVENTS) {
            this.modalEl.addEventListener(type, this.onPenActivity, true);
        }
        this.guardBackground();
        this.fitVisibleHeight();

        // A theme change (e.g. to dark mode at night) changes the ink color
        this.cssChangeRef = this.app.workspace.on("css-change", () =>
            this.sides.forEach((side) => side.themeChanged()),
        );

        this.showSide(this.front);
        // Also on mobile: the soft keyboard is meant to be open, writing doesn't close it
        this.front.focus();
    }

    onClose(): void {
        this.isClosed = true;
        this.contentEl.removeEventListener("keydown", this.onKeyDown);
        for (const type of PEN_EVENTS) {
            this.modalEl.removeEventListener(type, this.onPenActivity, true);
        }
        for (const type of LOCKED_EVENTS) {
            this.sidesEl.removeEventListener(type, this.onLockedInput, true);
        }
        if (this.cssChangeRef !== null) this.app.workspace.offref(this.cssChangeRef);
        if (this.fitWindow !== null) {
            this.fitWindow.removeEventListener("resize", this.onResize);
            this.fitWindow.visualViewport?.removeEventListener("resize", this.onResize);
        }
        this.disarmDelete();

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

    /** The note's title, the "n added" badge, Delete card and, with space between them, ✕ */
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
        this.deleteButton = this.iconButton(header, "trash-2", t("CARD_EDITOR_DISCARD"), () => {
            void this.deleteCard();
        });
        this.deleteButton.addClass("sr-card-editor-delete");
        // Closing without saving; a new card is kept as a draft
        this.iconButton(header, "x", t("CARD_EDITOR_CLOSE"), () => this.close()).addClass(
            "sr-card-editor-close",
        );
    }

    /** The side's name, then size, eraser, undo and clear, for the side shown */
    private buildTools(main: HTMLElement) {
        const tools = main.createDiv({ cls: "sr-card-editor-tools" });
        this.sideLabelEl = tools.createDiv({ cls: "sr-card-editor-side-label" });
        this.sizeButton = this.iconButton(tools, null, t("CARD_EDITOR_PEN_SIZE"), () =>
            this.cycleSize(),
        );
        this.sizeButton.addClass("sr-card-editor-size");
        this.sizeButton.createSpan({ cls: "sr-card-editor-size-dot" });
        this.eraserButton = this.iconButton(tools, "eraser", t("CARD_EDITOR_ERASER"), () =>
            this.setEraser(!this.eraser),
        );
        this.eraserButton.addClass("sr-card-editor-eraser");
        this.undoButton = this.iconButton(tools, "undo-2", t("CARD_EDITOR_UNDO"), () =>
            this.undo(),
        );
        // Not a bin, so it isn't mixed up with Delete card
        this.clearButton = this.iconButton(tools, "ban", t("CARD_EDITOR_CLEAR_SIDE"), () =>
            this.clearSide(),
        );
    }

    /** The switch beside the pen zone (not for cloze), the save buttons beside the text zone */
    private buildRightColumn(main: HTMLElement) {
        if (this.back !== null) {
            const sw = (this.switchButton = this.textButton(main, "", () => this.switchSide()));
            sw.addClass("sr-card-editor-switch");
            sw.setAttr("aria-label", t("CARD_EDITOR_SWITCH_SIDE"));
            const label = (text: string) =>
                sw.createSpan({ cls: "sr-card-editor-switch-side", text });
            this.switchFrontEl = label(t("CARD_EDITOR_FRONT"));
            sw.createSpan({ cls: "sr-card-editor-switch-arrow", text: "⇅" });
            this.switchBackEl = label(t("CARD_EDITOR_BACK"));
        }
        const saves = main.createDiv({ cls: "sr-card-editor-saves" });
        if (this.opts.kind === "add") {
            this.saveButton = this.textButton(saves, t("CARD_EDITOR_SAVE_NEXT"), () => {
                void this.saveAdd(false);
            });
            this.saveButton.addClass("sr-card-editor-save-next");
            this.saveCloseButton = this.textButton(saves, t("CARD_EDITOR_SAVE_CLOSE"), () => {
                void this.saveAdd(true);
            });
            this.saveCloseButton.addClass("sr-card-editor-save-close");
        } else {
            this.saveButton = this.textButton(saves, t("SAVE"), () => {
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

    /** Pen thickness for new ink: the setting, scaled by the size button's thin / medium / thick */
    private get penSize(): number {
        const size = this.settings.cardEditorPenSize * PEN_SIZE_STEPS[this.penSizeStep].factor;
        return Math.round(size * 10) / 10;
    }

    private get eraserRadius(): number {
        return ERASER_SIZE_STEPS[this.eraserSizeStep].radius;
    }

    private createSide(
        parent: HTMLElement,
        o: Pick<
            SideEditorOptions,
            "face" | "label" | "inkHint" | "textHint" | "initial" | "allowInk"
        >,
    ): SideEditor {
        const side: SideEditor = new SideEditor(parent, {
            ...o,
            settings: this.settings,
            textDirection: this.opts.textDirection ?? TextDirection.Ltr,
            onChange: () => this.updateButtons(),
            onInkCommit: (prev, prevText) => this.stepsOf(side).push({ prev, prevText }),
            isPalm: (evt) => this.isPalm(evt),
            eraserRadius: () => this.eraserRadius,
            onSideButton: () => {
                if (!this.busy) this.setEraser(!this.eraser);
            },
        });
        side.setEraser(this.eraser);
        return side;
    }

    private stepsOf(side: SideEditor): UndoStep[] {
        let steps = this.undoSteps.get(side);
        if (steps === undefined) this.undoSteps.set(side, (steps = []));
        return steps;
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
                blocked = this.hasInk;
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
     * On phones and tablets the editor fills the visible part of the window, above the soft
     * keyboard, which stays open while typing and writing. The pen zone sits at the top with a
     * fixed height, so it doesn't move when the keyboard opens or closes; only the text zone and
     * the save buttons beside it change height.
     */
    private fitVisibleHeight() {
        if (!Platform.isMobile) return;
        this.containerEl.addClass("sr-card-editor-container");
        const win = (this.fitWindow = activeWindow);
        this.onResize();
        win.addEventListener("resize", this.onResize);
        win.visualViewport?.addEventListener("resize", this.onResize);
    }

    private onResize = () => {
        const win = this.fitWindow;
        if (win === null) return;
        const height = Math.round(win.visualViewport?.height ?? win.innerHeight);
        this.modalEl.setCssProps({ "--sr-card-editor-height": `${height}px` });
        // The browser may have scrolled the editor to bring the focused text area into view
        this.containerEl.scrollTop = 0;
    };

    // MARK: actions

    /**
     * Cycles the size of the tool in use: the pen thin → medium → thick, the eraser small →
     * medium → large. The pen size applies to the strokes written from now on; every stroke keeps
     * the thickness it was written with.
     */
    private cycleSize() {
        if (this.busy) return;
        if (this.eraser) {
            this.eraserSizeStep = (this.eraserSizeStep + 1) % ERASER_SIZE_STEPS.length;
        } else {
            this.penSizeStep = (this.penSizeStep + 1) % PEN_SIZE_STEPS.length;
            const size = this.penSize;
            this.sides.forEach((side) => side.setPenSize(size));
        }
        this.updateButtons();
    }

    private setEraser(on: boolean) {
        this.eraser = on;
        this.sides.forEach((side) => side.setEraser(on));
        this.updateButtons();
    }

    /**
     * Undoes the last ink change of the side shown. Undoing "Clear side" restores the side's text
     * as well, unless something was typed since; typing is undone by the text area itself.
     */
    private undo() {
        const side = this.activeSide;
        if (this.busy || side === null) return;
        const step = this.stepsOf(side).pop();
        if (!step) return;
        side.setStrokes(step.prev);
        // Not over text typed since the clear: setText would lose it for good
        if (step.prevText !== undefined && side.text === "") side.setText(step.prevText);
    }

    /** Clears text and ink of the side shown, as one undo step */
    private clearSide() {
        if (this.busy) return;
        this.activeSide?.clear();
    }

    /** Shows one side, hiding the other; text and strokes are kept per side */
    private showSide(side: SideEditor) {
        this.activeSide = side;
        this.sides.forEach((s) => s.show(s === side));
        this.mainEl.toggleClass("is-back", side === this.back);
        this.updateButtons();
    }

    /** Front ⇅ back, with the focus in the side's text area */
    private switchSide() {
        if (this.busy || this.back === null) return;
        const side = this.activeSide === this.front ? this.back : this.front;
        this.showSide(side);
        side.focus();
    }

    /**
     * Delete card. A new card with nothing on it closes at once; otherwise the first tap arms the
     * button, a second one within 3 s deletes the card: a new one is dropped, an existing one
     * removed from its note.
     */
    private async deleteCard() {
        if (this.busy) return;
        if (this.opts.kind === "add" && this.allEmpty) {
            this.dropDraft = true;
            this.close();
            return;
        }
        if (Date.now() - this.deleteArmedAt < DELETE_ARM_MS) {
            this.disarmDelete();
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
        this.disarmDelete();
        this.deleteArmedAt = Date.now();
        this.deleteButton.setText(t("CARD_EDITOR_DISCARD_CONFIRM"));
        this.deleteButton.addClass("is-armed");
        this.deleteTimer = activeWindow.setTimeout(() => this.disarmDelete(), DELETE_ARM_MS);
    }

    /** Back to the unarmed bin: after the timeout and for every new card */
    private disarmDelete() {
        if (this.deleteTimer !== null) activeWindow.clearTimeout(this.deleteTimer);
        this.deleteTimer = null;
        this.deleteArmedAt = 0;
        if (!this.deleteButton.hasClass("is-armed")) return;
        this.deleteButton.removeClass("is-armed");
        this.deleteButton.empty();
        setIcon(this.deleteButton, "trash-2");
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
        this.undoSteps.clear();
        this.disarmDelete();
        this.sides.forEach((side) => side.reset(this.blankSide()));
        this.showSide(this.front);
        this.front.focus();
    }

    private async saveEdit() {
        if (this.busy) return;
        const saved = await this.runSave();
        if (saved && !this.isClosed) this.close();
    }

    /**
     * Calls opts.save() once at a time; resolves to whether it succeeded. A needed side that is
     * empty is shown instead, outlined, with a notice; nothing is saved then.
     */
    private async runSave(): Promise<boolean> {
        const empty = this.sides.find((side) => side.isEmpty);
        if (empty !== undefined) {
            this.showEmptySide(empty);
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

    private showEmptySide(side: SideEditor) {
        if (side !== this.activeSide) {
            this.showSide(side);
            side.focus();
        }
        side.flash();
        const message =
            this.back === null
                ? t("CARD_EDITOR_CARD_EMPTY")
                : side === this.front
                  ? t("CARD_EDITOR_FRONT_EMPTY")
                  : t("CARD_EDITOR_BACK_EMPTY");
        new Notice(message, 2000);
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
            if (this.opts.kind === "add") void this.saveAdd(false);
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
        // Callbacks from the sides can arrive while the editor is still being built
        const side = this.activeSide;
        if (side === null) return;
        const ink = side.inkEl !== null;
        this.sideLabelEl.setText(side.label);

        // The size button shows the size of the tool in use: a dot for the pen, for the eraser a
        // ring exactly as large as its circle in the pen zone
        this.sizeButton.toggleClass("sr-is-hidden", !ink);
        this.sizeButton.disabled = this.busy;
        this.sizeButton.toggleClass("is-eraser", this.eraser);
        const pen = PEN_SIZE_STEPS[this.penSizeStep];
        const eraser = ERASER_SIZE_STEPS[this.eraserSizeStep];
        const dot = this.eraser ? 2 * eraser.radius : pen.dot;
        this.sizeButton.setCssProps({ "--sr-card-editor-dot-size": `${dot}px` });
        this.sizeButton.setAttr(
            "aria-label",
            this.eraser
                ? `${t("CARD_EDITOR_ERASER_SIZE")}: ${t(eraser.label)}`
                : `${t("CARD_EDITOR_PEN_SIZE")}: ${t(pen.label)}`,
        );
        this.eraserButton.toggleClass("sr-is-hidden", !ink);
        this.eraserButton.toggleClass("is-active", this.eraser);
        this.eraserButton.setAttr("aria-pressed", this.eraser);
        this.mainEl.toggleClass("is-erasing", this.eraser);
        this.undoButton.disabled = this.busy || this.stepsOf(side).length === 0;
        this.clearButton.disabled = this.busy || side.isEmpty;
        this.deleteButton.disabled = this.busy;

        if (this.switchButton) {
            this.switchButton.disabled = this.busy;
            this.switchFrontEl?.toggleClass("is-active", side === this.front);
            this.switchBackEl?.toggleClass("is-active", side === this.back);
        }
        // Not disabled for an empty side: saving shows the side to fill in (see runSave())
        this.saveButton.disabled = this.busy;
        if (this.saveCloseButton) this.saveCloseButton.disabled = this.busy;
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
     * over the screen also sends pointermove events (with the side button pressed, with buttons
     * 1 and no pressure), and would block finger taps all along.
     */
    private onPenActivity = (evt: PointerEvent) => {
        if (evt.pointerType !== "pen") return;
        const hovering = evt.buttons === 0 || !(evt.pressure > 0);
        if (evt.type === "pointermove" && !this.penDown && hovering) return;
        this.penDown = evt.type === "pointerdown" || (this.penDown && evt.type === "pointermove");
        this.lastPenAt = Date.now();
    };

    /**
     * A finger press while the pen is down or was just used is the palm resting on the screen,
     * not a tap.
     */
    private isPalm(evt: PointerEvent): boolean {
        return (
            evt.pointerType === "touch" &&
            (this.penDown || Date.now() - this.lastPenAt < PALM_GUARD_MS)
        );
    }

    /**
     * Returns whether the button's current click comes from a palm press (see isPalm()). A
     * button never takes the focus, so the text area keeps it and the soft keyboard stays open.
     */
    private palmGuard(button: HTMLButtonElement): () => boolean {
        let palm = false;
        button.addEventListener("pointerdown", (evt) => {
            evt.preventDefault();
            palm = this.isPalm(evt);
        });
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
