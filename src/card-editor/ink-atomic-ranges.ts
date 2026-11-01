import {
    Extension,
    Prec,
    RangeSet,
    RangeSetBuilder,
    RangeValue,
    Transaction,
} from "@codemirror/state";
import { EditorView, keymap, PluginValue, ViewPlugin, ViewUpdate } from "@codemirror/view";

import { INK_FILE_PREFIX, inkEmbedPath, linksIn } from "src/card-editor/core/card-text";

/** A span of text, as offsets into the text it was found in */
export interface TextRange {
    from: number;
    to: number;
}

/**
 * The inline code spans of a line ("`…`", "``…``"): a run of backticks up to the next run of the
 * same length. A run without a match is plain text.
 */
export function codeSpans(text: string): TextRange[] {
    const runs = [...text.matchAll(/`+/g)];
    const spans: TextRange[] = [];
    for (let i = 0; i < runs.length; i++) {
        const open = runs[i];
        const j = runs.findIndex((r, k) => k > i && r[0].length === open[0].length);
        if (j < 0) continue;
        spans.push({ from: open.index, to: runs[j].index + runs[j][0].length });
        i = j;
    }
    return spans;
}

/** An open fenced code block: the fence's character and length */
interface Fence {
    char: string;
    length: number;
}

// Leading spaces, tabs and quote markers: fences in lists and quotes count too
const FENCE = /^[ \t>]*(`{3,}|~{3,})(.*)$/;

/** The fenced code block open after a line, given the one open before it (null: none) */
export function fenceAfter(open: Fence | null, text: string): Fence | null {
    const m = FENCE.exec(text);
    if (open !== null) {
        const closes =
            m !== null && m[1][0] === open.char && m[1].length >= open.length && m[2].trim() === "";
        return closes ? null : open;
    }
    if (m === null) return null;
    // A backtick fence's info string has no backticks ("```js`" is inline code)
    if (m[1][0] === "`" && m[2].includes("`")) return null;
    return { char: m[1][0], length: m[1].length };
}

/**
 * Where the ink embeds ("![[…/sr-ink-…svg]]", "![](…/sr-ink-…svg)") are in the text, by the same
 * rules as for reading a side as ink (see inkEmbedPath). Other links and embeds are left out, and
 * so is an embed in inline code, which is shown as text.
 */
export function inkEmbedRanges(text: string): TextRange[] {
    const ranges: TextRange[] = [];
    const code = text.includes("`") ? codeSpans(text) : [];
    // linksIn finds the links left to right without overlap, so each one is the first occurrence
    // of its text after the previous one
    let searchFrom = 0;
    for (const link of linksIn(text)) {
        const from = text.indexOf(link.match, searchFrom);
        if (from < 0) break;
        const to = from + link.match.length;
        searchFrom = to;
        if (code.some((c) => c.from < to && from < c.to)) continue;
        if (link.match.startsWith("!") && inkEmbedPath(link.match) !== null) {
            ranges.push({ from, to });
        }
    }
    return ranges;
}

class InkAtom extends RangeValue {}
const INK_ATOM = new InkAtom();

/** The ink embeds of the visible lines, kept up to date as the note is edited or scrolled */
class InkAtomicRanges implements PluginValue {
    ranges: RangeSet<InkAtom>;

    constructor(view: EditorView) {
        this.ranges = this.compute(view);
    }

    update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) this.ranges = this.compute(update.view);
        if (update.docChanged) {
            const view = update.view;
            const win = view.dom.ownerDocument.defaultView;
            // Checked once the editor has redrawn, and again after an IME composition may have
            // held back the redraw of its line
            win?.requestAnimationFrame(() => removeStaleInk(view));
            win?.setTimeout(() => removeStaleInk(view), 300);
        }
    }

    private compute(view: EditorView): RangeSet<InkAtom> {
        const builder = new RangeSetBuilder<InkAtom>();
        const visible = view.visibleRanges;
        if (visible.length === 0) return builder.finish();
        const doc = view.state.doc;
        // Whether a line is in a fenced code block depends on the lines above it, so the scan
        // starts at the top; lines that aren't visible are only checked for fences
        const lastLine = doc.lineAt(visible[visible.length - 1].to).number;
        let fence: Fence | null = null;
        let lineFrom = 0;
        let r = 0;
        for (const text of doc.iterLines(1, lastLine + 1)) {
            const from = lineFrom;
            lineFrom += text.length + 1;
            const before = fence;
            fence = fenceAfter(fence, text);
            // Inside a block, or its opening or closing fence: code, shown as text
            if (before !== null || fence !== null) continue;
            while (r < visible.length && visible[r].to < from) r++;
            if (r === visible.length) break;
            // Embeds don't span lines, so a line at a time is enough
            if (visible[r].from > from + text.length || !text.includes("![")) continue;
            for (const range of inkEmbedRanges(text)) {
                builder.add(from + range.from, from + range.to, INK_ATOM);
            }
        }
        return builder.finish();
    }
}

const inkAtomicRangesPlugin = ViewPlugin.fromClass(InkAtomicRanges);

/** Called with what removeStaleInk() found, for the input log */
let onStaleInk: ((names: string[]) => void) | null = null;

/**
 * Removes images of handwriting the note no longer embeds. On Android a keyboard with word
 * suggestions keeps a composition open at the cursor, and the editor doesn't redraw the DOM
 * there meanwhile: an embed deleted next to the cursor is gone from the note but its image stays
 * on screen. The image is shown only while its line in the note still has the embed.
 */
export function removeStaleInk(view: EditorView): void {
    if (!view.dom.isConnected) return;
    const removed: string[] = [];
    view.contentDOM
        .querySelectorAll<HTMLElement>(`.internal-embed[src*="${INK_FILE_PREFIX}"]`)
        .forEach((embed) => {
            // Inside an embedded note: rendered from that note, not from this editor's text
            if (embed.parentElement?.closest(".internal-embed, .markdown-embed")) return;
            const src = embed.getAttribute("src") ?? "";
            let pos: number;
            try {
                pos = view.posAtDOM(embed);
            } catch {
                return;
            }
            if (pos < 0 || pos > view.state.doc.length) return;
            if (view.state.doc.lineAt(pos).text.includes(src)) return;
            removed.push(src);
            embed.remove();
        });
    if (removed.length > 0) onStaleInk?.(removed);
}

/** Sets who hears of stale images removed (see removeStaleInk) */
export function setStaleInkListener(listener: ((names: string[]) => void) | null): void {
    onStaleInk = listener;
}

/**
 * Deletes the whole ink embed the cursor is in or, toward the deletion, next to. The atomic ranges
 * alone don't cover a cursor inside an embed (a tap on Android, Find, the Editor API put it
 * there): Backspace would delete only from the embed's start to the cursor and leave the rest as
 * broken text.
 */
function deleteInk(view: EditorView, forward: boolean): boolean {
    const { ranges, main } = view.state.selection;
    if (ranges.length !== 1 || !main.empty) return false;
    const pos = main.head;
    let hit: TextRange | null = null;
    view.plugin(inkAtomicRangesPlugin)?.ranges.between(pos, pos, (from, to) => {
        if (forward ? from <= pos && pos < to : from < pos && pos <= to) {
            hit = { from, to };
            return false;
        }
    });
    if (hit === null) return false;
    const { from, to } = hit;
    view.dispatch({
        changes: { from, to },
        selection: { anchor: from },
        scrollIntoView: true,
        userEvent: forward ? "delete.forward" : "delete.backward",
    });
    return true;
}

/**
 * The links of the ink embeds an edit by the user removed (deleted or typed over), as written.
 * Cut is left out: the embed is meant to be pasted elsewhere. So are undo, redo and changes not
 * made by the user (e.g. the note reloaded after the card editor wrote it).
 */
export function removedInkLinks(tr: Transaction): string[] {
    if (!tr.docChanged || tr.isUserEvent("delete.cut")) return [];
    if (!tr.isUserEvent("delete") && !tr.isUserEvent("input")) return [];
    const links: string[] = [];
    tr.changes.iterChanges((fromA, toA) => {
        if (toA === fromA) return;
        const text = tr.startState.doc.sliceString(fromA, toA);
        for (const range of inkEmbedRanges(text)) {
            const path = inkEmbedPath(text.slice(range.from, range.to));
            if (path !== null) links.push(path);
        }
    });
    return links;
}

/**
 * Makes every ink embed in the editor one unit: the cursor moves over it in one step, and
 * Backspace / Delete next to it or inside it remove all of it (also on Android, where the
 * keyboard's deletions are run as Backspace). Without this, deleting it takes one character at a
 * time. Embeds in code are left as text. onInkRemoved hears of embeds the user removed.
 */
export function inkAtomicRanges(
    onInkRemoved?: (links: string[], view: EditorView) => void,
): Extension {
    return [
        EditorView.updateListener.of((update) => {
            if (!onInkRemoved || !update.docChanged) return;
            const links = update.transactions.flatMap(removedInkLinks);
            if (links.length > 0) onInkRemoved(links, update.view);
        }),
        inkAtomicRangesPlugin,
        EditorView.atomicRanges.of(
            (view) => view.plugin(inkAtomicRangesPlugin)?.ranges ?? RangeSet.empty,
        ),
        Prec.high(
            keymap.of([
                { key: "Backspace", run: (view) => deleteInk(view, false) },
                { key: "Delete", run: (view) => deleteInk(view, true) },
            ]),
        ),
    ];
}
