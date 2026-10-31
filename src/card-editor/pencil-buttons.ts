import { App, MarkdownPostProcessorContext, MarkdownView, setIcon, TFile } from "obsidian";

import { INK_FILE_PREFIX, isInkFileName } from "src/card-editor/core/card-text";
import { imageFileName, InkFiles } from "src/card-editor/ink-files";
import { t } from "src/lang/helpers";

const BUTTON_CLASS = "sr-pencil-button";
const HOST_CLASS = "sr-pencil-host";
const INK_IMAGE_SELECTOR = `img[src*="${INK_FILE_PREFIX}"]`;
/** How far a pointer may move between press and release for a tap */
const TAP_SLOP_PX = 10;

/** What a pencil button does when tapped */
export interface PencilButtonActions {
    readonly inkFiles: InkFiles;
    editInNote(noteFile: TFile, imageName: string): Promise<void>;
    editInReview(): Promise<void>;
}

/** The note an image is shown for, looked up when the pencil is tapped */
type NoteOf = () => TFile | null;

/**
 * Adds a pencil button to every handwritten card image, in reading view, live preview and the
 * review window. Reading view and the review window are covered by a markdown post-processor.
 * Live preview doesn't post-process image embeds, so each editor's live preview is watched instead.
 */
export class PencilButtons {
    private app: App;
    private actions: PencilButtonActions;
    /** Live preview containers being watched → their observer */
    private observers = new Map<HTMLElement, MutationObserver>();
    /** Rendered embeds waiting for their <img> → their observer */
    private embedObservers = new Map<HTMLElement, MutationObserver>();
    private destroyed = false;

    constructor(app: App, actions: PencilButtonActions) {
        this.app = app;
        this.actions = actions;
    }

    /** Markdown post-processor: adds the buttons to rendered markdown (reading view, review window) */
    postProcess(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
        const noteOf: NoteOf = () => {
            const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
            return file instanceof TFile ? file : null;
        };
        el.querySelectorAll<HTMLImageElement>(INK_IMAGE_SELECTOR).forEach((img) =>
            this.consider(img, noteOf),
        );

        // Obsidian adds the <img> of an embed later, once the image file is loaded.
        // An unresolved embed (missing file) gets none.
        el.querySelectorAll<HTMLElement>(`.internal-embed[src*="${INK_FILE_PREFIX}"]`).forEach(
            (embed) => {
                if (embed.querySelector("img") || embed.hasClass("is-unresolved")) return;
                if (this.destroyed || this.embedObservers.has(embed)) return;
                const observer = new MutationObserver(() => {
                    const img = embed.querySelector<HTMLImageElement>(INK_IMAGE_SELECTOR);
                    if (!img) return;
                    this.stopWatchingEmbed(embed);
                    this.consider(img, noteOf);
                });
                observer.observe(embed, { childList: true, subtree: true });
                this.embedObservers.set(embed, observer);
            },
        );
    }

    private stopWatchingEmbed(embed: HTMLElement): void {
        this.embedObservers.get(embed)?.disconnect();
        this.embedObservers.delete(embed);
    }

    /** Watches the live preview of every open markdown editor not watched yet */
    watchLivePreview(): void {
        if (this.destroyed) return;
        // Stop watching editors that were closed, and embeds no longer shown
        for (const [el, observer] of this.observers) {
            if (!el.isConnected) {
                observer.disconnect();
                this.observers.delete(el);
            }
        }
        for (const embed of this.embedObservers.keys()) {
            if (!embed.isConnected) this.stopWatchingEmbed(embed);
        }

        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view as MarkdownView;
            const el = view.containerEl?.querySelector<HTMLElement>(".markdown-source-view");
            if (!el || this.observers.has(el)) continue;

            const noteOf: NoteOf = () => view.file ?? null;
            const observer = new MutationObserver((records) => {
                for (const record of records) {
                    if (record.type === "attributes")
                        this.considerLivePreview(record.target, noteOf);
                    else record.addedNodes.forEach((n) => this.scanLivePreview(n, noteOf));
                }
            });
            observer.observe(el, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["src"],
            });
            this.observers.set(el, observer);
            this.scanLivePreview(el, noteOf);
        }
    }

    /**
     * Removes all buttons in every window and stops watching. The buttons are looked up instead of
     * kept, so views closed meanwhile can be freed. A button left in a detached section (reading
     * view puts sections scrolled out of view back later) opens nothing once destroyed.
     */
    destroy(): void {
        this.destroyed = true;
        this.observers.forEach((observer) => observer.disconnect());
        this.observers.clear();
        this.embedObservers.forEach((observer) => observer.disconnect());
        this.embedObservers.clear();
        for (const doc of this.openDocuments()) {
            doc.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
                button.parentElement?.removeClass(HOST_CLASS);
                button.remove();
            });
        }
    }

    /** The documents of all windows: the main one and popouts */
    private openDocuments(): Document[] {
        const documents = new Set<Document>([activeDocument]);
        this.app.workspace.iterateAllLeaves((leaf) => {
            const doc = leaf.view?.containerEl?.ownerDocument;
            if (doc) documents.add(doc);
        });
        return [...documents];
    }

    private scanLivePreview(node: Node, noteOf: NoteOf): void {
        // instanceOf, not instanceof: an editor in a popout window has that window's classes
        if (!node.instanceOf(HTMLElement)) return;
        if (node.instanceOf(HTMLImageElement)) {
            this.considerLivePreview(node, noteOf);
            return;
        }
        node.querySelectorAll(INK_IMAGE_SELECTOR).forEach((img) =>
            this.considerLivePreview(img, noteOf),
        );
    }

    private considerLivePreview(node: Node, noteOf: NoteOf): void {
        if (!node.instanceOf(HTMLImageElement)) return;
        // Embedded notes are rendered as markdown and post-processed, with their own source path
        if (node.closest(".markdown-embed")) return;
        this.consider(node, noteOf);
    }

    private consider(img: HTMLImageElement, noteOf: NoteOf): void {
        const name = imageFileName(img);
        // Same rule as for opening a side as ink, so renamed ink files get a pencil too
        if (name === null || !isInkFileName(name)) return;
        if (img.closest(".sr-card-editor-modal")) return;

        // An image rendered from before an edit: load the new version
        this.actions.inkFiles.applyVersion(img);

        const host = img.parentElement;
        if (!host || Array.from(host.children).some((c) => c.classList.contains(BUTTON_CLASS)))
            return;
        host.addClass(HOST_CLASS);
        this.addButton(host, img, noteOf);
    }

    private addButton(host: HTMLElement, img: HTMLImageElement, noteOf: NoteOf): void {
        const button = host.createEl("button", { cls: `${BUTTON_CLASS} clickable-icon` });
        button.setAttr("aria-label", t("CARD_EDITOR_EDIT_HANDWRITTEN"));
        setIcon(button, "pencil");

        // In live preview the editor (CodeMirror) handles touches on the line itself and moves the
        // cursor, which re-renders the embed and swallows the tap. Keep every part of the tap here.
        // A drag starting on the button is not a tap (the page can't scroll from here)
        let pressedAt: { x: number; y: number } | null = null;
        const swallow = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
        };
        button.addEventListener("touchstart", swallow, { passive: false });
        button.addEventListener("touchend", swallow, { passive: false });
        button.addEventListener("mousedown", swallow);
        button.addEventListener("mouseup", swallow);
        button.addEventListener("pointerdown", (e) => {
            swallow(e);
            pressedAt = { x: e.clientX, y: e.clientY };
        });
        button.addEventListener("pointerup", (e) => {
            swallow(e);
            const tap =
                pressedAt !== null &&
                Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) <= TAP_SLOP_PX;
            pressedAt = null;
            if (tap) this.open(img, noteOf);
        });
        button.addEventListener("pointercancel", () => (pressedAt = null));
        button.addEventListener("click", (e) => {
            swallow(e);
            // Keyboard activation (Enter/Space) has no pointer events
            if (e.detail === 0) this.open(img, noteOf);
        });
    }

    private open(img: HTMLImageElement, noteOf: NoteOf): void {
        // A button left behind in an element that was detached when the plugin was unloaded
        if (this.destroyed) return;
        const name = imageFileName(img);
        if (name === null) return;
        if (img.closest(".sr-view")) {
            void this.actions.editInReview();
            return;
        }
        const note = noteOf();
        if (note !== null) void this.actions.editInNote(note, name);
    }
}
