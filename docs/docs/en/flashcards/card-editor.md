# Card Editor

The card editor lets you add and edit flashcards without typing the card syntax yourself.
Each side of a card (front and back) can be **typed** on a keyboard or **written by hand** with a pen,
and you can switch a side between the two at any time.

Handwritten sides are saved as SVG images in your vault. The image also stores the original pen
strokes, so you can open a handwritten card later and keep writing, erase or undo.

## Adding Cards

1. Open the note the cards should go into.
2. Run the command **Spaced Repetition: Add card**, from the command palette, the mobile toolbar or
   the mobile pull-down menu. The command is available whenever the active file is a Markdown note.
3. Fill in the front and the back, typing or writing by hand.
4. Choose how to continue:

| Button       | What it does                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Save & next  | Inserts the card and clears both sides, so you can write the next one right away.                                                     |
| Save & close | Inserts the card and closes the editor.                                                                                               |
| Discard      | The first tap changes the button to "Tap again to discard". A second tap within 3 seconds throws the card away and closes the editor. |

The buttons sit in one row at the bottom, **Discard** on the left and **Save & next** (the main
button) on the right; they fit on small phone screens too. The save buttons stay disabled until both
sides have content. `Ctrl/Cmd + Enter` does the same as **Save & next**.

Once you have saved a card, a small badge next to the note's name in the header counts the cards
added in this session (for example "2 added").

### Where the Card Goes

- If the note is open in an editor (source mode or live preview), the card is inserted below the
  line with the cursor. When the cursor is inside the note's properties, a card, a code block or a
  paragraph, the card goes after it, so nothing is split. The next cards follow it, one after the
  other.
- Otherwise (reading view, or no editor open), the card is added at the end of the note.

The editor always creates [multi-line basic](q-and-a-cards.md#multi-line-basic) cards, using the
separator from your [settings](../user-options.md#flashcard-separators). A handwritten side is stored
as a single image embed:

```markdown
What is the powerhouse of the cell?
?
![[sr-ink/sr-ink-20261031-141502123-back.svg]]
```

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
draft, including any handwriting. The next **Add card** opens with that draft. **Discard** and an
empty card leave no draft behind. Drafts are kept until Obsidian is closed or the plugin is reloaded.

## Typing and Writing by Hand

Each side has a switch with two parts: **Text** (keyboard icon) and **Pen** (pen icon). Tap one to
choose how you fill that side.

- **Default input mode**: new cards start in the mode set in the settings (text by default).
- **You choose the mode**: the editor never switches a side on its own. Touching a typed side with
  the pen or typing on a handwritten side does not change the mode; tap the switch instead.
- **Nothing moves**: the text field and the writing field have exactly the same size, so switching
  only swaps what is inside. On phones and tablets, switching to text does not open the soft
  keyboard; tap the text field when you want to type. The editor also keeps its height while the
  soft keyboard is open (it scrolls instead), so the sides don't jump. On desktop, choosing Text
  puts the cursor in the text field.
- **Both drafts are kept**: if a side has text and you switch to handwriting (or the other way
  round), the other draft is kept until you save. A small dot on the other mode's button shows that
  it still holds a draft. The mode that is visible when you save wins; the other draft is dropped.

In a typed side, `Tab` inserts a tab character, like the old edit dialog. Long text scrolls with a
finger as usual.

### Pen Tools

The header holds the pen tools. They always stay in the same place and are only enabled while at
least one side is in handwriting mode.

| Tool       | What it does                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pen size   | Switches between thin, medium and thick (0.6×, 1× and 1.6× the **Pen thickness** setting). The dot in the icon shows the current size. Applies to new strokes until the editor closes; existing strokes keep their width. |
| Eraser     | Erases only the ink under the eraser, like a real eraser: a stroke you cross is cut, and the rest of it stays. Holding the pen's side button, or using its eraser end, erases too.                                        |
| Undo       | Undoes the last pen change, on either side. A whole eraser movement is one step. `Ctrl/Cmd + Z` does the same outside a text field.                                                                                       |
| Clear side | Removes all strokes from the side you last used. Undo brings them back.                                                                                                                                                   |

While erasing, a circle shows the eraser's size and position. The eraser grows with the pen size.

With **Pen only** on (the default), fingers are ignored on the writing fields, so your hand can rest
on the screen. A finger touching one of the editor's buttons while the pen is writing, or just
after, is ignored too, so a resting palm doesn't save or discard the card. Turn it off to write with
a finger or a mouse.

On phones and tablets, a typed side is not focused when the editor opens, so the soft keyboard only
appears once you tap a text field.

On phones the editor fills the screen; on desktop and tablets it opens as a large dialog. In dark
mode, handwriting is shown in light ink. The images themselves keep dark ink on a transparent
background, so they look right in both themes.

## Editing Cards

### During Review

Tap **Edit** in the review toolbar (see [Reviewing](reviewing.md#operation)). The card opens in the
same editor, with the note's name in the header and both sides: typed sides as text, handwritten sides with their strokes, ready to
change. You can also switch a side between typing and handwriting here.

- **Save** writes the changes, keeps the card's review schedule and shows the updated card.
- **Cancel**, `Esc`, the close button or the back gesture closes without writing anything.

The note is only written when the card text changed, for example when you edited typed text or
switched a side between text and handwriting. If you only changed the handwriting, just the image is
rewritten.

[Cloze cards](cloze-cards.md) open as a single text field without a pen switch.

### From a Note

In reading view and live preview, every handwritten card image is shown in a frame with a small
pencil button just outside its top-right corner, so it never covers the handwriting. Tap the pencil on the front or the back to open the **whole card** in the
editor, exactly as during review. This also works for mixed cards, for example a typed front with a
handwritten back.

After saving, every visible copy of a changed image reloads. When the card text changed, the note
is updated and Spaced Repetition rescans your notes.

Inside the review window, the pencil does the same as the **Edit** button. If the image is not part
of any card in the note, a notice says so. Images in Canvas text nodes get a pencil, but can't be
edited from there.

### What Happens to the Images

| Change                             | Result                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| Handwriting changed                | The same SVG file is overwritten. The note text stays the same.                |
| Handwriting unchanged              | Nothing is written.                                                            |
| Typed side switched to handwriting | A new SVG file is created, named like the card's other image if it has one.    |
| Handwritten side switched to text  | The old SVG file is moved to the trash, unless another note or card embeds it. |

A side only counts as handwritten if its text is exactly one embed of a `sr-ink-….svg` image.
Anything else, including an image whose strokes can't be read, opens as text, so nothing gets lost.

## Settings

The settings are in the **Card editor** section of the flashcard settings.

| Setting            | Default  | Description                                                                                           |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| Default input mode | Text     | How the front and back of a new card start: text or pen.                                              |
| Pen only           | On       | Ignore finger touches on the writing fields. Turn off to write with a finger or mouse.                |
| Image folder       | `sr-ink` | Where handwritten card images are saved. Leave empty to use Obsidian's attachment location.           |
| Guide lines        | Lined    | Background of the writing fields: lined, dotted, grid or none. The guides are not saved in the image. |
| Line spacing       | 44       | Distance between guide lines, in pixels (24–80).                                                      |
| Pen thickness      | 2.5      | Stroke width for new handwriting (1–8). Existing images keep the thickness they were written with.    |

The card separator and the end marker are Spaced Repetition's own
[flashcard separator settings](../user-options.md#flashcard-separators).
