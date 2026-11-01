import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { ISRNoteTFile } from "src/data/data-structures/file/note-file";
import { SRSettings } from "src/data/settings";
import { NoteQuestionParser } from "src/note/note-question-parser";

/**
 * The decks a new card goes into when it starts on lineNum (0-based) of the note's text: with
 * folders as decks the note's folder, else the flashcard tags that apply there by SR's parser
 * (frontmatter tags, or the last tag line before it, e.g. "#flashcards/medicine"). Empty when SR
 * doesn't pick up cards in the note.
 */
export function noteDecks(
    note: ISRNoteTFile,
    noteText: string,
    lineNum: number,
    settings: SRSettings,
): TopicPath[] {
    if (settings.convertFoldersToDecks) {
        const folder = TopicPath.getFolderPathFromFilename(note, settings);
        return folder.hasPath ? [folder] : [];
    }
    const parser = new NoteQuestionParser(settings);
    return parser.topicPathListAtLine(note, noteText, lineNum)?.list ?? [];
}

/**
 * Deck names as the card editor shows them, without duplicates: a folder path as it is; a tag
 * without the flashcard tag it is under ("#flashcards/medicine" → "medicine"), the flashcard tag
 * itself by its name ("#flashcards" → "flashcards").
 */
export function deckNames(decks: TopicPath[], settings: SRSettings): string[] {
    const flashcardTags = settings.convertFoldersToDecks
        ? []
        : TopicPath.getTopicPathsFromTagList(settings.flashcardTags);
    const names = decks
        .filter((deck) => deck.hasPath)
        .map((deck) => {
            const tag = flashcardTags.find((t) => t.isSameOrAncestorOf(deck));
            if (tag === undefined) return deck.path.join("/");
            const below = deck.path.slice(tag.path.length);
            return below.length > 0 ? below.join("/") : tag.path.join("/");
        });
    return [...new Set(names)];
}
