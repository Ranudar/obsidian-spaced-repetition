# Card Editor

The card editor lets you add and edit flashcards without typing the card syntax yourself.
Each side of a card (front and back) can hold **typed** text and **handwriting** at the same time:
type on the keyboard and write with the pen, no switching needed.

Handwriting is saved as SVG images in your vault. The image also stores the original pen
strokes, so you can open a handwritten card later and keep writing, erase or undo.

## Adding Cards

1. Open the note the cards should go into.
2. Run the command **Spaced Repetition: Add card**, from the command palette, the mobile toolbar or
   the mobile pull-down menu. The command is available whenever the active file is a Markdown note.
3. Fill in the front and the back, typing, writing by hand or both.
4. Choose how to continue:

| Button       | What it does                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Save & next  | Inserts the card and clears both sides, so you can write the next one right away.                                                                                                             |
| Save & close | Inserts the card and closes the editor.                                                                                                                                                       |
| Delete card  | Throws the card away and closes the editor. On an empty card one tap does it; otherwise the first tap changes the button to "Tap again to delete", and a second tap within 3 seconds deletes. |

The buttons sit in one row at the bottom, **Delete card** on the left and **Save & next** (the main
button) on the right; they fit on small phone screens too. The save buttons stay disabled, and look
it, until both sides have content. `Ctrl/Cmd + Enter` does the same as **Save & next**.

Once you have saved a card, a small badge next to the note's name in the header counts the cards
added in this session (for example "2 added").

### Where the Card Goes

- If the note is open in an editor (source mode or live preview), the card is inserted below the
  line with the cursor. When the cursor is inside the note's properties, a card, a code block or a
  paragraph, the card goes after it, so nothing is split. The next cards follow it, one after the
  other.
- Otherwise (reading view, or no editor open), the card is added at the end of the note.

The editor always creates [multi-line basic](q-and-a-cards.md#multi-line-basic) cards, using the
separator from your [settings](../user-options.md#flashcard-separators). A side is stored as its
typed text, followed by one image embed of its handwriting on the next line. A side with only
handwriting is just the embed, a side with only text has no embed:

```markdown
What is the powerhouse of the cell?
?
Mitochondria, drawn:
![[sr-ink/sr-ink-20261031-141502123-back.svg]]
```

In [single-line cards](q-and-a-cards.md#single-line-basic) (`::` and `:::`) the embed follows the text on the same
line, after a space: `Draw a cell::A cell ![[sr-ink/sr-ink-20261031-141502123-back.svg]]`.

If you have set `Characters denoting the end of clozes and multiline flashcards`, the editor adds it
after the card, with a blank line before it so the line above does not turn into a heading.
Without it, a blank line ends a card, so blank lines you type in a side are saved as a `<br>` line,
which also shows as an empty line.

After the editor closes, Spaced Repetition rescans your notes, so the new cards show up in the deck
counts and in review.

!!! note "Flashcard tag"

    If the note has none of your flashcard tags (for example `#flashcards`), a notice reminds you to
    add one. The editor still opens, but the cards are only reviewed once the note is tagged.
    The check is skipped when `Convert folders to decks and subdecks?` is on.

### Drafts

Closing the editor with `Esc`, the close button or the back gesture keeps the unsaved card as a
draft, including any handwriting. The next **Add card** opens with that draft. **Delete card** and an
empty card leave no draft behind. Drafts are kept until Obsidian is closed or the plugin is reloaded.

## Typing and Writing by Hand

With **Pen mode** on (see [Settings](#settings)), each side has a text field at the top (about three
lines; longer text scrolls inside it) and a writing field filling the rest of the side below it.
Type in the text field with the keyboard or a finger, write in the writing field with the pen. Both
are always there, so nothing moves while you type or write, and nothing needs to be switched. With
pen mode off, each side is a text field only.

- **Nothing moves**: both sides have the same fixed layout. The editor also keeps its height while
  the soft keyboard is open (it scrolls instead), so the sides don't jump.
- **Keyboard**: on phones and tablets, no text field is focused when the editor opens (or after
  **Save & next**), so the soft keyboard only appears once you tap a text field. Writing in a
  writing field closes it again. On desktop the cursor starts in the front's text field.

In the text field, `Tab` inserts a tab character, like the old edit dialog, and `Ctrl/Cmd + Z`
undoes typing as usual. Right-to-left text is supported.

### Pen Tools

The header holds the pen tools. They always stay in the same place and are always enabled.

| Tool       | What it does                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pen size   | Switches between thin, medium and thick (0.6×, 1× and 1.6× the **Pen thickness** setting). The dot in the icon shows the current size. Applies to new strokes until the editor closes; existing strokes keep their width. |
| Eraser     | Erases only the ink under the eraser, like a real eraser: a stroke you cross is cut, and the rest of it stays. Holding the pen's side button, or using its eraser end, erases too.                                        |
| Undo       | Undoes the last pen change, on either side. A whole eraser movement is one step. `Ctrl/Cmd + Z` does the same outside a text field (writing moves you out of it).                                                         |
| Clear side | Removes the text and all strokes from the side you last used. Undo brings both back in one step.                                                                                                                          |

While erasing, a circle shows the eraser's size and position. The eraser grows with the pen size.

Ink only goes where you can see the writing field. If the pen slides off an edge, for example into
the text field, the stroke ends at the edge; coming back without lifting the pen starts a new
stroke there. The eraser only erases inside the field, too.

Fingers are ignored on the writing fields, so your hand can rest on the screen; on desktop the mouse
writes too. A finger touching one of the editor's buttons while the pen is writing, or just after,
is ignored too, so a resting palm doesn't save or discard the card.

On phones the editor fills the screen; on desktop and tablets it opens as a large dialog. In dark
mode, handwriting is shown in light ink. The images themselves keep dark ink on a transparent
background, so they look right in both themes.

## Editing Cards

### During Review

Tap **Edit** in the review toolbar (see [Reviewing](reviewing.md#operation)). The card opens in the
same editor, with the note's name in the header and both sides, each with its typed text and its
handwriting, ready to change.

- **Save** writes the changes, keeps the card's review schedule and shows the updated card.
- **Delete card** (two taps) removes the card from its note, with its schedule and its end marker
  line, and moves its handwriting images to the trash unless another note still shows them. During
  review, the next card is shown.
- `Esc`, the close button or the back gesture closes without writing anything.

The note is only written when the card text changed, for example when you edited typed text, wrote
on a side that had no handwriting yet or erased all of a side's handwriting. If you only changed
existing handwriting, just the image is rewritten.

[Cloze cards](cloze-cards.md) open as a single text field without a writing field.

### From a Note

In reading view and live preview, every handwritten card image is shown in a frame with a small
pencil button just outside its top-right corner, so it never covers the handwriting. Tap the pencil on the front or the back to open the **whole card** in the
editor, exactly as during review. This also works for mixed cards, for example a typed front with a
handwritten back.

After saving, every visible copy of a changed image reloads. When the card text changed, the note
is updated and Spaced Repetition rescans your notes.

In live preview, a handwriting embed counts as one unit: with the cursor right after it, one
`Backspace` deletes the whole embed, and `Delete` before it does the same, also with the Android
keyboard. The cursor jumps over it in one step. With the cursor inside the embed's text,
`Backspace` or `Delete` also deletes the whole embed. About two seconds later the image file goes to
the trash, unless the embed is back by then (undo, paste) or another note still shows it; cutting
the embed keeps the file. An embed written in inline code or a code block is plain text and is
edited as such.

Inside the review window, the pencil does the same as the **Edit** button. If the image is not part
of any card in the note, a notice says so. Images in Canvas text nodes get a pencil, but can't be
edited from there.

### What Happens to the Images

| Change                           | Result                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Handwriting changed              | The same SVG file is overwritten. The embed stays where it is.                                   |
| Handwriting unchanged            | Nothing is written.                                                                              |
| Handwriting added to a side      | A new SVG file is created, named like the card's other image if it has one.                      |
| All handwriting of a side erased | The embed is removed and the SVG file moved to the trash, unless another note or card embeds it. |

A side's handwriting is the embed of a `sr-ink-….svg` image at the very end of the side; everything
before it is the side's text. An embed anywhere else, and an image whose strokes can't be read, stay
part of the text, so nothing gets lost.

## Settings

The settings are in the **Card editor** section of the flashcard settings. The pen settings are only
shown while **Pen mode** is on.

| Setting       | Default  | Description                                                                                                                                       |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pen mode      | Off      | Give each side a field to write in with a pen, such as the S Pen. Off: cards are typed only; handwriting a card already has can still be changed. |
| Image folder  | `sr-ink` | Where handwritten card images are saved. Leave empty to use Obsidian's attachment location.                                                       |
| Guide lines   | Lined    | Background of the writing fields: lined, dotted, grid or none. The guides are not saved in the image.                                             |
| Line spacing  | 44       | Distance between guide lines, in pixels (24–80).                                                                                                  |
| Pen thickness | 2.5      | Stroke width for new handwriting (1–8). Existing images keep the thickness they were written with.                                                |

The card separator and the end marker are Spaced Repetition's own
[flashcard separator settings](../user-options.md#flashcard-separators).
