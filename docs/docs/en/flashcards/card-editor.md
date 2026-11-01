# Card Editor

The card editor lets you add and edit flashcards without typing the card syntax yourself.
Each side of a card (front and back) can hold **typed** text and **handwriting** at the same time:
type on the keyboard and write with the pen, no switching needed. You edit one side at a time.

Handwriting is saved as SVG images in your vault. The image also stores the original pen
strokes, so you can open a handwritten card later and keep writing, erase or undo.

## Adding Cards

1. Open the note the cards should go into.
2. Run the command **Spaced Repetition: Add card**, from the command palette, the mobile toolbar or
   the mobile pull-down menu. The command is available whenever the active file is a Markdown note.
3. Fill in the front, then tap the **Front ⇅ Back** button on the right (on the left with **Buttons on the left**) to fill in the back. Type,
   write by hand or both.
4. Choose how to continue, with the buttons on the right below the switch:

| Button       | What it does                                                                      |
| ------------ | --------------------------------------------------------------------------------- |
| Save & next  | Inserts the card, clears both sides and shows the front, ready for the next card. |
| Save & close | Inserts the card and closes the editor.                                           |

**Save & next** is the large main button; **Save & close** is the smaller one below it. If a side
is still empty when you save, the editor shows that side, outlines it briefly and says so (for
example "Back is empty"); nothing is saved yet. `Ctrl/Cmd + Enter` does the same as **Save & next**.

The bin in the title bar is **Delete card**: it throws the card away and closes the editor. On an
empty card one tap does it; otherwise the first tap changes the button to "Tap again to delete",
and a second tap within 3 seconds deletes. The ✕ next to it closes the editor without saving.

Once you have saved a card, a small badge next to the note's name in the title bar counts the
cards added in this session (for example "2 added").

Under the note's name, a small line shows the deck the card will go into: from the note's
flashcard tags (`#flashcards/medicine` shows as "Deck: medicine", plain `#flashcards` as "Deck:
flashcards"), or, with `Convert folders to decks and subdecks?` on, the note's folder. A note with
several flashcard tags shows all its decks. If the note has none of your flashcard tags, that line
says so instead (see [Flashcard tag](#where-the-card-goes)); with folders as decks, a note at the
vault root is in no deck, and the line says that.

### Card Type

The button in the title bar next to the note's name (`Basic ▾`) picks the type of the new card:

| Type     | What is written                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| Basic    | A [multi-line basic](q-and-a-cards.md#multi-line-basic) card, with front and back separated by `?`.             |
| Reversed | A [multi-line reversed](q-and-a-cards.md#multi-line-bidirectional) card, separated by `??`: reviewed both ways. |
| Cloze    | A [cloze card](cloze-cards.md): one text, with the parts to ask for marked.                                     |

The type stays for the following cards until you change it, and is kept with a draft. Basic is the
default. Single-line cards (`::`, `:::`) can't be added with the editor.

**Cloze** switches the editor to a single side, typed only: no pen zone and no **Front ⇅ Back**
switch; the text zone fills the editor and the save buttons take the whole column beside it. Type
the text, then select a part to ask for and tap **Mark as cloze** (the highlighter in the tool row):
it puts your first [cloze pattern](cloze-cards.md) around the selection, for example `==four==`.
Without a selection it inserts the empty pattern, with the cursor inside. A cloze stays on one
line: mark a selection over several lines line by line. A cloze card without a
marked part is not saved ("Mark at least one part as cloze").

Switching between Basic and Reversed keeps both sides. Switching to Cloze keeps the front's text
(the back is dropped); if a side has handwriting, the editor says so and stays on the type, as a
cloze card can't hold handwriting. Switching from Cloze back puts the text on the front.

### Where the Card Goes

- If the note is open in an editor (source mode or live preview), the card is inserted below the
  line with the cursor. When the cursor is inside the note's properties, a card, a code block or a
  paragraph, the card goes after it, so nothing is split. The next cards follow it, one after the
  other.
- Otherwise (reading view, or no editor open), the card is added at the end of the note.

The editor creates multi-line basic or reversed cards (see [Card type](#card-type)), using the
separators from your [settings](../user-options.md#flashcard-separators). A side is stored as its
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
after the card (also after a cloze card), with a blank line before it so the line above does not turn into a heading.
Without it, a blank line ends a card, so blank lines you type in a side are saved as a `<br>` line,
which also shows as an empty line.

After the editor closes, Spaced Repetition rescans your notes, so the new cards show up in the deck
counts and in review.

!!! note "Flashcard tag"

    If the note has none of your flashcard tags (for example `#flashcards`), the line under the
    note's name in the title bar reminds you to add one. The editor still opens, but the cards are
    only reviewed once the note is tagged. With `Convert folders to decks and subdecks?` on, the
    line shows the note's folder instead.

### Drafts

Closing the editor with `Esc`, ✕ or the back gesture keeps the unsaved card as a
draft, including any handwriting. The next **Add card** opens with that draft. **Delete card** and an
empty card leave no draft behind. Drafts are kept until Obsidian is closed or the plugin is reloaded.

## Typing and Writing by Hand

The editor shows one side at a time, always in the same places:

- At the top, the **tool row**: the side's name (**FRONT** or **BACK**), the pen tools and the
  preview.
- Below it, the **pen zone**, with a fixed height, for the pen ("Draw on **front**").
- Below that, the **text zone**, filling the rest of the editor, for the keyboard ("Type the
  **question**" on the front, "Type the **answer**" on the back). Long text scrolls inside it.
- On the right, the **Front ⇅ Back** switch, exactly as tall as the pen zone, with the side shown
  in bold; below it, beside the text zone, the save buttons. With **Buttons on the left** (see
  [Settings](#settings)) this column is on the left instead.

The side shown is also marked by a broad coloured edge on both fields: on the left for the front,
on the right for the back, so you work from left to right. Each side keeps its own text and handwriting when you switch.

- **Nothing moves**: the pen zone stays at the top with the same height on both sides. On phones and
  tablets the editor fills the screen above the soft keyboard; only the text zone and the save
  buttons get shorter or taller when the keyboard opens or closes.
- **Keyboard**: the cursor starts in the front's text zone, also on phones and tablets, so the soft
  keyboard opens with the editor and stays open: writing with the pen and tapping the editor's
  buttons don't take the cursor away. Switching sides moves the cursor to the other side's text
  zone; **Save & next** moves it back to the front.

With **Pen mode** off (see [Settings](#settings)), there is no pen zone: the text zone takes its
place, and the switch and the save buttons share the right column. A side that already has
handwriting still shows its pen zone, so you can change it.

### Preview

The eye in the tool row shows the side's text rendered as in a note: formatting, LaTeX, code,
links and, for cloze cards, the marked parts. Tap the preview (or the eye again) to go back to
typing, with the cursor at the end of the text. The preview stays on when you switch sides, after
**Save & next** and when you step to the previous or next card with ‹ ›, until you turn it off; it
starts off each time the editor opens. While it shows, typing changes nothing; the cursor
stays in the text. The side's
handwriting is not part of the preview, it stays in the pen zone above.

### Typing

In the text zone, `Tab` inserts a tab character, like the old edit dialog, and `Ctrl/Cmd + Z`
undoes typing as usual; if you wrote with the pen since you last typed, it undoes the pen change
instead. Right-to-left text is supported.

### Pen Tools

The pen tools are in the tool row and act on the side shown.

| Tool       | What it does                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size       | Sets the size of the tool in use. For the pen it switches between thin (the default), medium and thick (0.6×, 1× and 1.6× the **Pen thickness** setting), shown as a dot. With the eraser on it switches between a small, medium (the default) and large eraser, shown as a ring exactly as large as the eraser. The pen and the eraser keep their own size until the editor closes; existing strokes keep their width. |
| Eraser     | Erases only the ink under the eraser, like a real eraser: a stroke you cross is cut, and the rest of it stays. While it is on, the button and the pen zone's border turn red. Pressing the pen's side button while the pen hovers over the pen zone switches the eraser on and off; holding the side button while writing, or using the pen's eraser end, erases too.                                                   |
| Undo       | Undoes the last pen change on the side shown. A whole eraser movement is one step.                                                                                                                                                                                                                                                                                                                                      |
| Clear side | Removes the text and all strokes from the side shown. Undo brings both back in one step.                                                                                                                                                                                                                                                                                                                                |

While erasing, a circle shows the eraser's size and position.

Ink only goes where you can see the pen zone. If the pen slides off an edge, the stroke ends at the
edge; coming back without lifting the pen starts a new stroke there. The eraser only erases inside
the zone, too.

Fingers are ignored in the pen zone, so your hand can rest on the screen; on desktop the mouse
writes too. A finger touching one of the editor's buttons while the pen is writing, or just after,
is ignored too, so a resting palm doesn't save or delete the card.

On phones the editor fills the screen; on desktop and tablets it opens as a large dialog with the
same layout. In dark mode, handwriting is shown in light ink. The images themselves keep dark ink
on a transparent background, so they look right in both themes.

## Editing Cards

### During Review

Tap **Edit** in the review toolbar (see [Reviewing](reviewing.md#operation)). The card opens in the
same editor, with the note's name in the title bar and both sides, each with its typed text and its
handwriting, ready to change.

- **Save** (the single button on the right) writes the changes, keeps the card's review schedule
  and shows the updated card.
- **Delete card** (the bin in the title bar, two taps) removes the card from its note, with its schedule and its end marker
  line, and moves its handwriting images to the trash unless another note still shows them. During
  review, the next card is shown.
- `Esc`, ✕ or the back gesture closes without writing anything.
- **‹** and **›** in the title bar, left of the bin, step to the previous and next card **of the
  same note**, in the order they appear in the note, without closing the editor yourself. Changes
  are saved first, as with **Save**; if saving fails, the editor stays on the card with a notice. A
  card you didn't change is not written. At the note's first card **‹** is disabled, at its last
  card **›**; in a note with one card both are. During review the arrows step through the note's
  cards, not the review queue; when the editor closes, the review shows its current card again.
  A card deleted from the note this way during review can still come up later in the same session.

The note is only written when the card text changed, for example when you edited typed text, wrote
on a side that had no handwriting yet or erased all of a side's handwriting. If you only changed
existing handwriting, just the image is rewritten.

[Cloze cards](cloze-cards.md) open as a single text side, without a pen zone or a switch, with
**Mark as cloze** in the tool row.

The type button in the title bar shows the card's type. For a basic or reversed card it offers the
other one: multi-line `?` ⇄ `??`, single-line `::` ⇄ `:::`. Saving then writes the other separator;
the rest of the card and its schedule stay. A notice explains what changes:

- To **Reversed**: "The reverse direction becomes a new card". It is reviewed as a new card once
  Spaced Repetition has read the note again.
- To **Basic**: "The reverse direction's schedule is dropped". During review, if the card shown
  was the reverse direction, the review moves on to the next card when the editor closes.

A cloze card shows `Cloze` and can't be changed to another type.

### From a Note

In reading view and live preview, every handwritten card image is shown in a frame with a small
pencil button just outside its bottom-right corner (clear of Obsidian's own "edit block" button at the top right), so it never covers the handwriting. Tap the pencil on the front or the back to open the **whole card** in the
editor, exactly as during review. This also works for mixed cards, for example a typed front with a
handwritten back.

After saving, every visible copy of a changed image reloads. When the card text changed, the note
is updated and Spaced Repetition rescans your notes, once the editor has closed, also after
stepping through several cards with **‹** and **›**.

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

| Setting             | Default  | Description                                                                                                                                                                                                   |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pen mode            | Off      | Give each side a field to write in with a pen, such as the S Pen. Off: cards are typed only; handwriting a card already has can still be changed.                                                             |
| Image folder        | `sr-ink` | Where handwritten card images are saved. Leave empty to use Obsidian's attachment location.                                                                                                                   |
| Guide lines         | Lined    | Background of the writing fields: lined, dotted, grid or none. The guides are not saved in the image.                                                                                                         |
| Line spacing        | 44       | Distance between guide lines, in pixels (24–80).                                                                                                                                                              |
| Pen thickness       | 2.5      | Stroke width for new handwriting (1–8). Existing images keep the thickness they were written with.                                                                                                            |
| Buttons on the left | Off      | For writing with the left hand: the **Front ⇅ Back** switch and the save buttons move to the left of the writing fields. The side marker stays where it is: left edge for the front, right edge for the back. |

The card separator and the end marker are Spaced Repetition's own
[flashcard separator settings](../user-options.md#flashcard-separators).
