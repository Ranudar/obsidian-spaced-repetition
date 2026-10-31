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

| Button       | What it does                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Save & next  | Inserts the card, clears both sides and counts the card next to the buttons ("3 card(s) added"), so you can write the next one right away. |
| Save & close | Inserts the card and closes the editor.                                                                                                    |
| Discard      | The first tap changes the button to "Tap again to discard". A second tap within 3 seconds throws the card away and closes the editor.      |

The save buttons stay disabled until both sides have content. `Ctrl/Cmd + Enter` does the same as
**Save & next**.

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
![[pencards/pencard-20261031-141502123-back.svg]]
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

Each side has a switch with two buttons: **⌨** (type) and **✎** (write by hand).

- **Default input mode**: new cards start in the mode set in the settings (text by default).
- **The pen switches for you**: touching a typed side with a stylus switches it to handwriting, and
  the same touch already starts writing. You can turn this off in the settings.
- **The keyboard switches back**: pressing a key while an empty handwritten side is focused
  switches it to text and types that key.
- **Both drafts are kept**: if a side has text and you switch to handwriting (or the other way
  round), the other draft is kept until you save. The mode that is visible when you save wins,
  and a hint under the side tells you what will be replaced.

In a typed side, `Tab` inserts a tab character, like the old edit dialog.

### Pen Tools

The header holds the pen tools. They are only enabled while at least one side is in handwriting mode.

| Tool       | What it does                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Eraser     | Erase strokes by touching or dragging over them. Holding the pen's side button, or using its eraser end, erases too. |
| Undo       | Undoes the last pen change, on either side. `Ctrl/Cmd + Z` does the same outside a text field.                       |
| Clear side | Removes all strokes from the side you last used. Undo brings them back.                                              |

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

In reading view and live preview, every handwritten card image is shown in a box with a pencil
button in its corner. Tap the pencil on the front or the back to open the **whole card** in the
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

A side only counts as handwritten if its text is exactly one embed of a `pencard-….svg` image.
Anything else, including an image whose strokes can't be read, opens as text, so nothing gets lost.

## Settings

The settings are in the **Card editor** section of the flashcard settings.

| Setting                                   | Default    | Description                                                                                           |
| ----------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| Default input mode                        | Text       | How the front and back of a new card start: text or pen.                                              |
| Switch to pen when the pen touches a side | On         | Touching a typed side with a stylus switches it to handwriting.                                       |
| Pen only                                  | On         | Ignore finger touches on the writing fields. Turn off to write with a finger or mouse.                |
| Image folder                              | `pencards` | Where handwritten card images are saved. Leave empty to use Obsidian's attachment location.           |
| Guide lines                               | Lined      | Background of the writing fields: lined, dotted, grid or none. The guides are not saved in the image. |
| Line spacing                              | 44         | Distance between guide lines, in pixels (24–80).                                                      |
| Pen thickness                             | 5          | Stroke width for new handwriting (2–12). Existing images keep the thickness they were written with.   |

The card separator and the end marker are Spaced Repetition's own
[flashcard separator settings](../user-options.md#flashcard-separators).

## Migrating from Pen Cards

The card editor replaces the separate Pen Cards plugin.

- Your existing handwritten cards keep working: the editor uses the same file names
  (`pencard-…-front.svg`, `pencard-…-back.svg`) and the same SVG format, and can edit them.
- The default image folder is `pencards`, like in Pen Cards. If you used another folder, set it
  under **Image folder**. Existing images stay where they are; only new images go to that folder.
- **Disable the Pen Cards plugin.** While it is still enabled, Spaced Repetition shows a notice at
  startup, because both plugins would add a pencil button to every handwritten image.
- The Pen Cards command **Create cards** is replaced by **Spaced Repetition: Add card**. If you had it on the mobile
  toolbar or bound to a hotkey, add the new command instead.
