# Card editor: add and edit cards with keyboard or pen

Status: steps 1–8 implemented, step 9 (device test) open · branch `feat/card-editor` · 2026-10-31

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

Since the fixed-zones redesign ([card-editor-fixed-zones.md](card-editor-fixed-zones.md), prototype
[card-editor-fixed-zones.html](card-editor-fixed-zones.html)) one side is edited at a time, in
zones that never move:

```
┌──────────────────────────────────────────┐
│ Biology · 2 added               🗑    ✕   │  title bar: note, counter, Delete card, close
├──────────────────────────────────┬───────┤
│ FRONT     ●   ⌫   ↶   ⊘          │       │  tool row: side, size, eraser, undo, clear side
│┌────────────────────────────────┐│┌─────┐│
││ pen zone, fixed height (245 px)│││Front││  switch: as tall as the pen zone
││ "Draw on front"                │││ ⇅   ││
││                                │││Back ││
│└────────────────────────────────┘│└─────┘│
│┌────────────────────────────────┐│ Save  │
││ text zone: fills the rest      ││ & next│  2/3
││ "Type the question" (scrolls)  │├───────┤
│└────────────────────────────────┘│ Save &│  1/3 (edit mode: one Save)
└──────────────────────────────────┴ close ┘
              (soft keyboard below)
```

- **Every side holds typed text and handwriting at once** (no input modes, see "Device test
  round 1b"): the pen zone on top, the text zone below. Keyboard and fingers type, the pen writes.
- **One side at a time**: the switch shows the other side and moves the focus to its text area.
  The side shown is marked by a broad accent edge on both fields: right for the front, left for
  the back.
- **The keyboard stays open**: writing and the buttons never take the focus from the text area;
  the editor opens with the front's text area focused (on mobile too) and on mobile fills the
  visible height above the keyboard. Only the text zone and the save buttons change height.
- **Pen tools** act on the side shown: the size button cycles the pen (thin, the default, medium,
  thick) or, with the eraser on, the eraser (radius 5, 9, 15 px; its ring is the eraser's real
  size); the eraser turns the pen zone's border red; undo; clear side (text and ink, one undo
  step). Pressing the S Pen side button while hovering toggles the eraser; holding it while
  writing erases. Only the pen draws, fingers are ignored.
- **Delete card** is the bin in the title bar: an empty new card closes at once, otherwise two
  taps within 3 s.
- **Save on an empty side** shows that side, outlines it and says "Back is empty"; nothing is
  saved. The save buttons are only disabled while saving.
- **Text area** keeps the existing textarea behaviour: Tab inserts a tab, Ctrl/Cmd+Enter saves
  (in add mode: Save & next), native undo for typing.
- **Pen mode off**: the text zone takes the pen zone's place too, the switch and the save buttons
  share the right column. **Cloze cards**: one text side, no pen zone, no switch.
- Fullscreen on mobile, a large dialog on desktop. Exactly one close button, top right.

## User flows

### F1 Add cards (keyboard or pen)

1. In a note, run **Spaced Repetition: Add card** (command palette, mobile pull-down, toolbar).
   The command is available when the active file is a Markdown note.
2. If the note has no flashcard tag (SR's `flashcardTags`): a notice says so; the editor still opens.
3. The editor opens in add mode. Both sides are empty.
4. Fill front and back, typing, writing or both.
5. **Save & next**: the card is inserted below the cursor, after the block the cursor is in
   (frontmatter, card with its schedule comment, code block, paragraph), or at the end of the note in
   reading view / when no editor is open; the fields clear, the counter goes up, the front is shown and its text area focused (the
   keyboard stays up). Consecutive cards are inserted one after the other.
   **Save & close**: insert and close. **Delete card** (🗑 in the title bar): first tap arms it
   ("Tap again to delete"), second tap within 3 s clears the card and closes.
6. Closing with the back gesture / Esc / ✕ keeps the unsaved card as a draft (text and strokes);
   the next **Add card** restores it. An empty card leaves no draft.
7. After closing, SR rescans that note, so the deck counts and review queue include the new cards.

Inserted text (multi-line basic card; separator and end marker from SR settings):

```
What is the powerhouse of the cell?
?
![[sr-ink/sr-ink-20261031-141502123-back.svg]]

---
```

A side is stored as plain text, or as exactly one embed of its SVG. Mixed cards are normal cards.
The blank line before the end marker stops `---` from turning the line above into a heading.

### F2 Edit a card during review

1. Tap **Edit** in the review toolbar (unchanged button).
2. The same editor opens in edit mode with both sides of the current card: each side's typed text,
   and its handwriting loaded from the strokes stored in the SVG.
3. Change anything: type, write, erase.
4. **Save**: changed handwriting overwrites its SVG; the card text is written only if it
   changed (typed text changed, handwriting added to a side or erased from it). The review window redraws the card with
   the new content. The schedule stays.
5. ✕ / Esc / back gesture: nothing is written. **Delete card** (two taps) removes the card.

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
  side-editor.ts              one side: textarea above ink field
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
export const INK_FILE_PREFIX = "sr-ink-";
/** File name if the side is exactly one embed of an sr-ink SVG ("![[…/sr-ink-…svg]]" or "![](…)"), else null */
export function inkEmbedFileName(sideText: string): string | null;
/** Front/back of a question via CardFrontBackUtil.expand; back is null for cloze */
export function splitCardText(
    cardType: CardType,
    text: string,
    settings: SRSettings,
): { front: string; back: string | null };
/** Inverse of splitCardText; same newline rules as the old FlashcardEditModal.save() */
export function composeCardText(
    cardType: CardType,
    front: string,
    back: string | null,
    settings: SRSettings,
): string;
/** New multi-line basic card body, end marker preceded by a blank line when set */
export function newCardBody(front: string, back: string, settings: SRSettings): string;
/** Text to insert so the card is separated by blank lines from its surroundings */
export function cardInsertion(before: string, body: string, after: string): string;
export function inkEmbed(linkPath: string): string; // "![[sr-ink/x.svg]]"

// card-text.ts (round 1b)
export interface SideParts {
    text: string;
    inkEmbed: string | null;
} // inkEmbed: the whole trailing embed
export function splitSide(sideText: string): SideParts;
export function joinSide(cardType: CardType, text: string, inkEmbed: string | null): string;

// side-editor.ts
export interface SideState {
    text: string;
    strokes: Stroke[];
    penSize: number;
}
export class SideEditor {
    constructor(
        parent: HTMLElement,
        opts: {
            label: string;
            initial: SideState;
            allowInk: boolean;
            settings: SRSettings;
            textDirection: TextDirection;
            onChange(): void;
            onInkCommit(prev: Stroke[]): void;
        },
    );
    readonly state: SideState;
    readonly isEmpty: boolean; // blank text and no strokes
    readonly inkChanged: boolean;
    setStrokes(s: Stroke[]): void;
    clear(): void;
    setEraser(on: boolean): void;
    focus(): void;
    destroy(): void;
}

// card-editor-modal.ts
export interface CardEditorSides {
    front: SideState;
    back: SideState | null;
} // back null = cloze
export interface CardEditorResult {
    front: SideResult;
    back: SideResult | null;
}
export type SideResult = {
    text: string;
    ink: { strokes: Stroke[]; penSize: number; changed: boolean } | null; // null: no strokes
};
export type CardEditorOptions =
    | {
          kind: "add";
          title: string;
          draft: CardEditorSides | null;
          save(r: CardEditorResult): Promise<void>;
          keepDraft(d: CardEditorSides | null): void;
          closed(): void;
      }
    | {
          kind: "edit";
          title: string;
          initial: CardEditorSides;
          cardType: CardType;
          save(r: CardEditorResult): Promise<void>;
          closed(): void;
      };
export class CardEditorModal extends Modal {
    constructor(app: App, settings: SRSettings, opts: CardEditorOptions);
}
// The modal never touches files. save() errors keep the modal open and show a notice.

// card-editor-service.ts
export class CardEditorService {
    constructor(plugin: SRPlugin, settingsManager: SettingsManager);
    openAdd(file: TFile, view: MarkdownView | null): void; // F1
    /** F2/F3: opens the editor for a question; writes ink files and, if the text changed, the note
     *  through writeText (false = card text not found). Resolves to the new question text
     *  (null = cancelled), plus whether the text changed and which images were rewritten. */
    editQuestion(
        question: Question,
        writeText: (text: string) => Promise<boolean>,
    ): Promise<{ text: string; textChanged: boolean; changedImages: TFile[] } | null>;
    editInNote(noteFile: TFile, imageName: string): Promise<void>; // F3
    editInReview(): Promise<void>; // pencil inside review → same as toolbar Edit
}
```

### Key decisions

- **One modal, two modes.** The modal collects side states; the service does all writes.
- **Splitting** uses `CardFrontBackUtil.expand` (already used by the current edit dialog on main).
  `composeCardText` takes over the newline rules from `FlashcardEditModal.save()`.
- **A side's ink** is one embed of a `sr-ink-*.svg` file at the very end of the side (after the
  start of the side, whitespace or a newline); everything before it is the side's text. No new
  syntax. Ink without stored strokes (unreadable SVG) stays in the text, showing the embed, so
  nothing is lost. (Until round 1b: a side was ink only if it was exactly one embed.)
- **Saving in edit mode**
    - ink kept, strokes changed: overwrite the same SVG (embed unchanged). Unchanged: no write.
    - ink added: new SVG `sr-ink-<stem>-<side>.svg`; `<stem>` is the card's other ink side's stem
      if there is one, else a new timestamp.
    - ink erased to nothing: the embed is removed, the SVG moved to trash with
      `app.fileManager.trashFile`.
    - Text changed → the caller's `writeText` writes the question (`updateCurrentQuestionTextAndCards`
      in review, `question.writeQuestion()` in the note), which keeps the `<!--SR:…-->` schedule
      comment. Text unchanged → no note write.
    - The note write is the commit point, inside the editor's save: new SVGs are created and changed
      ones overwritten first, the note is written, and only then are SVGs trashed. If anything fails,
      including the card's text no longer being found in the note, new SVGs are removed, overwritten
      ones restored, and the editor stays open with a notice.
- **Review edit** (`content-manager.tsx` `_doEditQuestionText`) calls `editQuestion` with
  `updateCurrentQuestionTextAndCards` as `writeText`, then always redraws the current side.
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
- **Files**: SVGs go to the "Image folder" setting (default `sr-ink`; empty = Obsidian's
  attachment folder via `fileManager.getAvailablePathForAttachment`).

### Changes to existing SR code (kept small)

| File                                       | Change                                               |
| ------------------------------------------ | ---------------------------------------------------- |
| `src/main.ts`                              | create `CardEditorService`, register pencil buttons  |
| `src/command-manager.ts`                   | command `srs-add-card` ("Add card")                  |
| `content-container/content-manager.tsx`    | `_doEditQuestionText` uses the service               |
| `modals/edit-modal.tsx` (+ css, test)      | removed; its tests move to `card-text` / modal tests |
| `src/data/settings.ts`, `settings-tab.tsx` | "Card editor" settings section                       |
| `src/lang/locale/en.ts`                    | new strings (other locales fall back to English)     |
| `package.json`                             | add `perfect-freehand` (MIT)                         |

Nothing changes in the parser, scheduling or data store.

### Settings ("Card editor" section)

| Key                      | Setting                                      | Default    |
| ------------------------ | -------------------------------------------- | ---------- |
| `cardEditorPenMode`      | Pen fields on the sides (off: keyboard only) | `false`    |
| `cardEditorImageFolder`  | Image folder                                 | `"sr-ink"` |
| `cardEditorGuide`        | Guide lines (lined / dotted / grid / none)   | `"lined"`  |
| `cardEditorGuideSpacing` | Line spacing (px, 24–80)                     | `44`       |
| `cardEditorPenSize`      | Pen thickness (1–8, step 0.5)                | `2.5`      |

Separator and end marker are SR's own settings.

## Bugs fixed along the way

1. Edit dialog writes the note even when nothing changed.
2. Pencil on a mixed card (typed front, ink back) can't find the card (lookup by parsed question
   instead of sibling file name).
3. Pencil tap in live preview reaching CodeMirror.
4. Review window showing stale ink after an edit (always redraw + image refresh).
5. Pen Cards and SR fighting over the edit dialog (DOM interception goes away).

## No migration from Pen Cards

Pen Cards was an experiment, so there is no backwards compatibility: images are named
`sr-ink-<stem>-<front|back>.svg`, strokes are stored in `<metadata id="sr-ink">`, and no notice is
shown for the old plugin. Old Pen Cards images stay plain images.

## Steps

Each step is one commit; `pnpm jest`, `tsc -noEmit -skipLibCheck` and `pnpm eslint src/ tests/` pass.

- [x] 1. **Core** (2c1ff55): add `perfect-freehand`; port `strokes.ts` and `ink-svg.ts`; write
      `card-text.ts`; port Pen Cards' unit tests and add tests for `card-text.ts` (split/compose round
      trips for all card types, separators inside text, end marker, insertion spacing, embed detection).
- [x] 2. **Settings** (290d2ed): settings keys + defaults, settings tab section, English strings for
      the whole feature.
- [x] 3. **Side editor** (60d3b6d): port `ink-field.ts`; write `side-editor.ts` and `card-editor.css`
      (incl. dark mode ink); jsdom tests for mode switching, drafts, `isEmpty`, `replacesOther`.
- [x] 4. **Modal** (9c38f76): `card-editor-modal.ts` (add and edit mode, buttons, undo across sides,
      discard arming, draft hand-off, keyboard shortcuts, mobile fullscreen, single close button);
      jsdom tests.
- [x] 5. **Review edit** (1d3e81d): `ink-files.ts`, `CardEditorService.editQuestion`, wire
      `_doEditQuestionText`, remove `edit-modal.tsx` and move its tests.
- [x] 6. **Add card** (3907feb): command, `openAdd`, flashcard tag notice, insertion at cursor / end
      of note, draft, note resync.
- [x] 7. **Pencil buttons** (9a502be): `pencil-buttons.ts`, `editInNote`, `editInReview`, image
      refresh (the Pen Cards migration notice was removed again, see below).
- [x] 8. **Docs**: user page `docs/docs/en/flashcards/card-editor.md` (+ mkdocs nav, links from
      Reviewing and User Options).
- [ ] 9. **Device test** on the S22 Ultra, by hand: pen-only, side-button eraser (pixel erase,
      eraser circle), pen size button, footer fits at 360 px, no layout shift on mode switch,
      live-preview pencil tap (also in tabs that load late), single ✕, dark mode, back gesture keeps
      draft. Round 1 done, see below.

## Device test round 1

Feedback from the S22 Ultra (Obsidian Android, dark mode, S Pen) and what changed:

1. **Counter in the header**: "N card(s) added" in the footer pushed Save & next off-screen. It is
   now a compact badge next to the note title ("2 added", hidden at 0). The footer holds only
   Delete card (left) · Save & close · Save & next (primary, right), with compact sizing on phones so
   all three fit at 360 CSS px.
2. **No layout shift on mode switch**: the hint line under a side is gone; a dot badge
   (absolutely positioned) on the inactive mode button marks a hidden draft. Text and ink fields
   use an identical box (size, border, radius, padding, background), so switching only swaps the
   content. On mobile, switching never focuses the text area (no soft keyboard); on desktop, Text
   focuses it so typing can start. The pen tools keep their place and only change enabled state.
   On mobile the editor keeps the height of the window without the soft keyboard (it scrolls while
   the keyboard is open), so the sides don't resize when the keyboard opens or closes.
3. **Pixel eraser**: the eraser removes only the parts of strokes under it (a capsule between
   consecutive eraser positions, radius = eraser radius + the widest the stroke's outline gets,
   `strokeMaxRadius()`: 0.8 × size with real pressure, 0.75 × size without) and splits strokes
   into the remaining runs. Strokes stay vector data, so the SVG stays editable. Long segments are
   resampled before cutting; leftover runs too short to see are dropped, untouched single-point
   dots are kept. A circle cursor (an element over the canvas, so hovering repaints no strokes)
   shows the eraser; one undo step per eraser gesture; the radius
   scales with pen size (`max(8, 3 × size)` CSS px).
4. **No pen autodetection**: no switch to ink on pen touch, no switch to text on typing. The
   `cardEditorPenSwitchesToInk` setting, its UI, strings, docs and tests are removed.
   `upgradeSettings` deletes the key from data saved by earlier builds of this branch and, in that
   same data, resets the old default pen size 5 to the new one (once: a 5 picked later is kept). Text areas use
   normal `touch-action`, so finger scrolling works.
5. **Thinner pen**: `cardEditorPenSize` default 2.5, slider 1–8 step 0.5. A toolbar button cycles
   thin / medium / thick (0.6× / 1× / 1.6× of the setting) for new strokes, per session; its icon
   shows the size as a dot. Each stroke keeps the thickness it was written with (optional
   `Stroke.size`; the SVG metadata stores `s` for strokes whose size differs from the file's).
   Edited cards and restored drafts also start at the button's size (medium), so the button never
   shows a size other than the one new strokes get.
6. **Pencil in notes**: smaller (about 28 px), outside the image's frame to its right with an 8 px
   gap (its tap area stays in the gap), so it never sits on or right next to the ink, slightly translucent until pressed; tighter image box padding. Taps still
   don't reach CodeMirror.
7. **Mode switch**: a clear "Text | Pen" segmented control with Obsidian's lucide icons
   (`keyboard`, `pen-line`) and accessible labels, same height as before. (Removed in round 1b.)

## Device test round 1b: combined sides

Switching a side between Text and Pen was awkward once it had content. Input modes are gone:

1. **Every side holds text and handwriting**: a fixed-height text area (about 3 lines, scrolls
   inside, placeholder, RTL) on top, the ink field filling the rest of the side below it. Both
   sides have the same fixed geometry; nothing shifts while typing or writing. No mode switch, no
   dot badges, no hints, no auto-detection.
2. **Pen tools always enabled**. Clear side clears text and ink of the active side; one undo step
   restores both. Undo stays ink-focused across sides; typing keeps the native textarea undo.
3. **Focus**: on mobile no text area is focused on open or after Save & next (no soft keyboard); on
   desktop the front text area is.
4. **Storage**: a side is its typed text, optionally followed by exactly one `sr-ink` embed at the
   very end: multi-line cards `text + "\n" + embed`, single-line cards (`::`, `:::`)
   `text + " " + embed` on the same line; the embed alone without text, the text alone without
   ink (`joinSide` / `splitSide` in `card-text.ts`). Existing ink-only and text-only sides read
   exactly as before. The composed card still goes through the parser check (`misreadSide`).
5. **Saving**: per side, ink kept → SVG overwritten if changed; ink added → new SVG (stem rules as
   before); ink erased to nothing → embed removed, SVG trashed with the existing safety checks. A
   side whose typed text and embed are unchanged is written back exactly as it was in the note.
   A side with blank text and no strokes is empty: save stays disabled, and the service refuses it.
6. **Cloze cards**: text area only; a trailing embed in a cloze stays part of its text.
7. **Setting removed**: `cardEditorDefaultMode` (type `CardEditorInputMode`, settings UI, strings
   `CARD_EDITOR_DEFAULT_MODE*`, `CARD_EDITOR_MODE_TEXT` / `_INK`). `upgradeSettings` deletes the
   key from data saved by earlier builds.

## Deviations from this plan

- **Settings**: the "Card editor" section is a group on the existing Flashcards settings page.
  (The default mode setting was removed in round 1b.)
- **Ink field**: guides are drawn with CSS (classes `sr-ink-guide-*`, variable
  `--sr-ink-guide-spacing`) instead of on the canvas. The field label is a placeholder inside the
  field; the side label sits in the side header.
- **Additions to contracts**: `SideEditor.reset(state)` (Save & next), getters `strokes`,
  `text`, `el`; `SideEditor.setPenSize(size)` for the toolbar's pen size button; an optional `textDirection` in the modal options; `cardSeparator`, `inkEmbedFileNames` in
  `card-text.ts`; `inkFileName`, `parseInkFileName`, `timestampName` in `ink-svg.ts`;
  `findQuestionWithInk` in the service; `ContentManager.editCurrentQuestion()` for `editInReview`.
- **New file** `card-inserter.ts`: insertion at the cursor / end of note, split out of the service so
  it can be unit tested. The editor is saved before the resync, because `sync()` reads from disk.
- **No stroke refit on edit**: strokes are loaded as stored (Pen Cards' `fitStrokes` on edit was not
  ported).
- **Save & close** is disabled like Save & next while a side is empty; an empty card is closed with
  ✕, Esc or Delete card.
- **Blank lines in text sides**: without an end marker a blank line would end the card, so blank
  lines typed in a side (outside code blocks) are saved as a `<br>` line.
- **Separator line**: an edit keeps the separator line as written (e.g. with extra spaces) and the
  lines around it, so saving without changes never rewrites the note.
- **Ink files** are resolved by the embed's link path, not by file name alone. Any `sr-ink-*.svg`
  embed counts as ink, also for the pencil; only names following the scheme give a stem to reuse.
- **Pen on the text area** (superseded by device test round 1, autodetection removed): with
  "switch to pen" on, the text area had `touch-action: pan-y pinch-zoom`, and a pen stroke taken
  over for scrolling (`pointercancel`) was dropped.
- **Image folder**: an existing folder with another letter case is used as it is.
- **Note edit**: editors showing the note are saved before the card is read, so unsaved typing is
  not mistaken for a changed card. Images are refreshed in every window, incl. popouts.
- **Theme change** while the editor is open redraws the ink in the new color (`css-change`).
- **Shortcuts**: Ctrl/Cmd+Z undoes ink only outside a text area. Clear side acts on the side last touched or focused.
- **Embeds**: always the wiki form `![[…]]`, regardless of Obsidian's link-format setting. If a
  sibling stem's file name already exists, a new timestamp stem is used, so no file is overwritten.
- **Image refresh** uses the query parameter `sr-ink` (Pen Cards used `pc`). Images that Obsidian adds
  after rendering are caught by a short-lived MutationObserver; live-preview editors are re-checked on
  `layout-change` and `active-leaf-change`.
- **Delete card** replaces Discard (add) and Cancel (edit); closing without saving is the ✕.
  On an empty new card it closes at once; otherwise it arms first. In edit mode it removes the card
  with its schedule and end marker line from the note (also the review's own Delete Card) and
  trashes the card's ink images no other note refers to.
- **Backspace on Android**: the keyboard's delete next to an ink embed only fires `beforeinput`,
  and Chrome may move the cursor over the image instead of deleting it. A delete next to an ink
  embed therefore deletes it a moment later if the note's text didn't change. An ink embed the
  user removes from a note is trashed after 2 s unless it is back or referenced elsewhere.
- **Erased ink** (formerly ink → text) trashes the SVG only when no other note or card links to it (Obsidian's
  `resolvedLinks`, with this card's links counted by the file they resolve to, not by name), the
  new text has no link resolving to it, and no `.md` or `.canvas` file refers to it when read
  (`InkFiles.isReferenced`: a resolving link, or its name in other text such as `<img>`). A read
  error keeps the file.
- **Card syntax in a side**: before writing, the composed card is run through SR's parser; unless it
  reads back as one card of the intended type with exactly these sides (e.g. `std::vector` in a
  multi-line card's front would make it single-line), the save is refused with a notice naming the
  side, and the editor stays open.
- **Pencil** identifies the clicked image's file (`InkFiles.imageFile`: embed link path, else
  resource path, else the only file of that name) and finds the card by resolved embed path.
  Buttons left by an earlier plugin instance are replaced; `destroy` also removes buttons in
  detached sections.
- **Insertion**: if the text before the insertion point ends inside a card that only the end
  marker would close, the end marker is inserted first. The card inserted last is only found again
  where it is a whole block (blank lines around it); otherwise the next card goes to the note's end.
- **Editing indentation**: an edited text side of an existing card keeps its leading indentation;
  only leading blank lines and trailing whitespace are removed (new cards are fully trimmed).
- **While saving** the sides are locked (read-only, ink ignored, Undo / Clear
  disabled) so the saved content is what Save & next clears or Save & close closes over.
- **Unload**: the service closes open editors on plugin unload; later saves are refused with a
  notice and nothing more is written. Unreadable or malformed ink metadata opens the side as text.
- **Pen mode**: fingers never draw in a pen field (palm rejection). With pen mode off a side shows
  a pen field only for handwriting it already has, so saving keeps it. The palm guard also covers
  the editor's buttons: a finger press while the pen is down or within
  500 ms of pen use is taken for the palm and ignored.
- **Mobile focus**: on mobile no text area is focused on open (no soft keyboard for pen users).
- **Pencil**: a press that moves more than 10 px is not a tap. Canvas text nodes get a pencil, but
  `editInNote` only edits `.md` notes (notice otherwise).
- **Flashcard tag notice**: tag matching reuses SR's `SettingsUtil.isFlashcardTag` (Pen Cards'
  `hasFlashcardTag` was not ported); the notice is skipped when folders are converted to decks.
  Text sides are trimmed before insertion.
- **Review edit**: after a cancel the previous UI state is restored too (the old code did not).
- **No Pen Cards compatibility**: notice removed; files renamed to `sr-ink-…`, SVG metadata id
  `sr-ink`, default image folder `sr-ink`.
- **Leftovers**: the locale key `NO_INPUT` is unused but kept; `UIState.EditModal` is still used.

## Decisions taken

- Command name: **Add card**.
- Add card creates **multi-line basic** cards only; reversed can come later.
- No input modes: every side holds text and handwriting (round 1b); the default input mode setting
  and pen autodetection (round 1) were removed.
