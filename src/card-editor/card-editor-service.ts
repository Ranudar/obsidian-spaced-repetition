import { MarkdownView, Notice, TFile } from "obsidian";

import {
    CardEditorModal,
    CardEditorResult,
    CardEditorSides,
    SideResult,
} from "src/card-editor/card-editor-modal";
import { CardInserter } from "src/card-editor/card-inserter";
import {
    cardMarkerLine,
    composeCardText,
    inkEmbed,
    inkEmbedPath,
    inkEmbedPaths,
    joinSide,
    misreadSide,
    newCardBody,
    protectBlankLines,
    splitCardText,
    splitSide,
} from "src/card-editor/core/card-text";
import {
    inkFileName,
    InkSide,
    parseInkFileName,
    strokesToSvg,
    svgToStrokes,
    timestampName,
} from "src/card-editor/core/ink-svg";
import { InkFiles } from "src/card-editor/ink-files";
import { SideState } from "src/card-editor/side-editor";
import { removeQuestionText } from "src/data/data-store/notes-data-store/notes-data-store";
import { CardType, Question } from "src/data/data-structures/card/questions/question";
import { SettingsUtil, SRSettings } from "src/data/settings";
import { SettingsManager } from "src/data/settings-manager";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";

export interface EditQuestionResult {
    /** The new question text (actual question, without topic path and schedule) */
    text: string;
    /** False when only ink images were rewritten: the note needs no write */
    textChanged: boolean;
    /** Ink files overwritten in place; images showing them need a refresh */
    changedImages: TFile[];
    /** The card was deleted from its note */
    deleted?: true;
}

/**
 * Writes the edited question text to the note.
 * Resolves to false, writing nothing, when the card's text is no longer in the note.
 */
export type WriteQuestionText = (text: string) => Promise<boolean>;

/**
 * Removes the question, with its schedule, from the note.
 * Resolves to false, writing nothing, when the card's text is no longer in the note.
 */
export type DeleteQuestion = () => Promise<boolean>;

/** How long after handwriting was removed from a note its image goes to the trash */
const INK_TRASH_DELAY_MS = 2000;

/** A side of an existing card, as found in the note */
interface LoadedSide {
    /** The side's text in the note: typed text, then the ink embed if it has one */
    text: string;
    /** The trailing ink embed as written, if its file's strokes could be read; else null */
    embed: string | null;
    /** The ink file, if the side is handwritten and its strokes could be read */
    file: TFile | null;
    /** The ink file's content, to restore it when a save fails */
    svg: string;
    state: SideState;
}

/** An existing card, as found in the note */
interface LoadedCard {
    cardType: CardType;
    /** The question text, without topic path and schedule */
    original: string;
    /** The separator as written in the note */
    separator: string | null;
    front: LoadedSide;
    back: LoadedSide | null;
    sourcePath: string;
}

/**
 * Entry points of the card editor. The editor itself only collects the sides;
 * all ink file writes happen here.
 */
export class CardEditorService {
    readonly inkFiles: InkFiles;
    private plugin: SRPlugin;
    private settingsManager: SettingsManager;
    /** The unsaved card of the last add editor closed without saving */
    private draft: CardEditorSides | null = null;
    /** A card from a note is being edited; ignores a second tap on a pencil meanwhile */
    private editingInNote = false;
    /** The editors open now, closed when the plugin is unloaded */
    private modals = new Set<CardEditorModal>();
    /** The plugin was unloaded: no editor opens, nothing is written any more */
    private destroyed = false;

    constructor(plugin: SRPlugin, settingsManager: SettingsManager) {
        this.plugin = plugin;
        this.settingsManager = settingsManager;
        this.inkFiles = new InkFiles(plugin.app, () => this.settings.cardEditorImageFolder);
    }

    private get settings(): SRSettings {
        return this.settingsManager.settings;
    }

    /**
     * Opens the editor to add cards to a note. Each saved card is inserted below the cursor
     * (or at the end of the note when it isn't open in an editor), and the note is rescanned
     * once the editor has closed.
     */
    openAdd(file: TFile, view: MarkdownView | null): void {
        if (this.destroyed) return;
        if (!this.hasFlashcardTag(file)) {
            new Notice(
                t("CARD_EDITOR_NO_FLASHCARD_TAG", {
                    tag: this.settings.flashcardTags[0] ?? "#flashcards",
                }),
            );
        }

        const inserter = new CardInserter(this.plugin.app, file, view, this.settings);
        let added = 0;
        const modal = new CardEditorModal(this.plugin.app, this.settings, {
            kind: "add",
            title: file.basename,
            textDirection: this.plugin.getObsidianRtlSetting(),
            draft: this.draft,
            save: async (r: CardEditorResult) => {
                this.assertActive();
                await this.addCard(r, file.path, inserter);
                added++;
            },
            keepDraft: (draft) => (this.draft = draft),
            closed: () => {
                this.modals.delete(modal);
                if (added > 0 && !this.destroyed) void this.rescan(inserter);
            },
        });
        this.open(modal);
    }

    private open(modal: CardEditorModal): void {
        this.modals.add(modal);
        modal.open();
    }

    /**
     * Closes the open editors and stops writing, when the plugin is unloaded.
     * A save already writing finishes; any later one is refused.
     */
    destroy(): void {
        this.destroyed = true;
        for (const modal of [...this.modals]) modal.close();
        this.modals.clear();
    }

    /** Throws once the plugin was unloaded, so an editor still open writes nothing */
    private assertActive(): void {
        if (this.destroyed) throw new Error(t("CARD_EDITOR_PLUGIN_UNLOADED"));
    }

    /**
     * Opens the editor for a question. On save, writes its ink files and, if the text changed,
     * the note through writeText. Writing the note is the commit point: if it fails, new ink files
     * are removed, rewritten ones restored, and the editor stays open with a notice.
     * Resolves to the result, or null when the editor was closed without saving.
     */
    async editQuestion(
        question: Question,
        writeText: WriteQuestionText,
        deleteQuestion: DeleteQuestion,
    ): Promise<EditQuestionResult | null> {
        if (this.destroyed) return null;
        const cardType = question.questionType;
        const original = question.questionText.actualQuestion;
        const sourcePath = question.note.file.path;

        const split = splitCardText(cardType, original, this.settings);
        const front = await this.loadSide(split.front, sourcePath, cardType !== CardType.Cloze);
        const back = split.back === null ? null : await this.loadSide(split.back, sourcePath);
        const card: LoadedCard = {
            cardType,
            original,
            separator: split.separator,
            front,
            back,
            sourcePath,
        };
        const initial: CardEditorSides = { front: front.state, back: back?.state ?? null };
        // Unloaded while the card was read
        if (this.destroyed) return null;

        return new Promise((resolve) => {
            let result: EditQuestionResult | null = null;
            const modal = new CardEditorModal(this.plugin.app, this.settings, {
                kind: "edit",
                title: question.note.file.basename,
                textDirection: question.questionText.textDirection,
                initial,
                cardType,
                save: async (r: CardEditorResult) => {
                    this.assertActive();
                    result = await this.saveCard(r, card, writeText);
                },
                delete: async () => {
                    this.assertActive();
                    await this.deleteCard(card, deleteQuestion);
                    result = { text: "", textChanged: true, changedImages: [], deleted: true };
                },
                closed: () => {
                    this.modals.delete(modal);
                    resolve(result);
                },
            });
            this.open(modal);
        });
    }

    /**
     * Opens the editor for the card in the note that shows the ink image (pencil button in a note).
     * Writes the card's text back to the note if it changed, then rescans the vault.
     */
    async editInNote(noteFile: TFile, image: TFile): Promise<void> {
        if (this.editingInNote || this.destroyed) return;
        // E.g. a Canvas text node: its file is JSON, not a note with cards
        if (noteFile.extension !== "md") {
            new Notice(t("CARD_EDITOR_CARD_NOT_FOUND"));
            return;
        }
        this.editingInNote = true;
        try {
            await this.saveOpenEditors(noteFile);
            const note = await this.plugin.dataManager.loadNote(noteFile);
            const question = note
                ? findQuestionWithInk(note.questionList, image, (link) =>
                      this.inkFiles.resolve(link, noteFile.path),
                  )
                : null;
            if (question === null) {
                new Notice(t("CARD_EDITOR_CARD_NOT_FOUND"));
                return;
            }

            const result = await this.editQuestion(question, async (text) => {
                // Replaces just the question's text, so its schedule comment stays.
                // writeQuestion restores the question's text object if the write throws.
                const q = question.questionText;
                const previous = q.actualQuestion;
                q.actualQuestion = text;
                let written = false;
                try {
                    written = await question.writeQuestion(this.settings);
                } finally {
                    if (!written) q.actualQuestion = previous;
                }
                return written;
            }, () => this.deleteFromNote(question));
            if (result === null) return;
            this.refreshImages(result.changedImages);
            if (result.textChanged && this.plugin.isInitialized && !this.destroyed)
                await this.plugin.dataManager.sync();
        } catch (err) {
            console.error("SR: editing the card failed", err);
            new Notice(t("CARD_EDITOR_EDIT_FAILED", { error: String(err) }));
        } finally {
            this.editingInNote = false;
        }
    }

    /** Removes the question's text, with its schedule and end marker, from its note */
    private async deleteFromNote(question: Question): Promise<boolean> {
        const file = question.note.file;
        const newText = removeQuestionText(
            await file.read(),
            question.questionText.original,
            question.questionType,
            this.settings,
        );
        if (newText === null) return false;
        await file.write(newText);
        return true;
    }

    /**
     * Deletes the card from its note, then moves its ink images to the trash, except those other
     * cards or notes still refer to
     */
    private async deleteCard(card: LoadedCard, deleteQuestion: DeleteQuestion): Promise<void> {
        const files = [card.front.file, card.back?.file ?? null].filter(
            (f): f is TFile => f !== null,
        );
        // Counted before the note is written, see saveCard()
        const linksOutside = new Map(
            files.map((f) => [f, this.linksOutsideCard(f, card.original, card.sourcePath)]),
        );
        if (!(await deleteQuestion())) throw new Error(t("CARD_EDITOR_TEXT_NOT_FOUND"));
        for (const file of files) {
            if (linksOutside.get(file) > 0) continue;
            if (await this.inkFiles.isReferenced(file, card.sourcePath)) continue;
            await this.inkFiles
                .trash(file)
                .catch((e) => console.error("SR: removing the ink image failed", e));
        }
    }

    /**
     * Handwriting the user removed from a note in the editor (e.g. with Backspace): its image goes
     * to the trash after a moment, unless the note shows it again by then (undo, paste) or another
     * card or note refers to it. noteText: the note's text in the editor now, saved or not.
     */
    inkRemovedInNote(links: string[], sourcePath: string, noteText: () => string): void {
        if (this.destroyed) return;
        const files = links
            .map((link) => this.inkFiles.resolve(link, sourcePath))
            .filter((f): f is TFile => f !== null);
        if (files.length === 0) return;
        activeWindow.setTimeout(() => {
            void (async () => {
                for (const file of files) {
                    if (this.destroyed) return;
                    const text = noteText();
                    if (await this.inkFiles.isReferenced(file, sourcePath, text)) continue;
                    try {
                        await this.inkFiles.trash(file);
                        new Notice(t("CARD_EDITOR_INK_TRASHED", { name: file.name }));
                    } catch (e) {
                        console.error("SR: removing the ink image failed", e);
                    }
                }
            })();
        }, INK_TRASH_DELAY_MS);
    }

    /** Writes unsaved typing in editors showing the note, so the card is read as it is on screen */
    private async saveOpenEditors(file: TFile): Promise<void> {
        for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file?.path === file.path) await view.save();
        }
    }

    /** Pencil button in the review window: the same as the toolbar's Edit button */
    async editInReview(): Promise<void> {
        if (!this.plugin.isUiManagerLoaded()) return;
        await this.plugin.uiManager.contentManager?.editCurrentQuestion();
    }

    /**
     * Writes the ink files of a new card and inserts the card. A side is its typed text, then the
     * embed of its handwriting. Both handwritten sides share the stem of their file names.
     */
    private async addCard(
        result: CardEditorResult,
        sourcePath: string,
        inserter: CardInserter,
    ): Promise<void> {
        const stem = timestampName(new Date());
        const created: TFile[] = [];
        try {
            const sideText = async (r: SideResult | null, side: InkSide): Promise<string> => {
                if (r === null) throw new Error(t("CARD_EDITOR_SIDES_EMPTY"));
                const typed = this.protect(this.typedText(r.text, false));
                let embed: string | null = null;
                if (r.ink !== null) {
                    const svg = strokesToSvg(r.ink.strokes, { size: r.ink.penSize });
                    if (svg === null) throw new Error(t("CARD_EDITOR_SIDES_EMPTY"));
                    const file = await this.inkFiles.create(
                        inkFileName(stem, side),
                        svg.svg,
                        sourcePath,
                    );
                    created.push(file);
                    embed = inkEmbed(this.inkFiles.linkPath(file, sourcePath));
                }
                return joinSide(CardType.MultiLineBasic, typed, embed);
            };

            const front = await sideText(result.front, "front");
            const back = await sideText(result.back, "back");
            if (front.length === 0 || back.length === 0)
                throw new Error(t("CARD_EDITOR_SIDES_EMPTY"));
            this.assertReadAsCard(CardType.MultiLineBasic, front, back, (f, b) =>
                newCardBody(f, b ?? "", this.settings),
            );
            this.assertActive();
            await inserter.insert(newCardBody(front, back, this.settings));
        } catch (err) {
            // The card stays in the editor; don't leave images behind that no card shows
            for (const file of created) {
                await this.inkFiles
                    .trash(file)
                    .catch((e) => console.error("SR: removing the ink image failed", e));
            }
            throw err;
        }
    }

    /** Rescans the vault after cards were added, so deck counts and review queue include them */
    private async rescan(inserter: CardInserter): Promise<void> {
        try {
            await inserter.flush();
            if (this.plugin.isInitialized) await this.plugin.dataManager.sync();
        } catch (err) {
            console.error("SR: rescanning after adding cards failed", err);
        }
    }

    /**
     * Whether the note's tags (incl. frontmatter tags) contain a flashcard tag,
     * i.e. whether SR picks up the cards in it. With folders as decks, tags don't matter.
     */
    private hasFlashcardTag(file: TFile): boolean {
        if (this.settings.convertFoldersToDecks) return true;
        const tags = this.plugin.dataManager.createSRNoteTFile(file).getAllTagsFromCache();
        return tags.some((tag) => SettingsUtil.isFlashcardTag(this.settings, tag));
    }

    /** Reloads every image showing one of the files */
    refreshImages(files: TFile[]): void {
        this.inkFiles.refresh(files);
    }

    /**
     * A side is typed text, optionally followed by one embed of an ink SVG with stored strokes.
     * A missing or unreadable SVG keeps its embed in the text, so nothing is lost. Cloze cards
     * (allowInk false) have no handwriting: their whole text is typed.
     */
    private async loadSide(text: string, sourcePath: string, allowInk = true): Promise<LoadedSide> {
        const penSize = this.settings.cardEditorPenSize;
        const asText: LoadedSide = {
            text,
            embed: null,
            file: null,
            svg: "",
            state: { text, strokes: [], penSize },
        };
        if (!allowInk) return asText;

        const parts = splitSide(text);
        if (parts.inkEmbed === null) return asText;
        // The embed's own link path, so a file of the same name in another folder isn't used
        const linkPath = inkEmbedPath(parts.inkEmbed);
        if (linkPath === null) return asText;
        const file = this.inkFiles.resolve(linkPath, sourcePath);
        if (file === null) return asText;

        try {
            const svg = await this.inkFiles.read(file);
            const ink = svgToStrokes(svg);
            if (ink === null) return asText;
            return {
                text,
                embed: parts.inkEmbed,
                file,
                svg,
                state: { text: parts.text, strokes: ink.strokes, penSize: ink.size },
            };
        } catch (err) {
            console.error("SR: reading the ink image failed", err);
            return asText;
        }
    }

    /**
     * Saves an edited card. Per side, its handwriting:
     * - kept: overwrites the SVG if the strokes changed, its embed stays as it is
     * - added: a new SVG, named after the card's other ink side if it has one
     * - erased: the embed goes, and the SVG to the trash once the note is written
     * The side's text is rewritten only if its typed text or its embed changed.
     * Then writes the note if the card's text changed. On failure, everything is undone.
     */
    private async saveCard(
        result: CardEditorResult,
        card: LoadedCard,
        writeText: WriteQuestionText,
    ): Promise<EditQuestionResult> {
        const { front, back, sourcePath } = card;
        const created: TFile[] = [];
        const overwritten: LoadedSide[] = [];
        const toTrash: TFile[] = [];
        /** For each file in toTrash: links to it from other cards and notes, per the link index */
        const linksOutside = new Map<TFile, number>();
        // Without an end marker, a blank line would end a multi-line or cloze card
        const protect =
            card.cardType !== CardType.SingleLineBasic &&
            card.cardType !== CardType.SingleLineReversed;

        // Both sides of a card share the stem of their file names
        let stem: string | null = null;
        for (const side of [front, back]) {
            const parsed = side?.file ? parseInkFileName(side.file.name) : null;
            if (parsed) {
                stem = parsed.stem;
                break;
            }
        }
        const newStem = (side: InkSide): string => {
            // Never reuse a name taken anywhere in the vault, e.g. by a file left over from a
            // deleted card: the bare name finds a file of that name in any folder
            if (
                stem !== null &&
                this.inkFiles.resolve(inkFileName(stem, side), sourcePath) === null
            )
                return stem;
            stem = timestampName(new Date());
            return stem;
        };

        const saveSide = async (
            r: SideResult,
            loaded: LoadedSide,
            side: InkSide,
        ): Promise<string> => {
            let embed: string | null = null;
            if (r.ink === null) {
                if (loaded.file) toTrash.push(loaded.file);
            } else if (loaded.file && !r.ink.changed) {
                embed = loaded.embed;
            } else {
                const svg = strokesToSvg(r.ink.strokes, { size: r.ink.penSize });
                if (svg === null) throw new Error(t("CARD_EDITOR_SIDES_EMPTY"));
                if (loaded.file) {
                    await this.inkFiles.overwrite(loaded.file, svg.svg);
                    overwritten.push(loaded);
                    embed = loaded.embed;
                } else {
                    const file = await this.inkFiles.create(
                        inkFileName(newStem(side), side),
                        svg.svg,
                        sourcePath,
                    );
                    created.push(file);
                    embed = inkEmbed(this.inkFiles.linkPath(file, sourcePath));
                }
            }

            const typedChanged = r.text !== loaded.state.text;
            // Unchanged: exactly as in the note, e.g. with whitespace before the embed
            if (!typedChanged && embed === loaded.embed) return loaded.text;
            let typed = loaded.state.text;
            if (typedChanged) {
                typed = this.typedText(r.text, true);
                if (protect) typed = this.protect(typed);
            }
            const sideText = joinSide(card.cardType, typed, embed);
            if (sideText.trim().length === 0) throw new Error(t("CARD_EDITOR_SIDES_EMPTY"));
            return sideText;
        };

        let text: string;
        try {
            const frontText = await saveSide(result.front, front, "front");
            const backText =
                back !== null && result.back !== null
                    ? await saveSide(result.back, back, "back")
                    : null;
            text = composeCardText(
                card.cardType,
                frontText,
                backText,
                this.settings,
                card.separator,
            );
            if (text !== card.original) {
                this.assertReadAsCard(card.cardType, frontText, backText, (f, b) =>
                    composeCardText(card.cardType, f, b, this.settings, card.separator),
                );
            }
            // Counted before the note is written: once Obsidian's link index has caught up with
            // the write, it no longer includes this card's old embeds
            for (const file of toTrash) {
                linksOutside.set(file, this.linksOutsideCard(file, card.original, sourcePath));
            }
            this.assertActive();
            if (text !== card.original && !(await writeText(text)))
                throw new Error(t("CARD_EDITOR_TEXT_NOT_FOUND"));
        } catch (err) {
            await this.undoSave(created, overwritten);
            throw err;
        }

        // The card no longer shows these images; keep those other cards or notes still refer to.
        // Both the link index and the files are asked, so a lagging index can't lose an image.
        for (const file of toTrash) {
            if (linksOutside.get(file) > 0 || this.inkFiles.linksTo(file, text, sourcePath) > 0)
                continue;
            if (await this.inkFiles.isReferenced(file, sourcePath)) continue;
            await this.inkFiles
                .trash(file)
                .catch((e) => console.error("SR: removing the ink image failed", e));
        }
        return {
            text,
            textChanged: text !== card.original,
            changedImages: overwritten.map((side) => side.file),
        };
    }

    /**
     * Links to the ink file in other notes and other cards of this note, while Obsidian's link
     * index still describes the note with the card's text `cardText`
     */
    private linksOutsideCard(file: TFile, cardText: string, sourcePath: string): number {
        return this.inkFiles.linkCount(file) - this.inkFiles.linksTo(file, cardText, sourcePath);
    }

    /** protectBlankLines for a typed text; an empty one stays empty, the side may be ink only */
    private protect(text: string): string {
        return text.length === 0 ? text : protectBlankLines(text, this.settings);
    }

    /**
     * A typed side's text, trimmed; for an existing card (keepIndent) only blank lines at the start
     * and whitespace at the end are removed, so e.g. a card in an indented list stays indented.
     * Throws if a line in it would split or end the card, so the editor stays open with a notice.
     */
    private typedText(text: string, keepIndent: boolean): string {
        const marker = cardMarkerLine(text, this.settings);
        if (marker !== null) throw new Error(t("CARD_EDITOR_SIDE_HAS_MARKER", { line: marker }));
        return keepIndent ? text.replace(/^\s*\n/, "").trimEnd() : text.trim();
    }

    /**
     * Throws, so the editor stays open with a notice, unless SR's parser reads the card back as
     * one card of the type with exactly these sides, e.g. not a "::" in a multi-line card's side,
     * which would make it a single-line card. compose: the card text as it goes into the note.
     */
    private assertReadAsCard(
        cardType: CardType,
        front: string,
        back: string | null,
        compose: (front: string, back: string | null) => string,
    ): void {
        const side = misreadSide(cardType, front, back, this.settings, compose);
        if (side === null) return;
        const name =
            back === null
                ? t("CARD_EDITOR_CLOZE")
                : side === "front"
                  ? t("CARD_EDITOR_FRONT")
                  : t("CARD_EDITOR_BACK");
        throw new Error(t("CARD_EDITOR_SIDE_HAS_CARD_SYNTAX", { side: name }));
    }

    /** Leaves the ink files of a card as they were before a failed save */
    private async undoSave(created: TFile[], overwritten: LoadedSide[]): Promise<void> {
        for (const file of created) {
            await this.inkFiles
                .trash(file)
                .catch((e) => console.error("SR: removing the ink image failed", e));
        }
        for (const side of overwritten) {
            await this.inkFiles
                .overwrite(side.file, side.svg)
                .catch((e) => console.error("SR: restoring the ink image failed", e));
        }
    }
}

/**
 * The first question whose text embeds the ink image, or null.
 * resolve: the file a link path in the note links to, so a file of the same name elsewhere isn't it.
 */
export function findQuestionWithInk(
    questions: Question[],
    image: TFile,
    resolve: (linkPath: string) => TFile | null,
): Question | null {
    return (
        questions.find((question) =>
            inkEmbedPaths(question.questionText.actualQuestion).some(
                (path) => resolve(path)?.path === image.path,
            ),
        ) ?? null
    );
}
