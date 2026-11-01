import { MULTI_SCHEDULING_EXTRACTOR } from "src/data/constants";
import { IDataStore, StorageType } from "src/data/data-store/base/data-store";
import { IFileModifier } from "src/data/data-store/base/file-modifier";
import { RepItemStorageInfo } from "src/data/data-store/base/rep-item-storage-info";
import { CardType, isMultiLine, Question } from "src/data/data-structures/card/questions/question";
import { SRSettings } from "src/data/settings";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { CommentParser } from "src/utils/comment-parser";
import { MultiLineTextFinder } from "src/utils/strings";

export class NotesDataStore implements IDataStore {
    public readonly storageType = StorageType.NOTES;
    private settings: SRSettings;
    public readonly fileModifier: IFileModifier;
    public isStructureInitialized: Promise<boolean>;

    constructor(settings: SRSettings, scheduleDeleter: IFileModifier) {
        this.settings = settings;
        this.fileModifier = scheduleDeleter;
        this.isStructureInitialized = Promise.resolve(true);
    }

    /**
     * Creates scheduling information from a question text and its storage info.
     *
     * @param originalQuestionText
     * @param _
     * @returns
     */
    createSchedule(originalQuestionText: string, _: RepItemStorageInfo): RepItemScheduleInfo[] {
        const schedulingComment = originalQuestionText.match(/<!--SR:(.+?)-->/m)?.[1];
        if (schedulingComment) {
            return CommentParser.parseMultiScheduleComment(schedulingComment) ?? [];
        }

        // Handle legacy scheduling comments for backward compatibility, but prefer the multi-scheduling format if both are presentwd
        const sm2MultiScheduling = [...originalQuestionText.matchAll(MULTI_SCHEDULING_EXTRACTOR)];
        if (sm2MultiScheduling.length > 0) {
            return sm2MultiScheduling
                .map((match) =>
                    CommentParser.parseSM2Schedule(
                        match[1],
                        parseInt(match[2]),
                        parseInt(match[3]),
                    ),
                )
                .filter((info): info is RepItemScheduleInfo => info !== null);
        }
        return [];
    }

    /**
     * Removes scheduling information from a question text.
     *
     * @param questionText
     * @returns
     */
    removeScheduleInfo(questionText: string): string {
        return questionText.replace(/<!--SR:.+-->/gm, "");
    }

    /**
     * Writes scheduling information to the data store.
     *
     * @param question
     * @returns
     */
    async writeSchedule(question: Question): Promise<void> {
        await this.write(question);
    }

    /**
     * Writes a question to the data store.
     *
     * @param question
     * @returns
     */
    async write(question: Question): Promise<void> {
        const fileText: string = await question.note.file.read();
        const newText: string = question.updateQuestionWithinNoteText(fileText, this.settings);
        await question.note.file.write(newText);
        question.hasChanged = false;
    }

    /**
     * Deletes a question from the data store.
     *
     * @param question
     * @returns false, deleting nothing, when the question's text is no longer in the note
     */
    async delete(question: Question): Promise<boolean> {
        const fileText: string = await question.note.file.read();
        const newText = removeQuestionText(
            fileText,
            question.questionText.original,
            question.questionType,
            this.settings,
        );

        // Only write if note hasn't changed
        if (newText === null) return false;
        await question.note.file.write(newText);
        return true;
    }
}

/** Stands in for the question's text while the lines around it are tidied up */
const QUESTION_PLACEHOLDER = "\u0000SR-QUESTION\u0000";

/**
 * The note's text without the question: its text with the schedule (`original`) and, for a
 * multi-line card, the end marker line closing it. The blank lines that separated the card from
 * the text around it become one. Null when the question's text is not in the note.
 */
export function removeQuestionText(
    noteText: string,
    original: string,
    cardType: CardType,
    settings: SRSettings,
): string | null {
    const replaced = MultiLineTextFinder.findAndReplace(noteText, original, QUESTION_PLACEHOLDER);
    if (replaced === null) return null;
    const lines = replaced.split("\n");
    const i = lines.findIndex((line) => line.includes(QUESTION_PLACEHOLDER));
    // The card shares its line with other text: only the card goes
    if (lines[i].trim() !== QUESTION_PLACEHOLDER) return replaced.replace(QUESTION_PLACEHOLDER, "");
    lines.splice(i, 1);

    const marker = settings.multilineCardEndMarker;
    if (marker && isMultiLine(cardType)) {
        let j = i;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length && lines[j].trim() === marker) lines.splice(i, j - i + 1);
    }
    // One blank line where the card was, none at the start of the note
    while (i < lines.length && lines[i].trim() === "" && (i === 0 || lines[i - 1].trim() === ""))
        lines.splice(i, 1);
    return lines.join("\n");
}
