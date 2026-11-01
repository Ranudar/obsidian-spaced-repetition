# Card editor: one input per side (typed or drawn)

Agreed with the owner through the prototype `docs/plans/card-editor-input-mode.html` (open it in a
browser; it is the visual and behavioural reference). Builds on the fixed-zones editor
(`card-editor-fixed-zones.md`, `card-editor-types-preview.md`).

## Rule

A card side is either **typed** or **drawn**, never both at once in the editor.

- **Drawn**: the side's text in the note is exactly one ink embed (`inkEmbedPath(text.trim())`
  is not null and its strokes can be read). It opens in drawing mode with its strokes.
- **Typed**: everything else — including a side mixing text and an ink embed, or an embed that
  isn't readable ink. It opens in typing mode with its **whole text, embeds included**, as text.
  The preview renders embeds as images (MarkdownRenderer with the note's path).

## Layout (phone, see prototype)

- Title bar unchanged (title, type chip · decks, ‹ › in edit mode, bin, ✕).
- Tool row, this order: side label (`FRONT`/`BACK`), the **input toggle** `[⌨ | ✎]` (keyboard
  first, pen second; the active one filled with the accent colour), pen size, eraser, undo, clear.
  In typing mode **pen size and eraser are disabled** (greyed out, not hidden), so undo and clear
  never move. No toggle for cloze (always typed) and when the Pen mode setting is off (always
  typed; a side that is already drawn still opens drawn, without a toggle — existing rule).
- The side's body is **one zone filling the whole left column** below the tool row: the pen
  field in drawing mode, the text field in typing mode (preview eye in its corner). The side
  marker (front = left edge, back = right edge) on that zone.
- Right column: the Front ⇅ Back switch in the upper half, the save buttons in the lower half
  (Save & next 2/3, Save & close 1/3; edit mode: one Save). Cloze: saves only, full height.
- Keyboard: typing mode focuses the text area (keyboard opens); drawing mode takes the focus off
  it (keyboard closes). Switching sides focuses accordingly.

## Switching the input of a side

- Tapping the other half of the toggle on an **empty** side switches at once.
- On a side **with content**, a confirmation appears right below the tool row (inside the
  editor, not a modal): "Delete the drawing on **Back** and switch to typing?" (or "the text …
  to drawing"), buttons **Keep** and **Delete & switch** (danger style). Keep closes it and
  changes nothing; Delete & switch clears the side's content and switches. A tap elsewhere also
  closes it (= Keep). It must not take the focus from the text area.
- The switch is not an undo step (the confirmation is the safety).

## Remembering the input

- Each side remembers its last input for new cards: persisted in the settings as
  `cardEditorFrontInput` / `cardEditorBackInput` (`"text"` | `"pen"`, defaults `"text"` for the
  front and `"pen"` for the back), updated when the user switches a side's input in the add
  editor. A draft keeps its sides' inputs. Editing an existing card uses the rule above, not the
  remembered input. With pen mode off, new cards are always typed.

## Saving

- Typing mode: the side is its text exactly as typed (ink embeds in it stay as written).
  If the user removed an ink embed that was in the side's original text, that ink file goes to the
  trash after the note is written, unless still referenced elsewhere (reuse the existing
  erased-ink checks: `linksOutsideCard`, `isReferenced`).
- Drawing mode: the side is just its ink embed (existing paths: overwrite / new file / erased →
  trash). A drawn side whose strokes were all erased is empty (save refuses with the existing
  "… is empty" jump).
- Switching a drawn side to typing (Delete & switch) and saving trashes its ink file (existing
  erased-ink path); switching a typed side to drawing drops its text.

## Out of scope

Desktop/tablet-specific layouts; changing cloze behaviour beyond "always typed".

## Acceptance

- Tests (important paths only): load rule (pure embed → drawn; mixed → typed with the embed in
  the text); toggle hidden for cloze / pen mode off; pen tools disabled in typing mode and undo /
  clear unchanged in position; switching an empty side is immediate; switching with content asks,
  Keep keeps, Delete & switch clears and switches; remembered inputs for new cards (settings
  updated); saving a typed mixed side keeps its embed; removing an embed from typed text trashes
  the unreferenced ink file; switching drawn → typed trashes the ink on save.
- jest, tsc, eslint (0 errors), prettier --check, pnpm run build pass; user docs updated.
