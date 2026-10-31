# Card editor: add and edit cards with keyboard or pen

Status: in progress · branch `feat/card-editor` · 2026-10-31

## Goal

Make one card editor in Spaced Repetition (SR) and use it for everything:

- **Add cards** from a command (assignable to the mobile pull-down / toolbar).
- **Edit cards** from the review window (replaces today's edit dialog).
- **Edit cards** from the note, via a pencil button on handwritten card images.

Each side of a card (front, back) can be **typed** or **handwritten**, and you can switch a side
between the two at any time. Handwriting is stored as SVG with the original pen strokes, so it can be
edited later. The standalone Pen Cards plugin goes away; its drawing code moves into SR.

Not in scope: writing answers by hand during review (active recall), new card types, cloze by pen.

Already done on `main` (not part of this work): the edit dialog splits cards with
`CardFrontBackUtil.expand` like the parser, and the review modal shows a single close button.

## The editor in one picture

```
┌──────────────────────────────────────────────────────────┐
│ Biology › Cells                       ⌫  ↶  🗑          ✕ │  header: note name, pen tools, close
├──────────────────────────────────────────────────────────┤
│ Front                                        [⌨ | ✎]    │  per-side mode switch
│ ┌──────────────────────────────────────────────────────┐ │
│ │  text area  — or —  ink field with guide lines       │ │
│ └──────────────────────────────────────────────────────┘ │
│ Back                                         [⌨ | ✎]    │
│ ┌──────────────────────────────────────────────────────┐ │
│ │                                                      │ │
│ └──────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│ Discard        3 cards added    Save & next   Save & close│  add mode
│ Cancel                                             Save   │  edit mode
└──────────────────────────────────────────────────────────┘
```

- **Mode switch per side**: ⌨ text / ✎ pen.
  - A pen touch (`pointerType === "pen"`) on a text side switches it to pen (setting, default on),
    so S Pen users never have to tap the switch.
  - Typing on a keyboard while an *empty* ink side is focused switches it to text.
- **Pen tools** (eraser toggle, undo, clear side) are enabled only while a side is in pen mode.
  The S Pen side button erases too. Only the pen draws, fingers are ignored (setting).
- **Text mode** keeps the existing textarea behaviour: Tab inserts a tab, Ctrl/Cmd+Enter saves
  (in add mode: Save & next).
- **Switching a side that has content** keeps both drafts until saving; the mode visible at
  save time wins. A hint under the side says "Saving replaces the text with handwriting" (or the
  reverse).
- **Cloze cards**: one text field, no pen switch, no back side.
- **Save is disabled** while a needed side is empty (front and back; front only for cloze).
- Fullscreen on mobile, a large dialog on desktop. Exactly one close button, top right.

## User flows

### F1 Add cards (keyboard or pen)
1. In a note, run **Spaced Repetition: Add card** (command palette, mobile pull-down, toolbar).
   The command is available when the active file is a Markdown note.
2. If the note has no flashcard tag (SR's `flashcardTags`): a notice says so; the editor still opens.
3. The editor opens in add mode. Both sides start in the **default input mode** setting (Text).
4. Fill front and back, typing or writing; switch modes per side as needed.
5. **Save & next**: the card is inserted below the cursor (or at the end of the note in reading
   view / when no editor is open), the fields clear, the counter goes up, focus returns to the
   front side (text mode) or the front ink field. Consecutive cards are inserted one after the other.
   **Save & close**: insert and close. **Discard**: first tap arms it ("Tap again to discard"),
   second tap within 3 s clears the card and closes.
6. Closing with the back gesture / Esc / ✕ keeps the unsaved card as a draft (text and strokes);
   the next **Add card** restores it. An empty card leaves no draft.
7. After closing, SR rescans that note, so the deck counts and review queue include the new cards.

Inserted text (multi-line basic card; separator and end marker from SR settings):

```
What is the powerhouse of the cell?
?
![[pencards/pencard-20261031-141502123-back.svg]]

---
```

A side is stored as plain text, or as exactly one embed of its SVG. Mixed cards are normal cards.
The blank line before the end marker stops `---` from turning the line above into a heading.

### F2 Edit a card during review
1. Tap **Edit** in the review toolbar (unchanged button).
2. The same editor opens in edit mode with both sides of the current card: text sides as text,
   handwritten sides as ink, loaded from the strokes stored in the SVG.
3. Change anything, including switching a side between text and pen.
4. **Save**: ink sides that changed overwrite their SVG; the card text is written only if it
   changed (a side switched mode or typed text changed). The review window redraws the card with
   the new content. The schedule stays.
5. **Cancel** / ✕ / back gesture: nothing is written.

### F3 Edit a card from the note
1. Every handwritten card image in a note (reading view and live preview) is shown in a bordered
   box with a pencil button in its corner.
2. Tapping the pencil on **front or back** opens the editor in edit mode with the **whole card**
   (both sides), exactly as in F2. The card is found among the note's parsed questions (the
   question whose text embeds that image), so it works for mixed cards too.
3. **Save** writes as in F2, and every visible copy of the changed image reloads.
4. The whole button reacts to a tap, and the tap never reaches the editor underneath (no cursor
   jump, no re-render that swallows it).
5. If the image is not part of any card in the note, a notice says so.

Inside the review window, the pencil on a handwritten image does the same as the toolbar **Edit**.

## Architecture

```
src/card-editor/
  core/                       pure, unit-tested, no Obsidian runtime imports
    strokes.ts                ← pen-cards/src/core/strokes.ts (perfect-freehand outlines, hit test, fit)
    ink-svg.ts                ← pen-cards/src/core/svg.ts     (strokes ⇄ SVG with embedded strokes, names)
    card-text.ts              split/compose card text, side ⇄ ink embed, insertion spacing
  ink-field.ts                ← pen-cards/src/ink-field.ts    (canvas, pen-only, eraser, guides)
  side-editor.ts              one side: textarea or ink field, mode switch, both drafts
  card-editor-modal.ts        the editor (add / edit mode); replaces modals/edit-modal.tsx
  card-editor-service.ts      entry points + all file/note writes
  ink-files.ts                create / overwrite / trash SVGs, resolve, refresh images
  pencil-buttons.ts           ← pen-cards/src/edit-buttons.ts minus the SR-dialog interception
  card-editor.css
```

The Pen Cards source is at
`/private/tmp/claude-501/-Users-ranudar-Projects-spaced-repetition/4f784aff-0cc0-4a2d-b3e2-a25cbed32e0d/scratchpad/pen-cards`
(`src/`, `styles.css`, `tests/core.test.ts`, `harness/`).

### Contracts

Names may be refined while implementing, but the responsibilities stay put.

```ts
// core/card-text.ts
export const INK_FILE_PREFIX = "pencard-";
/** File name if the side is exactly one embed of a pencard SVG ("![[…/pencard-…svg]]" or "![](…)"), else null */
export function inkEmbedFileName(sideText: string): string | null;
/** Front/back of a question via CardFrontBackUtil.expand; back is null for cloze */
export function splitCardText(cardType: CardType, text: string, settings: SRSettings): { front: string; back: string | null };
/** Inverse of splitCardText; same newline rules as the old FlashcardEditModal.save() */
export function composeCardText(cardType: CardType, front: string, back: string | null, settings: SRSettings): string;
/** New multi-line basic card body, end marker preceded by a blank line when set */
export function newCardBody(front: string, back: string, settings: SRSettings): string;
/** Text to insert so the card is separated by blank lines from its surroundings */
export function cardInsertion(before: string, body: string, after: string): string;
export function inkEmbed(linkPath: string): string; // "![[pencards/x.svg]]"

// side-editor.ts
export type InputMode = "text" | "ink";
export interface SideState { mode: InputMode; text: string; strokes: Stroke[]; penSize: number }
export class SideEditor {
  constructor(parent: HTMLElement, opts: { label: string; initial: SideState; allowInk: boolean;
    settings: SRSettings; textDirection: TextDirection; onChange(): void; onInkCommit(prev: Stroke[]): void });
  readonly mode: InputMode; setMode(m: InputMode): void;
  readonly state: SideState; readonly isEmpty: boolean; readonly inkChanged: boolean; readonly replacesOther: boolean;
  setStrokes(s: Stroke[]): void; clear(): void; setEraser(on: boolean): void; focus(): void; destroy(): void;
}

// card-editor-modal.ts
export interface CardEditorSides { front: SideState; back: SideState | null } // back null = cloze
export interface CardEditorResult { front: SideResult; back: SideResult | null }
export type SideResult = { mode: "text"; text: string } | { mode: "ink"; strokes: Stroke[]; penSize: number; changed: boolean };
export type CardEditorOptions =
  | { kind: "add"; title: string; draft: CardEditorSides | null;
      save(r: CardEditorResult): Promise<void>; keepDraft(d: CardEditorSides | null): void; closed(): void }
  | { kind: "edit"; title: string; initial: CardEditorSides; cardType: CardType;
      save(r: CardEditorResult): Promise<void>; closed(): void };
export class CardEditorModal extends Modal { constructor(app: App, settings: SRSettings, opts: CardEditorOptions) }
// The modal never touches files. save() errors keep the modal open and show a notice.

// card-editor-service.ts
export class CardEditorService {
  constructor(plugin: SRPlugin, settingsManager: SettingsManager);
  openAdd(file: TFile, view: MarkdownView | null): void;                       // F1
  /** F2/F3: opens the editor for a question; writes ink files; resolves to the new question text
   *  (null = cancelled), plus whether the text changed and which images were rewritten. Does not write the note. */
  editQuestion(question: Question): Promise<{ text: string; textChanged: boolean; changedImages: TFile[] } | null>;
  editInNote(noteFile: TFile, imageName: string): Promise<void>;              // F3
  editInReview(): Promise<void>;                                              // pencil inside review → same as toolbar Edit
}
```

### Key decisions

- **One modal, two modes.** The modal collects side states; the service does all writes.
- **Splitting** uses `CardFrontBackUtil.expand` (already used by the current edit dialog on main).
  `composeCardText` takes over the newline rules from `FlashcardEditModal.save()`.
- **A side is ink if, and only if,** its trimmed text is exactly one embed of a `pencard-*.svg`
  file. Everything else is text. No new syntax. Ink without stored strokes (unreadable SVG) opens as
  text showing the embed, so nothing is lost.
- **Saving in edit mode**
  - ink → ink, strokes changed: overwrite the same SVG (note text unchanged). Unchanged: no write.
  - text → ink: new SVG `pencard-<stem>-<side>.svg`; `<stem>` is the card's other ink side's stem
    if there is one, else a new timestamp.
  - ink → text: the SVG is moved to trash with `app.fileManager.trashFile`.
  - Text changed → the caller writes the question (`updateCurrentQuestionTextAndCards` in review,
    `question.writeQuestion()` in the note), which keeps the `<!--SR:…-->` schedule comment.
    Text unchanged → no note write.
- **Review edit** (`content-manager.tsx` `_doEditQuestionText`) calls `editQuestion`, then
  `updateCurrentQuestionTextAndCards` only if the text changed, then always redraws the current side.
- **Note edit**: the pencil knows the note (post-processor `ctx.sourcePath`, or the live-preview
  leaf's file). The service loads it with `dataManager.loadNote(file)`, finds the question whose text
  embeds the image, runs `editQuestion`, writes the question if needed, then resyncs.
- **Pencil buttons**: `registerMarkdownPostProcessor` covers reading view and the review window
  (SR renders cards with `MarkdownRenderer.render`, which runs post-processors). Live-preview
  embeds are not post-processed, so a `MutationObserver` limited to `.markdown-source-view` handles
  those, with Pen Cards 0.3.0's tap handling (swallow touch/mouse/pointer events, open on pointerup).
- **Image refresh**: after overwriting an SVG, reload every `<img>` showing it with a version query
  (Pen Cards' `markEdited`), and remember the version for images rendered later in the session.
- **Dark mode**: SVGs keep dark ink (`#1f1f1f`) on a transparent background; CSS inverts ink images
  in `.theme-dark`, also inside the editor.
- **Files**: SVGs go to the "Image folder" setting (default `pencards`; empty = Obsidian's
  attachment folder via `fileManager.getAvailablePathForAttachment`). Existing Pen Cards file names
  and SVG format stay valid.

### Changes to existing SR code (kept small)

| File | Change |
|---|---|
| `src/main.ts` | create `CardEditorService`, register pencil buttons |
| `src/command-manager.ts` | command `srs-add-card` ("Add card") |
| `content-container/content-manager.tsx` | `_doEditQuestionText` uses the service |
| `modals/edit-modal.tsx` (+ css, test) | removed; its tests move to `card-text` / modal tests |
| `src/data/settings.ts`, `settings-tab.tsx` | "Card editor" settings section |
| `src/lang/locale/en.ts` | new strings (other locales fall back to English) |
| `package.json` | add `perfect-freehand` (MIT) |

Nothing changes in the parser, scheduling or data store.

### Settings ("Card editor" section)

| Key | Setting | Default |
|---|---|---|
| `cardEditorDefaultMode` | Default input mode (text / pen) | `"text"` |
| `cardEditorPenSwitchesToInk` | Switch a side to pen when the pen touches it | `true` |
| `cardEditorPenOnly` | Ignore fingers in pen mode | `true` |
| `cardEditorImageFolder` | Image folder | `"pencards"` |
| `cardEditorGuide` | Guide lines (lined / dotted / grid / none) | `"lined"` |
| `cardEditorGuideSpacing` | Line spacing (px, 24–80) | `44` |
| `cardEditorPenSize` | Pen thickness (2–12) | `5` |

Separator and end marker are SR's own settings.

## Bugs fixed along the way

1. Edit dialog writes the note even when nothing changed.
2. Pencil on a mixed card (typed front, ink back) can't find the card (lookup by parsed question
   instead of sibling file name).
3. Pencil tap in live preview reaching CodeMirror.
4. Review window showing stale ink after an edit (always redraw + image refresh).
5. Pen Cards and SR fighting over the edit dialog (DOM interception goes away).

## Migration from the Pen Cards plugin

- Existing cards keep working: same file names (`pencard-…-front|back.svg`), same SVG format.
- If the Pen Cards plugin (`pen-cards`) is still enabled, SR shows a one-time notice asking to
  disable it (two pencils would appear otherwise).

## Steps

Each step is one commit; `pnpm jest`, `tsc -noEmit -skipLibCheck` and `pnpm eslint src/ tests/` pass.

1. **Core**: add `perfect-freehand`; port `strokes.ts` and `ink-svg.ts`; write `card-text.ts`;
   port Pen Cards' unit tests and add tests for `card-text.ts` (split/compose round trips for all
   card types, separators inside text, end marker, insertion spacing, embed detection).
2. **Settings**: settings keys + defaults, settings tab section, English strings for the whole
   feature.
3. **Side editor**: port `ink-field.ts`; write `side-editor.ts` and `card-editor.css` (incl. dark
   mode ink); jsdom tests for mode switching, drafts, `isEmpty`, `replacesOther`.
4. **Modal**: `card-editor-modal.ts` (add and edit mode, buttons, undo across sides, discard
   arming, draft hand-off, keyboard shortcuts, mobile fullscreen, single close button); jsdom tests.
5. **Review edit**: `ink-files.ts`, `CardEditorService.editQuestion`, wire `_doEditQuestionText`,
   remove `edit-modal.tsx` and move its tests.
6. **Add card**: command, `openAdd`, flashcard tag notice, insertion at cursor / end of note,
   draft, note resync.
7. **Pencil buttons**: `pencil-buttons.ts`, `editInNote`, `editInReview`, image refresh, Pen Cards
   migration notice.
8. **Docs**: user page in `docs/docs/en/` (+ mkdocs nav).
9. **Device test** on the S22 Ultra, by hand: pen-only, side-button eraser, auto switch to pen,
   live-preview pencil tap, single ✕, dark mode, back gesture keeps draft.

## Decisions taken

- Command name: **Add card**.
- Add card creates **multi-line basic** cards only; reversed can come later.
- Default input mode is a setting (Text); the pen switches a side automatically.
