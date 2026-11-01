import { TopicPath, TopicPathList } from "src/data/data-structures/deck/topic-path";
import { ISRNoteTFile } from "src/data/data-structures/file/note-file";
import { SRSettings } from "src/data/settings";

/**
 * The decks a new card of the note goes into: with folders as decks the note's folder, else its
 * flashcard tags (incl. frontmatter tags), e.g. "#flashcards/medicine". Empty when SR doesn't
 * pick up cards in the note.
 */
export function noteDecks(note: ISRNoteTFile, settings: SRSettings): TopicPath[] {
    if (settings.convertFoldersToDecks) {
        const folder = TopicPath.getFolderPathFromFilename(note, settings);
        return folder.hasPath ? [folder] : [];
    }
    return TopicPathList.filterValidTopicPathsFromTagList(
        TopicPathList.convertTagListToTopicPathList(note.getAllTagsFromCache()),
        TopicPathList.convertTagListToTopicPathList(settings.flashcardTags),
    ).list;
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
