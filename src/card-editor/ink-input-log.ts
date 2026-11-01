import { Extension, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

import { setStaleInkListener } from "src/card-editor/ink-atomic-ranges";

/**
 * TEMPORARY, for finding out what Android keyboards send when deleting handwriting in a note.
 * Logs the editor's input events and changes for two seconds after each deletion attempt, while
 * the note has handwriting, and appends them to a file. Remove once deleting works on the device.
 */
export function inkInputLog(append: (lines: string) => void): Extension {
    let until = 0;
    let buffer: string[] = [];
    let timer: number | null = null;
    const t0 = Date.now();
    const log = (line: string) => {
        buffer.push(`${((Date.now() - t0) / 1000).toFixed(3)} ${line}`);
        if (timer === null)
            timer = window.setTimeout(() => {
                timer = null;
                const lines = buffer.join("\n") + "\n";
                buffer = [];
                append(lines);
            }, 1000);
    };
    const near = (view: EditorView) => {
        const { head } = view.state.selection.main;
        const line = view.state.doc.lineAt(head);
        const show = (n: number) =>
            n >= 1 && n <= view.state.doc.lines ? JSON.stringify(view.state.doc.line(n).text) : "-";
        return `sel=${view.state.selection.ranges.map((r) => `${r.anchor}-${r.head}`).join(",")} line${line.number}@${head - line.from}/${line.length} prev=${show(line.number - 1)} cur=${show(line.number)} next=${show(line.number + 1)}`;
    };
    const inkInView = (view: EditorView) =>
        view.contentDOM.querySelector(".internal-embed[src*='sr-ink-']") !== null;
    setStaleInkListener((names) => log(`STALE removed ${names.join(",")}`));

    return ViewPlugin.define((view) => {
        const doc = view.contentDOM;
        const start = (why: string) => {
            if (!inkInView(view)) return;
            if (Date.now() > until) log(`---- ${why} ${near(view)}`);
            until = Date.now() + 2000;
        };
        const active = () => Date.now() <= until;
        const handlers: [string, (e: Event) => void][] = [
            [
                "keydown",
                (e) => {
                    const k = e as KeyboardEvent;
                    if (k.keyCode === 8 || k.keyCode === 46 || k.keyCode === 229) start("keydown");
                    if (active())
                        log(`keydown key=${k.key} code=${k.keyCode} composing=${k.isComposing}`);
                },
            ],
            [
                "beforeinput",
                (e) => {
                    const i = e as InputEvent;
                    if (i.inputType.startsWith("delete")) start("beforeinput");
                    if (active()) {
                        const ranges = i
                            .getTargetRanges?.()
                            .map((r) => {
                                try {
                                    return `${view.posAtDOM(r.startContainer, r.startOffset)}-${view.posAtDOM(r.endContainer, r.endOffset)}`;
                                } catch {
                                    return "?";
                                }
                            })
                            .join(",");
                        log(
                            `beforeinput ${i.inputType} data=${JSON.stringify(i.data)} composing=${i.isComposing} targets=${ranges} ${near(view)}`,
                        );
                    }
                },
            ],
            ["input", (e) => active() && log(`input ${(e as InputEvent).inputType}`)],
            ["compositionstart", (e) => active() && log(`compositionstart ${JSON.stringify((e as CompositionEvent).data)}`)],
            ["compositionupdate", (e) => active() && log(`compositionupdate ${JSON.stringify((e as CompositionEvent).data)}`)],
            ["compositionend", (e) => active() && log(`compositionend ${JSON.stringify((e as CompositionEvent).data)}`)],
        ];
        handlers.forEach(([type, h]) => doc.addEventListener(type, h, true));
        let observer: MutationObserver | null = new MutationObserver((records) => {
            if (!active()) return;
            for (const r of records) {
                const desc = (n: Node) =>
                    n.nodeType === 3
                        ? `#text${JSON.stringify(n.textContent?.slice(0, 20))}`
                        : `${n.nodeName.toLowerCase()}.${(n as Element).className?.toString().split(" ")[0] ?? ""}`;
                const added = Array.from(r.addedNodes).map(desc).join("|");
                const removed = Array.from(r.removedNodes).map(desc).join("|");
                if (r.type === "childList" && (added || removed))
                    log(`dom ${desc(r.target)} +[${added}] -[${removed}]`);
                else if (r.type === "characterData")
                    log(`dom text ${JSON.stringify(r.oldValue)} -> ${JSON.stringify(r.target.textContent)}`);
            }
        });
        observer.observe(doc, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
        return {
            update(u) {
                if (!active()) return;
                for (const tr of u.transactions) {
                    const changes: string[] = [];
                    tr.changes.iterChanges((fa, ta, _fb, _tb, ins) =>
                        changes.push(`${fa}-${ta}:${JSON.stringify(u.startState.doc.sliceString(fa, ta).slice(0, 60))}->${JSON.stringify(ins.toString().slice(0, 30))}`),
                    );
                    const ev = tr.annotation(Transaction.userEvent) ?? "none";
                    if (changes.length || tr.selection)
                        log(`tr ${ev} ${changes.join(" ")} ${near(u.view)}`);
                }
                const imgs = Array.from(view.contentDOM.querySelectorAll(".internal-embed[src*='sr-ink-']")).map((e) => e.getAttribute("src"));
                if (u.docChanged) log(`  shown=${imgs.join(",")} composing=${u.view.composing}`);
            },
            destroy() {
                handlers.forEach(([type, h]) => doc.removeEventListener(type, h, true));
                observer?.disconnect();
                observer = null;
            },
        };
    });
}
