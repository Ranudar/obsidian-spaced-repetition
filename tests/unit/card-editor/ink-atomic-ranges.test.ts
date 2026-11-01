import { EditorState, RangeSet, RangeValue } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";

import {
    codeSpans,
    fenceAfter,
    inkAtomicRanges,
    inkEmbedRanges,
    removedInkLinks,
    removeStaleInk,
} from "src/card-editor/ink-atomic-ranges";

function slices(text: string): string[] {
    return inkEmbedRanges(text).map((r) => text.slice(r.from, r.to));
}

describe("inkEmbedRanges", () => {
    test("finds wiki embeds of ink images", () => {
        const text = "Question ![[sr-ink/sr-ink-abc-front.svg]] after";
        expect(inkEmbedRanges(text)).toEqual([{ from: 9, to: 41 }]);
        expect(slices(text)).toEqual(["![[sr-ink/sr-ink-abc-front.svg]]"]);
    });

    test("finds wiki embeds with size or alias", () => {
        expect(slices("![[sr-ink-x.svg|200]]")).toEqual(["![[sr-ink-x.svg|200]]"]);
    });

    test("finds markdown embeds, also url-encoded and in angle brackets", () => {
        expect(slices("a ![](sr-ink/sr-ink-x.svg) b")).toEqual(["![](sr-ink/sr-ink-x.svg)"]);
        expect(slices("![ink](my%20folder/sr-ink-x.svg)")).toEqual([
            "![ink](my%20folder/sr-ink-x.svg)",
        ]);
        expect(slices('![](<my folder/sr-ink-x.svg> "t")')).toEqual([
            '![](<my folder/sr-ink-x.svg> "t")',
        ]);
    });

    test("finds several embeds in a line", () => {
        const text = "![[sr-ink-a.svg]] and ![[sr-ink-b.svg]]";
        expect(inkEmbedRanges(text)).toEqual([
            { from: 0, to: 17 },
            { from: 22, to: 39 },
        ]);
    });

    test("skips other images, links and non-embeds of ink files", () => {
        expect(inkEmbedRanges("![[photo.png]] ![](pic.svg) ![[sr-ink-x.png]]")).toEqual([]);
        expect(inkEmbedRanges("[[sr-ink-x.svg]] [x](sr-ink-x.svg)")).toEqual([]);
        expect(inkEmbedRanges("![[folder/sr-ink-x.svg#heading]]")).toEqual([{ from: 0, to: 32 }]);
        expect(inkEmbedRanges("![[sr-ink/other.svg]]")).toEqual([]);
    });

    test("an ink embed after a link with the same text is found at its own place", () => {
        const text = "[[sr-ink-a.svg]] ![[sr-ink-a.svg]]";
        expect(inkEmbedRanges(text)).toEqual([{ from: 17, to: 34 }]);
    });

    test("skips embeds in inline code", () => {
        expect(inkEmbedRanges("`![[sr-ink-x.svg]]`")).toEqual([]);
        expect(inkEmbedRanges("a ``x ![[sr-ink-x.svg]] y`` b")).toEqual([]);
        // An unmatched backtick is text
        expect(slices("` ![[sr-ink-x.svg]]")).toEqual(["![[sr-ink-x.svg]]"]);
        expect(slices("`code` ![[sr-ink-x.svg]] `more`")).toEqual(["![[sr-ink-x.svg]]"]);
    });

    test("no embeds", () => {
        expect(inkEmbedRanges("")).toEqual([]);
        expect(inkEmbedRanges("just text ![ broken")).toEqual([]);
    });
});

describe("codeSpans", () => {
    test("matches runs of the same length", () => {
        expect(codeSpans("a `b` c")).toEqual([{ from: 2, to: 5 }]);
        expect(codeSpans("``a ` b``")).toEqual([{ from: 0, to: 9 }]);
        expect(codeSpans("` a")).toEqual([]);
        expect(codeSpans("`` a ` b `")).toEqual([{ from: 5, to: 10 }]);
    });
});

describe("fenceAfter", () => {
    test("opens and closes with the same kind of fence, at least as long", () => {
        const open = fenceAfter(null, "```md");
        expect(open).toEqual({ char: "`", length: 3 });
        expect(fenceAfter(open, "~~~")).toBe(open);
        expect(fenceAfter(open, "``` x")).toBe(open);
        expect(fenceAfter(open, "````")).toBeNull();
        expect(fenceAfter(null, "> ~~~~")).toEqual({ char: "~", length: 4 });
        expect(fenceAfter(null, "```a`")).toBeNull();
        expect(fenceAfter(null, "text")).toBeNull();
    });
});

/** The atomic ranges the editor sees, as [from, to] pairs */
function atomicRanges(view: EditorView): [number, number][] {
    const result: [number, number][] = [];
    for (const get of view.state.facet(EditorView.atomicRanges)) {
        const set = get(view) as RangeSet<RangeValue>;
        set.between(0, view.state.doc.length, (from, to) => {
            result.push([from, to]);
        });
    }
    return result;
}

/**
 * Backspace with the cursor at pos, as @codemirror/commands' deleteCharBackward does it: one
 * character back, then out of any atomic range that position falls inside (skipAtomic).
 */
function backspace(view: EditorView, pos: number): void {
    let target = pos - 1;
    for (const get of view.state.facet(EditorView.atomicRanges)) {
        get(view).between(target, target, (from, to) => {
            if (from < target && to > target) target = from;
        });
    }
    view.dispatch({ changes: { from: target, to: pos }, userEvent: "delete.backward" });
}

function editor(doc: string): EditorView {
    return new EditorView({
        state: EditorState.create({ doc, extensions: [inkAtomicRanges()] }),
        parent: document.body,
    });
}

describe("inkAtomicRanges", () => {
    const embed = "![[sr-ink/sr-ink-abc-back.svg]]";
    const doc = `Question\n?\nAnswer\n${embed}\n\nNext`;
    const embedFrom = doc.indexOf(embed);
    const embedTo = embedFrom + embed.length;

    test("each ink embed is atomic, nothing else", () => {
        const view = editor(doc + "\n![[photo.png]]");
        expect(atomicRanges(view)).toEqual([[embedFrom, embedTo]]);
        view.destroy();
    });

    test("Backspace after an ink embed deletes all of it", () => {
        const view = editor(doc);
        backspace(view, embedTo);
        expect(view.state.doc.toString()).toBe("Question\n?\nAnswer\n\n\nNext");
        expect(atomicRanges(view)).toEqual([]);
        view.destroy();
    });

    test("Backspace after other text deletes one character", () => {
        const view = editor(doc);
        backspace(view, embedFrom - 1);
        expect(view.state.doc.toString()).toBe(`Question\n?\nAnswe\n${embed}\n\nNext`);
        view.destroy();
    });

    /** Presses a key the way the editor's keymaps see it */
    function press(view: EditorView, key: string): boolean {
        return runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
    }

    test("Backspace with the cursor inside an ink embed deletes all of it", () => {
        const view = editor(doc);
        // As after a tap between "sr-i" and "nk" on Android
        view.dispatch({ selection: { anchor: embedFrom + 12 } });
        expect(press(view, "Backspace")).toBe(true);
        expect(view.state.doc.toString()).toBe("Question\n?\nAnswer\n\n\nNext");
        expect(view.state.selection.main.head).toBe(embedFrom);
        view.destroy();
    });

    test("Delete inside or before an ink embed deletes all of it", () => {
        for (const pos of [embedFrom, embedFrom + 5]) {
            const view = editor(doc);
            view.dispatch({ selection: { anchor: pos } });
            expect(press(view, "Delete")).toBe(true);
            expect(view.state.doc.toString()).toBe("Question\n?\nAnswer\n\n\nNext");
            view.destroy();
        }
    });

    test("Backspace after an ink embed, by key, deletes all of it", () => {
        const view = editor(doc);
        view.dispatch({ selection: { anchor: embedTo } });
        expect(press(view, "Backspace")).toBe(true);
        expect(view.state.doc.toString()).toBe("Question\n?\nAnswer\n\n\nNext");
        view.destroy();
    });

    test("other deletions are left to the editor", () => {
        const view = editor(doc);
        // Before the embed (Backspace), after it (Delete), and with text selected
        view.dispatch({ selection: { anchor: embedFrom } });
        expect(press(view, "Backspace")).toBe(false);
        view.dispatch({ selection: { anchor: embedTo } });
        expect(press(view, "Delete")).toBe(false);
        view.dispatch({ selection: { anchor: embedFrom + 2, head: embedFrom + 5 } });
        expect(press(view, "Backspace")).toBe(false);
        expect(view.state.doc.toString()).toBe(doc);
        view.destroy();
    });

    test("ink embeds in code are not atomic", () => {
        const view = editor(
            [
                "`![[sr-ink-a.svg]]`",
                "```",
                "![[sr-ink-b.svg]]",
                "```",
                "~~~~",
                "````",
                "![[sr-ink-c.svg]]",
                "~~~~",
                embed,
            ].join("\n"),
        );
        const text = view.state.doc.toString();
        const from = text.lastIndexOf(embed);
        expect(atomicRanges(view)).toEqual([[from, from + embed.length]]);
        view.dispatch({ selection: { anchor: text.indexOf("sr-ink-b") + 2 } });
        expect(press(view, "Backspace")).toBe(false);
        view.destroy();
    });

    test("ranges follow edits", () => {
        const view = editor(doc);
        view.dispatch({ changes: { from: 0, insert: "New " } });
        expect(atomicRanges(view)).toEqual([[embedFrom + 4, embedTo + 4]]);
        view.dispatch({ changes: { from: doc.length + 4, insert: " ![](sr-ink-x.svg)" } });
        expect(atomicRanges(view)).toEqual([
            [embedFrom + 4, embedTo + 4],
            [doc.length + 5, doc.length + 22],
        ]);
        view.destroy();
    });
});

describe("removedInkLinks", () => {
    const doc = "Q\n![[sr-ink/sr-ink-a-front.svg]]\n?\n![[x.png]]";
    const embedFrom = 2;
    const embedTo = doc.indexOf("\n?");

    function removed(userEvent: string | undefined, from = embedFrom, to = embedTo): string[] {
        const state = EditorState.create({ doc });
        return removedInkLinks(state.update({ changes: { from, to }, userEvent }));
    }

    test("an ink embed deleted or typed over", () => {
        expect(removed("delete.backward")).toEqual(["sr-ink/sr-ink-a-front.svg"]);
        expect(removed("delete.selection", 0, doc.length)).toEqual(["sr-ink/sr-ink-a-front.svg"]);
        expect(removed("input.type")).toEqual(["sr-ink/sr-ink-a-front.svg"]);
    });

    test("not cut, undo or changes not made by the user", () => {
        expect(removed("delete.cut")).toEqual([]);
        expect(removed("undo")).toEqual([]);
        expect(removed(undefined)).toEqual([]);
    });

    test("not other embeds, nor an ink embed only partly deleted", () => {
        expect(removed("delete.backward", doc.indexOf("![[x"), doc.length)).toEqual([]);
        expect(removed("delete.backward", embedFrom + 5, embedTo)).toEqual([]);
    });
});

describe("inkAtomicRanges onInkRemoved", () => {
    test("hears of ink embeds the user removed", () => {
        const heard: string[][] = [];
        const view = new EditorView({
            state: EditorState.create({
                doc: "![[sr-ink-b-back.svg]]",
                extensions: [inkAtomicRanges((links) => heard.push(links))],
            }),
        });
        view.dispatch({ changes: { from: 0, to: 22 }, userEvent: "delete.backward" });
        expect(heard).toEqual([["sr-ink-b-back.svg"]]);
        view.destroy();
    });
});

describe("removeStaleInk", () => {
    function viewWithEmbed(doc: string, src: string): { view: EditorView; embed: HTMLElement } {
        const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
        const embed = document.createElement("div");
        embed.className = "internal-embed image-embed";
        embed.setAttribute("src", src);
        view.contentDOM.querySelector(".cm-line").appendChild(embed);
        return { view, embed };
    }

    test("removes the image of an embed no longer in its line", () => {
        const { view, embed } = viewWithEmbed("?", "sr-ink-a-front.svg");
        removeStaleInk(view);
        expect(embed.isConnected).toBe(false);
        view.destroy();
    });

    test("keeps the image while its line still embeds it", () => {
        const { view, embed } = viewWithEmbed("![[sr-ink-a-front.svg]]", "sr-ink-a-front.svg");
        removeStaleInk(view);
        expect(embed.isConnected).toBe(true);
        view.destroy();
    });

    test("keeps other images", () => {
        const { view, embed } = viewWithEmbed("?", "photo.png");
        removeStaleInk(view);
        expect(embed.isConnected).toBe(true);
        view.destroy();
    });
});
