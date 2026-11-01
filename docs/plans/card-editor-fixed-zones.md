# Card editor: fixed zones, one side at a time

Redesign of the card editor modal (`src/card-editor/`) agreed with the owner through an HTML
prototype: `docs/plans/card-editor-fixed-zones.html` (open it in a browser; it is the visual reference — sizes,
order, borders, hints). Goal: on a phone with the soft keyboard open, nothing moves while you
write by hand and type; one side is edited at a time.

## Layout (top to bottom)

```
┌──────────────────────────────────────────┐
│ Biology · 2 added               🗑    ✕   │  title bar
├──────────────────────────────────┬───────┤
│ FRONT     ●   ⌫   ↶   ⊘          │       │  tool row (right cell empty)
│┌────────────────────────────────┐│┌─────┐│
││ pen zone, fixed height         │││Front││  switch: exactly as tall as the
││ "Draw on front"                │││ ⇅   ││  pen zone, top and bottom aligned
││                                │││Back ││
│└────────────────────────────────┘│└─────┘│
│┌────────────────────────────────┐│ Save  │
││ text zone: fills the rest      ││ & next│  2/3
││ "Type the question" (scrolls)  │├───────┤
│└────────────────────────────────┘│ Save &│  1/3
└──────────────────────────────────┴ close ┘
              (soft keyboard below)
```

1. **Title bar**: note title, the "n added" badge (add mode), then on the right a 🗑 button and,
   with clear space between them, ✕.
    - 🗑 is **Delete card**: add mode — an empty card closes at once, otherwise two taps
      ("Tap again to delete", 3 s), drops the card, no draft; edit mode — two taps, deletes the
      card from its note (existing `opts.delete()`, existing behaviour incl. ink trash, review
      moves on). It replaces the footer's Delete card button.
    - ✕ closes without saving (add mode keeps the draft, as today).
2. **Tool row** (left column only): the side's name in bold caps (`FRONT` / `BACK`; cloze:
   existing cloze label), then with generous spacing (≈14 px gaps, 40 px buttons):
    - **size**: one button for the tool in use. Pen: filled dot, cycles 3 pen thicknesses
      (small default — keep the existing PEN_SIZE_STEPS factors, default step = the small one).
      Eraser: a ring whose diameter is **exactly** the eraser circle's diameter in the pen zone;
      cycles 3 eraser radii (5, 9, 15 px; medium default). Pen and eraser keep their own size.
    - **eraser** toggle (on: red/error colour, and the pen zone's border turns red),
    - **undo** — acts on the visible side only,
    - **clear side** — new icon (lucide `ban` / circle-slash), not a bin, so it can't be mixed
      up with Delete card.
3. **Pen zone**: fixed height **245 px** (CSS variable, so it can become a setting later), full
   width of the left column, rounded box. Hint "Draw on **front**" / "Draw on **back**" (bold
   word) while empty. Eraser circle (existing cursor) follows the pen while hovering/erasing with
   the eraser on, sized by the eraser radius.
4. **Text zone**: below the pen zone, fills all remaining height down to the bottom of the
   modal content; scrolls when long. Hint "Type the **question**" / "Type the **answer**"
   (bold word) while empty — rendered as an overlay element (placeholder can't be bold).
5. **Side marker**: both fields get a broad accent-coloured border (5 px, `--interactive-accent`)
   on their **right** edge on the front and on their **left** edge on the back, following the
   fields' rounded corners, only as tall as the fields. No tint, no dots.
6. **Right column** (~12% width, min ~48 px): the **switch** button (exactly the pen zone's
   height, aligned with it) reads `Front` / `⇅` / `Back`, the active side **bold**, the other
   muted; below it, aligned with the text zone, **Save & next** (2/3 of the height, accent/CTA)
   and **Save & close** (1/3). Edit mode: a single **Save** filling that area.
   Cloze cards (one side): no switch — the right column holds only the save button(s), full
   height of the body.
7. **Pen mode off** (no pen zone on either side): the text zone takes the pen zone's place too;
   the switch takes the top half of the right column, saves the bottom half. A side that already
   has handwriting still shows its pen zone (existing rule).
8. No footer anymore.

## Behaviour

- **One side at a time.** Both SideEditors exist; only the active one is shown. The switch (and
  the existing shortcuts, if any) toggle it; text and strokes are kept per side.
- **Keyboard stays open.** Drawing must not take the focus from the text area any more (remove
  `releaseTextFocus()` on pen-down; prevent default on the pen zone's pointerdown so the focus
  stays). Buttons don't take the focus either (preventDefault on pointerdown). On open, focus the
  active side's text area (also on mobile now — the keyboard is meant to be up). Switching sides
  moves the focus to the newly shown text area.
- **Save on an empty side** (instead of disabled buttons): if a needed side is empty, switch to it,
  flash its fields (brief red outline) and show a short notice ("Back is empty"); nothing is saved.
  Save buttons are therefore never disabled for emptiness (still disabled while busy).
- **S Pen side button**: Chrome on Samsung reports a side-button press while the pen hovers as
  `buttons` 0 → 1 with zero pressure and **no** pointerdown/up. A press toggles the eraser.
  Guards: only `pointerType === "pen"`, not during a gesture, not within 250 ms after the tip
  touched or lifted, and only after two consecutive hover samples with the button pressed; one
  toggle per press. Keep the existing barrel/eraser-end handling (buttons & 2 / & 32 / button 5).
- **Palm guard**: keep the existing guard (fingers ignored on buttons while the pen is down and
  500 ms after); the background tap guard stays.
- Everything else stays: drafts, Save & next clearing and focusing the front, undo/redo of ink
  per side, Ctrl/Cmd+Enter, locking while saving, pen size factor setting, guides, clipping,
  stroke split on layout shift, cancelled strokes kept, eraser cursor.

## Out of scope

Tablet/desktop-specific layouts (they get the same layout, without a soft keyboard), the
left-handed mirror, making the pen zone height a setting.

## Acceptance

- The modal matches the prototype's structure and alignment on a 384×850 viewport.
- `jest` (update the card editor modal/side editor tests to the new structure: keep tests of the
  important paths — one side shown at a time and switching, save on empty side jumps there,
  delete in the title bar (one tap empty / two taps), size button per tool, side-button toggle
  with its guards, pen-down keeps the text focus, pen mode off layout), `tsc`, `eslint` (0
  errors), `prettier --check`, `pnpm run build` all pass.
- User docs (`docs/docs/en/flashcards/card-editor.md`) and the plan's layout section describe the
  new editor.
