import { MarkdownView, Notice, TFile } from "obsidian";

import {
    CardEditorModal,
    CardEditorResult,
    CardEditorSides,
    SideResult,
} from "src/card-editor/card-editor-modal";
import { CardInserter } from "src/card-editor/card-inserter";
import {
    composeCardText,
    inkEmbed,
    inkEmbedFileName,
    newCardBody,
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
import { Question } from "src/data/data-structures/card/questions/question";
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

/** A side of an existing card, as found in the note */
interface LoadedSide {
    /** The side's text in the note */
    text: string;
    /** The ink file, if the side is handwritten and its strokes could be read */
    file: TFile | null;
    state: SideState;
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

        const inserter = new CardInserter(this.plugin.app, file, view);
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
     * Opens the editor for a question and writes its ink files on save.
     * Resolves to the new question text, or null when the editor was closed without saving.
     * Does not write the note: that is up to the caller, and only needed when textChanged is set.
     */
    async editQuestion(question: Question): Promise<EditQuestionResult | null> {
        const cardType = question.questionType;
        const original = question.questionText.actualQuestion;
        const sourcePath = question.note.file.path;

        const split = splitCardText(cardType, original, this.settings);
        const front = await this.loadSide(split.front, sourcePath);
        const back = split.back === null ? null : await this.loadSide(split.back, sourcePath);
        const initial: CardEditorSides = { front: front.state, back: back?.state ?? null };

        return new Promise((resolve) => {
            let result: EditQuestionResult | null = null;
            new CardEditorModal(this.plugin.app, this.settings, {
                kind: "edit",
                title: t("CARD_EDITOR_EDIT_TITLE"),
                textDirection: question.questionText.textDirection,
                initial,
                cardType,
                save: async (r: CardEditorResult) => {
                    const sides = await this.saveSides(r, front, back, sourcePath);
                    const text = composeCardText(cardType, sides.front, sides.back, this.settings);
                    result = {
                        text,
                        textChanged: text !== original,
                        changedImages: sides.changedImages,
                    };
                },
                closed: () => resolve(result),
            }).open();
        });
    }

    /**
     * Writes the ink files of a new card and inserts the card.
     * Both handwritten sides share the stem of their file names (Pen Cards' scheme).
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
                if (r.mode === "text") return r.text.trim();
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
            state: { mode: "text", text, strokes: [], penSize },
        };

        const name = inkEmbedFileName(text);
        if (name === null) return asText;
        const file = this.inkFiles.resolve(name, sourcePath);
        if (file === null) return asText;

        try {
            const ink = svgToStrokes(await this.inkFiles.read(file));
            if (ink === null) return asText;
            return {
                text,
                file,
                state: { mode: "ink", text: "", strokes: ink.strokes, penSize: ink.size },
            };
        } catch (err) {
            console.error("SR: reading the ink image failed", err);
            return asText;
        }
    }

    /**
     * Writes the ink files of an edited card and returns the new text of its sides:
     * - ink → ink: overwrites the SVG if the strokes changed, the side's text stays as it is
     * - text → ink: a new SVG, named after the card's other ink side if it has one
     * - ink → text: the SVG goes to the trash
     */
    private async saveSides(
        result: CardEditorResult,
        front: LoadedSide,
        back: LoadedSide | null,
        sourcePath: string,
    ): Promise<{ front: string; back: string | null; changedImages: TFile[] }> {
        const changedImages: TFile[] = [];
        const toTrash: TFile[] = [];

        // Both sides of a card share the stem of their file names (Pen Cards' scheme)
        let stem: string | null = null;
        for (const side of [front, back]) {
            const parsed = side?.file ? parseInkFileName(side.file.name) : null;
            if (parsed) {
                stem = parsed.stem;
                break;
            }
        }
        const newStem = (side: InkSide): string => {
            // Never reuse a name that is already taken, e.g. by a file left over from a deleted card
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
                if (loaded.file) toTrash.push(loaded.file);
                return r.text;
            }

            if (loaded.file && !r.changed) return loaded.text;
            const svg = strokesToSvg(r.strokes, { size: r.penSize });
            if (svg === null) throw new Error(t("CARD_EDITOR_SIDES_EMPTY"));
            if (loaded.file) {
                await this.inkFiles.overwrite(loaded.file, svg.svg);
                changedImages.push(loaded.file);
                return loaded.text;
            }
            const file = await this.inkFiles.create(
                inkFileName(newStem(side), side),
                svg.svg,
                sourcePath,
            );
            return inkEmbed(this.inkFiles.linkPath(file, sourcePath));
        };

        const frontText = await saveSide(result.front, front, "front");
        const backText =
            back !== null && result.back !== null
                ? await saveSide(result.back, back, "back")
                : null;

        // Only after all new files exist, so a failed save leaves the card as it was
        for (const file of toTrash) await this.inkFiles.trash(file);

        return { front: frontText, back: backText, changedImages };
    }
}
