import { EditorState, RangeSet, RangeValue } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";

import { inkAtomicRanges, inkEmbedRanges, removedInkLinks } from "src/card-editor/ink-atomic-ranges";

function slices(text: string): string[] {
    return inkEmbedRanges(text).map((r) => text.slice(r.from, r.to));
}

describe("inkEmbedRanges", () => {
    test("finds wiki and markdown embeds of ink images, nothing else", () => {
        const text =
            "Q ![[sr-ink/sr-ink-abc-front.svg|200]] and ![](<my folder/sr-ink-x.svg>) " +
            "![[photo.png]] [[sr-ink-y.svg]] ![[sr-ink/other.svg]]";
        expect(slices(text)).toEqual([
            "![[sr-ink/sr-ink-abc-front.svg|200]]",
            "![](<my folder/sr-ink-x.svg>)",
        ]);
    });

    test("skips embeds in inline code", () => {
        expect(inkEmbedRanges("`![[sr-ink-x.svg]]`")).toEqual([]);
        expect(slices("`code` ![[sr-ink-x.svg]] `more`")).toEqual(["![[sr-ink-x.svg]]"]);
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

function editor(doc: string): EditorView {
    return new EditorView({
        state: EditorState.create({ doc, extensions: [inkAtomicRanges()] }),
        parent: document.body,
    });
}

/** Presses a key the way the editor's keymaps see it */
function press(view: EditorView, key: string): boolean {
    return runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
}

describe("inkAtomicRanges", () => {
    const embed = "![[sr-ink/sr-ink-abc-back.svg]]";
    const doc = `Question\n?\nAnswer\n${embed}\n\nNext`;
    const embedFrom = doc.indexOf(embed);
    const embedTo = embedFrom + embed.length;
    const without = "Question\n?\nAnswer\n\n\nNext";

    test("Backspace after or inside an ink embed deletes all of it", () => {
        // Inside: as after a tap between "sr-i" and "nk" on Android
        for (const pos of [embedTo, embedFrom + 12]) {
            const view = editor(doc);
            view.dispatch({ selection: { anchor: pos } });
            expect(press(view, "Backspace")).toBe(true);
            expect(view.state.doc.toString()).toBe(without);
            expect(view.state.selection.main.head).toBe(embedFrom);
            view.destroy();
        }
    });

    test("Delete inside or before an ink embed deletes all of it", () => {
        for (const pos of [embedFrom, embedFrom + 5]) {
            const view = editor(doc);
            view.dispatch({ selection: { anchor: pos } });
            expect(press(view, "Delete")).toBe(true);
            expect(view.state.doc.toString()).toBe(without);
            view.destroy();
        }
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

    test("only ink embeds outside code are atomic", () => {
        const view = editor(
            [
                "`![[sr-ink-a.svg]]`",
                "```",
                "![[sr-ink-b.svg]]",
                "```",
                "![[photo.png]]",
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
});

describe("removed ink links", () => {
    const doc = "Q\n![[sr-ink/sr-ink-a-front.svg]]\n?\n![[x.png]]";
    const embedFrom = 2;
    const embedTo = doc.indexOf("\n?");

    function removed(userEvent: string | undefined, from = embedFrom, to = embedTo): string[] {
        const state = EditorState.create({ doc });
        return removedInkLinks(state.update({ changes: { from, to }, userEvent }));
    }

    test("an ink embed the user deleted or typed over, not cut, undo or partial deletes", () => {
        expect(removed("delete.backward")).toEqual(["sr-ink/sr-ink-a-front.svg"]);
        expect(removed("input.type")).toEqual(["sr-ink/sr-ink-a-front.svg"]);
        expect(removed("delete.cut")).toEqual([]);
        expect(removed("undo")).toEqual([]);
        expect(removed(undefined)).toEqual([]);
        expect(removed("delete.backward", embedFrom + 5, embedTo)).toEqual([]);
    });

    test("onInkRemoved hears of ink embeds the user removed", () => {
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

describe("a keyboard's delete next to an ink embed (Android)", () => {
    // jsdom has no layout; scrolling the cursor into view measures text
    beforeAll(() => {
        Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
        Range.prototype.getBoundingClientRect ??= () => new DOMRect();
    });

    const doc = "Q\n![[sr-ink-a-front.svg]]\n?";
    const embedEnd = doc.indexOf("\n?");

    function setup(): EditorView {
        jest.useFakeTimers();
        const view = new EditorView({
            state: EditorState.create({
                doc,
                selection: { anchor: embedEnd },
                extensions: [inkAtomicRanges()],
            }),
            parent: document.body,
        });
        view.contentDOM.dispatchEvent(
            new InputEvent("beforeinput", { inputType: "deleteContentBackward", cancelable: true }),
        );
        return view;
    }

    afterEach(() => jest.useRealTimers());

    test("deletes the embed when Chrome only moved the cursor over the image", () => {
        const view = setup();
        // What Chrome did on the device: the cursor before the image, the text as it was
        view.dispatch({ selection: { anchor: 2 }, userEvent: "select" });
        jest.advanceTimersByTime(100);
        expect(view.state.doc.toString()).toBe("Q\n\n?");
        expect(view.state.selection.main.head).toBe(2);
        view.destroy();
    });

    test("does nothing more when the embed was deleted meanwhile", () => {
        const view = setup();
        view.dispatch({ changes: { from: 2, to: embedEnd }, userEvent: "delete.backward" });
        jest.advanceTimersByTime(100);
        expect(view.state.doc.toString()).toBe("Q\n\n?");
        view.destroy();
    });
});
