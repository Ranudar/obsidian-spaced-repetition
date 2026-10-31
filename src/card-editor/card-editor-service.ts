import { TFile } from "obsidian";

import {
    CardEditorModal,
    CardEditorResult,
    CardEditorSides,
    SideResult,
} from "src/card-editor/card-editor-modal";
import {
    composeCardText,
    inkEmbed,
    inkEmbedFileName,
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
import { SRSettings } from "src/data/settings";
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

    constructor(plugin: SRPlugin, settingsManager: SettingsManager) {
        this.plugin = plugin;
        this.settingsManager = settingsManager;
        this.inkFiles = new InkFiles(plugin.app, () => this.settings.cardEditorImageFolder);
    }

    private get settings(): SRSettings {
        return this.settingsManager.settings;
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
