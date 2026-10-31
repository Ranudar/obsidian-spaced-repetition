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
    inkEmbedFileNames,
    inkEmbedPath,
    newCardBody,
    protectBlankLines,
    splitCardText,
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
}

/**
 * Writes the edited question text to the note.
 * Resolves to false, writing nothing, when the card's text is no longer in the note.
 */
export type WriteQuestionText = (text: string) => Promise<boolean>;

/** A side of an existing card, as found in the note */
interface LoadedSide {
    /** The side's text in the note */
    text: string;
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
        if (!this.hasFlashcardTag(file)) {
            new Notice(
                t("CARD_EDITOR_NO_FLASHCARD_TAG", {
                    tag: this.settings.flashcardTags[0] ?? "#flashcards",
                }),
            );
        }

        const inserter = new CardInserter(this.plugin.app, file, view, this.settings);
        let added = 0;
        new CardEditorModal(this.plugin.app, this.settings, {
            kind: "add",
            title: file.basename,
            textDirection: this.plugin.getObsidianRtlSetting(),
            draft: this.draft,
            save: async (r: CardEditorResult) => {
                await this.addCard(r, file.path, inserter);
                added++;
            },
            keepDraft: (draft) => (this.draft = draft),
            closed: () => {
                if (added > 0) void this.rescan(inserter);
            },
        }).open();
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
    ): Promise<EditQuestionResult | null> {
        const cardType = question.questionType;
        const original = question.questionText.actualQuestion;
        const sourcePath = question.note.file.path;

        const split = splitCardText(cardType, original, this.settings);
        const front = await this.loadSide(split.front, sourcePath);
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

        return new Promise((resolve) => {
            let result: EditQuestionResult | null = null;
            new CardEditorModal(this.plugin.app, this.settings, {
                kind: "edit",
                title: question.note.file.basename,
                textDirection: question.questionText.textDirection,
                initial,
                cardType,
                save: async (r: CardEditorResult) => {
                    result = await this.saveCard(r, card, writeText);
                },
                closed: () => resolve(result),
            }).open();
        });
    }

    /**
     * Opens the editor for the card in the note that shows the ink image (pencil button in a note).
     * Writes the card's text back to the note if it changed, then rescans the vault.
     */
    async editInNote(noteFile: TFile, imageName: string): Promise<void> {
        if (this.editingInNote) return;
        // E.g. a Canvas text node: its file is JSON, not a note with cards
        if (noteFile.extension !== "md") {
            new Notice(t("CARD_EDITOR_CARD_NOT_FOUND"));
            return;
        }
        this.editingInNote = true;
        try {
            await this.saveOpenEditors(noteFile);
            const note = await this.plugin.dataManager.loadNote(noteFile);
            const question = note ? findQuestionWithInk(note.questionList, imageName) : null;
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
            });
            if (result === null) return;
            this.refreshImages(result.changedImages);
            if (result.textChanged && this.plugin.isInitialized)
                await this.plugin.dataManager.sync();
        } catch (err) {
            console.error("SR: editing the card failed", err);
            new Notice(t("CARD_EDITOR_EDIT_FAILED", { error: String(err) }));
        } finally {
            this.editingInNote = false;
        }
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
     * Writes the ink files of a new card and inserts the card.
     * Both handwritten sides share the stem of their file names.
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
                if (r.mode === "text")
                    return protectBlankLines(this.typedText(r.text), this.settings);
                const svg = strokesToSvg(r.strokes, { size: r.penSize });
                if (svg === null) throw new Error(t("CARD_EDITOR_SIDES_EMPTY"));
                const file = await this.inkFiles.create(
                    inkFileName(stem, side),
                    svg.svg,
                    sourcePath,
                );
                created.push(file);
                return inkEmbed(this.inkFiles.linkPath(file, sourcePath));
            };

            const front = await sideText(result.front, "front");
            const back = await sideText(result.back, "back");
            if (front.length === 0 || back.length === 0)
                throw new Error(t("CARD_EDITOR_SIDES_EMPTY"));
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
     * A side is ink if its text is exactly one embed of an ink SVG with stored strokes.
     * Anything else, including a missing or unreadable SVG, opens as text, so nothing is lost.
     */
    private async loadSide(text: string, sourcePath: string): Promise<LoadedSide> {
        const penSize = this.settings.cardEditorPenSize;
        const asText: LoadedSide = {
            text,
            file: null,
            svg: "",
            state: { mode: "text", text, strokes: [], penSize },
        };

        // The embed's own link path, so a file of the same name in another folder isn't used
        const linkPath = inkEmbedPath(text);
        if (linkPath === null) return asText;
        const file = this.inkFiles.resolve(linkPath, sourcePath);
        if (file === null) return asText;

        try {
            const svg = await this.inkFiles.read(file);
            const ink = svgToStrokes(svg);
            if (ink === null) return asText;
            return {
                text,
                file,
                svg,
                state: { mode: "ink", text: "", strokes: ink.strokes, penSize: ink.size },
            };
        } catch (err) {
            console.error("SR: reading the ink image failed", err);
            return asText;
        }
    }

    /**
     * Saves an edited card:
     * - ink → ink: overwrites the SVG if the strokes changed, the side's text stays as it is
     * - text → ink: a new SVG, named after the card's other ink side if it has one
     * - ink → text: the SVG goes to the trash, once the note is written
     * Then writes the note if the text changed. On failure, everything is undone.
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
        /** For each file in toTrash: links to it from other cards and notes */
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
            if (r.mode === "text") {
                if (r.text === loaded.text) return r.text;
                const text = this.typedText(r.text);
                if (loaded.file) toTrash.push(loaded.file);
                return protect ? protectBlankLines(text, this.settings) : text;
            }

            if (loaded.file && !r.changed) return loaded.text;
            const svg = strokesToSvg(r.strokes, { size: r.penSize });
            if (svg === null) throw new Error(t("CARD_EDITOR_SIDES_EMPTY"));
            if (loaded.file) {
                await this.inkFiles.overwrite(loaded.file, svg.svg);
                overwritten.push(loaded);
                return loaded.text;
            }
            const file = await this.inkFiles.create(
                inkFileName(newStem(side), side),
                svg.svg,
                sourcePath,
            );
            created.push(file);
            return inkEmbed(this.inkFiles.linkPath(file, sourcePath));
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
            // Counted before the note is written: once Obsidian's link index has caught up with
            // the write, it no longer includes this card's old embeds
            for (const file of toTrash) {
                linksOutside.set(file, this.linksOutsideCard(file, card.original));
            }
            if (text !== card.original && !(await writeText(text)))
                throw new Error(t("CARD_EDITOR_TEXT_NOT_FOUND"));
        } catch (err) {
            await this.undoSave(created, overwritten);
            throw err;
        }

        // The card no longer shows these images; keep those other cards or notes still embed
        for (const file of toTrash) {
            if (linksOutside.get(file) > 0 || embedsOf(file, text) > 0) continue;
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
    private linksOutsideCard(file: TFile, cardText: string): number {
        return this.inkFiles.linkCount(file) - embedsOf(file, cardText);
    }

    /**
     * A typed side's text, trimmed. Throws if a line in it would split or end the card,
     * so the editor stays open with a notice.
     */
    private typedText(text: string): string {
        const marker = cardMarkerLine(text, this.settings);
        if (marker !== null) throw new Error(t("CARD_EDITOR_SIDE_HAS_MARKER", { line: marker }));
        return text.trim();
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

/** How many times the text embeds the ink file */
function embedsOf(file: TFile, text: string): number {
    return inkEmbedFileNames(text).filter((name) => name === file.name).length;
}

/** The first question whose text embeds the ink image with that file name, or null */
export function findQuestionWithInk(questions: Question[], imageName: string): Question | null {
    return (
        questions.find((question) =>
            inkEmbedFileNames(question.questionText.actualQuestion).includes(imageName),
        ) ?? null
    );
}
