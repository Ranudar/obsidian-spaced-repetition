# Cleanup plan: simplifications in the card editor and upstream bug fixes

## Goal

Make the repo simpler and more readable without adding complexity, and fix real upstream bugs.
Branch: the fork's `main` plus `feat/handwriting-setting` (card editor feature in `src/card-editor/`,
the rest is upstream st3v3nmw/obsidian-spaced-repetition code). Every change must keep behaviour
unless the item says it fixes a bug. The owner explicitly wants the upstream bug fixes, including
the behaviour-changing U2 (parser drops cards after HTML comments) and U3 (start-of-day boundary).

The proposals below come from a code audit whose findings were each checked by a skeptical
second reviewer. This review should judge: is each item correct (verify against the code), is the
proposed fix really simpler / not adding complexity, is anything risky or wrongly scoped, and is
anything important missing from the plan (e.g. tests needed for the bug fixes).

## Acceptance

- All items implemented as small, focused commits (our cleanups together; each upstream bug fix
  separately, with a regression test for U1–U5 where testable).
- `jest`, `tsc --noEmit`, `eslint` (0 errors) and `prettier --check` pass.
- No behaviour change except the listed bug fixes.

## Scope decisions (after plan review round 1)

- **In scope:** items 1–10, upstream bug fixes U1–U7, cleanups U8, U10, U11, U12, U13.
- **Item 11 (settings migration removal): deferred.** Loading a build upgrades settings only in
  memory (`PluginDataManager.loadData()` doesn't always save), so a device having loaded a
  current build doesn't prove the migration was persisted. The migration stays. [R1]
- **U9 (OSR scheduling dedup): out of scope.** The four paths differ (`noteCalcUpdatedSchedule()`
  updates `noteEaseList`; card paths return zero delay, updated notes use the constructor
  default), so a uniform helper risks behaviour change for little gain. [R2]

## Test plan additions

- **U3:** rewrite `tests/unit/utils/dates.test.ts:52–58` (23:00 boundary expecting today's
  year/month/week) to use a fixed clock with explicit expected dates; cover before, exactly at and
  after the boundary (incl. `04:00:00`), and restore the clock/provider state afterwards. [R3]
- **U11:** remove the synthetic test at `tests/unit/note-card-schedule-parser.test.ts:57` that
  forces the deleted fallback branch via a string substitute; keep the real-string legacy-format
  coverage. [R4]
- **U2:** tests for a one-line HTML comment followed by a card, a multi-line comment followed by
  a card, and a card inside a comment (still ignored).
- **U1:** test that the reset and open-in-background commands have distinct ids.
- **U4:** test that `t()` falls back to English for a locale without a translation.

## Items (from the audit)

## Our code (card editor)

**1. Remove the copies of the parser options and share one card-type check**
`src/card-editor/card-inserter.ts:106,116-125,179`, `src/card-editor/core/card-text.ts:166,284-291`, `src/card-editor/card-editor-service.ts:496-498`, `src/data/data-store/notes-data-store/notes-data-store.ts:142`
`parserOptions()` and the object literal in `parsesAsCard` both copy six settings fields into a new object. The settings object already has those fields with the same types, so this is unnecessary. The "is this a multi-line or single-line card" test is also written out by hand in four places, while `card-text.ts` already has its own private `isMultiLine`.
Change: call `parse(content, settings)` directly, and export `isMultiLine` / `isSingleLine` next to `CardType` in `question.ts` for all callers to use.
About −20 lines. Low risk.

**2. Use the existing delete function instead of a copy**
`card-editor-service.ts:283-294`, `notes-data-store.ts:103-115`
`deleteFromNote` repeats `NotesDataStore.delete` line for line. The only difference is that it returns a boolean. We already changed that function in our own commit.
Change: make `IDataStore.delete` return `Promise<boolean>`, pass `() => DataStore.getInstance().delete(question)`, and delete `deleteFromNote`.
About −12 lines. Low risk.

**3. Add small helpers for creating and trashing ink images in the service**
`card-editor-service.ts:312,377-385,400-405,532-545,600,658-669`
The "trash the image file, log an error if it fails" call appears four times. The `catch` in `addCard` does exactly what `undoSave(created, [])` already does. The five steps that create a new ink image are copied between `sideText` and `saveSide`.
Change: call `undoSave(created, [])` in that `catch`, and add two private helpers, `trashQuietly(file)` and `createInk(...)`.
About −16 lines. Low risk.

**4. One helper for tracking code fences**
`core/card-text.ts:137-148,224-235,250-259`
`openFence`, `protectBlankLines` and `cardMarkerLine` each contain the same loop that tracks whether a line is inside a ``` code fence.
Change: add one `parserFenceAfter(fence, line)` function. Give it a name that can't be confused with `fenceAfter` in `ink-atomic-ranges.ts`, which uses a different rule. Leave `insertionLine` as it is, because its loop works differently.
About −9 lines. Low risk.

**5. Small leftovers in the editor dialog**
`card-editor-modal.ts:105,117,163-185,346,437,477,618`
- `discardButton` is typed as possibly null and checked for null in three places, but it is always created.
- The `isAdd` getter is used only once.
- The four pen event listeners are added and removed one by one, although the file already loops over a constant list (`LOCKED_EVENTS`) for other events.
- The "pen was just used" condition is written twice.

Change: declare `discardButton!` and drop the null checks, inline `isAdd`, loop over a `PEN_EVENTS` constant, and add a `penJustUsed` getter. Keep `textDirection` optional, because making it required would break the test fixtures.
About −12 lines. Low risk.

**6. Dead code in `InkField`**
`ink-field.ts:26,158-163,513,571`, `side-editor.ts:80`
`clear()` is never called. The first argument of the `onChange` callback (the field) is ignored by its only user. The "nothing drawn" condition is written twice.
Change: delete `clear()`, change the callback to `(previous) => void` (one test line changes), and optionally add a `blank` getter.
About −8 lines. Low risk.

**7. Share `openDocuments()` and the image selector**
`pencil-buttons.ts:9,148`, `ink-files.ts:8,203`
The method and the `INK_IMAGE_SELECTOR` constant are identical in both files.
Change: export both from `ink-files.ts` and import them in `pencil-buttons.ts`, which already imports from that file.
About −9 lines. Low risk.

**8. Reuse the helpers for image file names**
`ink-files.ts:225-235`, `core/card-text.ts:34-38,44,80-84`
`imageFileName` re-implements `imageKey` and `fileNameOf`. The "try to URL-decode, keep the text if that fails" block appears three times.
Change: build `imageFileName` on `imageKey` and `fileNameOf`, and add a `safeDecodeURIComponent` helper.
About −7 lines. Low risk.

**9. Merge the two delete actions and remove impossible checks in `ink-atomic-ranges.ts`**
`ink-atomic-ranges.ts:76,167-172,188-193,211`
The two handlers send the same "delete this range" change to the editor. Two checks can never fail: the `startsWith("!")` check, and the `path !== null` check.
Change: add one `deleteRange(view, range, forward)` function and drop both checks.
About −7 lines. Low risk.

**10. One method for writing the edited question**
`card-editor-service.ts:256-268`, `src/scheduling/flashcard-review-sequencer.ts:440-449`
The same "set the new question text, write it to the note, restore the old text if the write fails" block appears twice. Both files are upstream files, but these exact lines are ours.
Change: add `Question.writeActualQuestion(text, settings): Promise<boolean>` and call it from both places.
About −8 lines. Low risk.

**11. Remove the settings migration for unreleased builds (only after you confirm)**
`src/data/settings.ts:206,261-273`, plus `tests/unit/data/settings.test.ts`
This code converts two settings keys that only existed in card editor builds that were never released. Once every device of yours has loaded a current build, it can never run again.
Change: delete the migration block, `OLD_DEFAULT_CARD_EDITOR_PEN_SIZE` and their tests. Leave the unused `NO_INPUT` locale key alone, because removing it would change 20 upstream locale files.
About −18 lines. Low risk, but only once you've confirmed that all your devices have run a current build.

## Upstream code

Changing these files makes merging future upstream releases harder, because every change can conflict. The bug fixes are worth it, and they could also be sent upstream as pull requests. The pure cleanups are optional.

**Bug fixes**

**U1. The "reset card" hotkey is overwritten (duplicate command id)**
`src/command-manager.ts:240,269,43-51,56-296`
The "open in background" command reuses the id `srs-card-review-reset`, so it replaces the reset command, and a hotkey bound to reset runs the wrong action. All 8 review hotkeys also repeat the same 13-line check.
Change: one `reviewKeyAllowed(states)` check plus a table of commands, used by both `addCustomHotkeys` and `removeCustomHotkeys`, and a new id `srs-card-review-open-in-background`. The smallest possible fix is a one-line id change plus one `removeCommand` line.
About −180 lines for the full table version, about +1 for the minimal fix. Low risk. Note that a hotkey bound to the old reset id will now actually reset the card.

**U2. The parser drops cards after HTML comments**
`src/parser.ts:108-110`
The loop checks `currentLine`, which never changes inside the loop. As a result, a one-line comment hides the line right after it, and a comment that spans several lines hides the rest of the note.
Change: check `lines[i]` instead and drop the extra `i++`. Add three tests.
About −1 line. Medium risk: cards that this bug used to hide will start appearing in decks.

**U3. The "start of day" setting almost never takes effect**
`src/utils/dates.ts:117-140`, `src/data/core.ts:63-77`
The condition requires hour, minute and second all to be non-zero, so a value like `04:00:00` is ignored. `core.ts` also parses the setting by hand, without the range checks that `DateUtil.strToDayBoundary` already has.
Change: apply the boundary when any of the three is non-zero, and use `strToDayBoundary` in `core.ts`. Add a test for `04:00`.
About −20 lines. Medium risk: the setting starts working for anyone who changed it from `00:00:00`.

**U4. `t()` crashes for languages without a translation**
`src/lang/helpers.ts:15-37`
For a language the plugin has no translation for (for example Greek), every call to `t()` throws an error instead of falling back to English.
Change: `currentTranslation()?.[key] || en[key]`.
About −2 lines. Low risk.

**U5. Switching custom hotkeys off adds them straight back**
`ui-preferences-page.tsx:100`
The line after the if/else calls `addCustomHotkeys()` unconditionally.
Change: delete that line.
About −1 line. Low risk.

**U6. The "Bury siblings" toggle is shown twice**
`flashcards-page.tsx:75-87`
The same toggle is built under "Tags & Folders" and again under "Flashcard Review".
Change: delete the copy under "Tags & Folders".
About −13 lines. Low risk.

**U7. Scroll listeners pile up on the settings pages**
`settings-page.tsx:88-157`, `statistics-page.tsx:93`
The code that is supposed to remove the listener passes a new function, so nothing is ever removed, and each time a page is shown another listener is added.
Change: keep only the listener added in the constructor and make `destroy()` an empty hook.
About −28 lines. Low risk.

**Pure cleanups**

**U8. A test-only copy of the `OsrCore` constructor**
`src/data/core.ts:79-121`, `tests/unit/helpers/unit-test-core.ts:20-51`
`initUnitTestCore` copies the whole constructor body and exists only so the test helper can set itself up a second time.
Change: build the test objects before calling `super()` and delete the method.
About −55 lines. Low risk: it only deletes a method from the upstream file.

**U9. Duplicated scheduling code in the OSR algorithm**
`srs-algorithm-osr.ts:78-266`
Four methods compute a schedule and build the result object in the same way. The existing helper creates a schedule that is due today, which the callers then patch or throw away.
Change: let `calcSchedule` return the finished schedule, so each method becomes one call.
About −30 lines. Low risk, but it touches a lot of upstream lines.

**U10. Code in `core.ts` that does nothing**
`core.ts:21-23,207,239,277-282`
The note schedule is read twice in a row. A fallback branch can never run, and the `IOsrVaultEvents` interface is never used.
Change: reuse the first read, remove the fallback branch, and delete the interface.
About −10 lines. Low risk.

**U11. Old schedule-reading code that can never run**
`notes-data-store.ts:50-61`
The old-format branch in `createSchedule` can't be reached, because an earlier branch always returns first.
Change: delete the block, and the `SM2_SCHEDULE_INFO_EXTRACTOR` constant if nothing else uses it.
About −12 lines. Low risk.

**U12. `topic-path.ts` copies its own helpers**
`topic-path.ts:44-50,189-195`
Two blocks copy helpers that already exist in the same file.
Change: call `getFolderPathFromFilename` and `getTopicPathsFromTagList` instead.
About −10 lines. Low risk.

**U13. Two calls to the same `drawBack` in the review window**
`content-manager.tsx:367-372,418-432`
After an edit, the card is redrawn with two separate `if`s that can't both be true, and the back-side branch copies the full `drawBack` call from `_showAnswer`. The redraw block is ours; `_showAnswer` is upstream.
Change: at minimum, change the second `if` to `else if`; optionally add a `_drawBack()` helper.
About −5 lines. Low risk.

## Recommendation

1. **Our cleanup pass (one commit):** items 1–10, about −110 lines. These changes don't alter behaviour and stay almost entirely in our own files. Do item 11 once you've confirmed that all your devices have run a current build.
2. **Upstream bug fixes (separate commits, each small enough to send upstream):** U1 (at least the id fix), U2, U3, U4, U5 and U6. U2 and U3 change visible behaviour, so they each need new tests.
3. **Optional:** U7, U8, U10, U11 and U12 are cheap deletions with little conflict risk. Skip U9 unless you're willing to own that file going forward.