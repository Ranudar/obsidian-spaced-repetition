# Card editor: card types, preview, deck

Follow-up to `card-editor-fixed-zones.md` (layout, left-handed mode, ‹ › navigation are done).

## 1. Card type when adding

- A compact **type chip** in the title bar (add mode), e.g. `Basic ▾`, opens a small Obsidian
  `Menu` with **Basic**, **Reversed**, **Cloze**. The choice is kept for the following cards of
  this editor session (and for a draft). Default Basic.
- **Basic** writes a multi-line card with `multilineCardSeparator` (`?`), as today.
- **Reversed** writes a multi-line reversed card with `multilineReversedCardSeparator` (`??`).
  Same layout as Basic (front/back, pen and text).
- **Cloze** switches the editor to a **cloze layout**: one side, keyboard only — no pen zone, no
  Front ⇅ Back switch; the text zone fills the left column below the tool row; the right column
  holds only the save buttons (full height). Tool row: label `CLOZE`, a **Mark as cloze** button
  (wraps the selection in the first configured cloze pattern, `settings.clozePatterns[0]`, e.g.
  `==…==`; with no selection it inserts the empty pattern and puts the cursor inside), undo/clear
  as applicable, the preview toggle. Hint: "Type the text, then mark the parts to ask for".
  Saving inserts the text as a cloze card (with the end marker if one is set) and must be read
  back by SR's parser as a cloze card (reuse the existing "read back as card" check); text with
  no cloze is refused with a notice ("Mark at least one part as cloze").
- Switching the type with content already on the card: Basic ⇄ Reversed keeps everything; to
  Cloze keeps the front's text (handwriting can't go into a cloze: if a side has handwriting,
  ask first via the existing two-tap pattern or refuse with a notice — pick the simpler clear one);
  from Cloze to Basic/Reversed puts the text on the front.
- Single-line types (`::`, `:::`) are not offered when adding.

## 2. Basic ⇄ Reversed when editing

- In edit mode the same chip shows the card's type. For basic/reversed cards it offers the other
  one: multi-line `?` ⇄ `??`, single-line `::` ⇄ `:::`. Cloze cards show `Cloze` without options.
- Changing the type only changes the separator when saving (the rest of the save path as today;
  the schedule comment stays). Show a short notice on the change explaining the consequence:
  to Reversed — "The reverse direction becomes a new card"; to Basic — "The reverse direction's
  schedule is dropped".
- Make sure SR reads the saved card back as the new type (parser check) and that the review
  sequencer copes when the edit happens from the review window (card count of the question
  changes): at least no crash; redraw or move on sensibly.

## 3. Preview

- An **eye** toggle in the tool row. On: the text zone shows the side's text rendered with
  Obsidian's `MarkdownRenderer` (LaTeX, formatting, code; embeds of the side's own handwriting
  not needed). Tapping the preview (or the toggle) returns to typing with the cursor at the end.
  Off by default; the state is kept while the editor is open. Works for cloze text too (shows the
  markup rendered; highlighting is fine).
- Rendering is cleaned up (component unloaded) when switching sides, toggling off and closing.

## 4. Deck shown

- The title bar shows, under or after the note title in a small muted line, the deck(s) the card
  will belong to: from the note's flashcard tags (`#flashcards/medicine` → `medicine`; plain
  `#flashcards` → the default deck name SR uses), or, with "folders as decks", the folder path.
  No selection, no inbox. If the note has no flashcard tag and folders aren't decks, show the
  existing warning text ("not a flashcard note") in that place instead of a toast.

## Tool row space

The tool row now has up to six controls (size, eraser, undo, clear, preview, Mark as cloze in
cloze mode). Keep 40 px buttons; reduce gaps as needed so it fits a 384 px wide phone with the
right column at 12%; the side label may shrink (e.g. `FRONT` stays bold but smaller).

## Acceptance

- Tests for the important paths: type chip choices and what each writes (`?`, `??`, cloze),
  cloze layout (no pen zone, no switch), Mark as cloze wraps the selection, cloze without a
  deletion refused, edit-mode Basic ⇄ Reversed writes the other separator and keeps the schedule
  comment, preview renders and returns to typing, deck line text for tag / folder / none.
- jest, tsc, eslint (0 errors), prettier --check, pnpm run build pass. User docs updated.
