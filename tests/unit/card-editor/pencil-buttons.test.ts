import { App, MarkdownPostProcessorContext, Notice, TFile } from "obsidian";

import { InkFiles } from "src/card-editor/ink-files";
import { PencilButtonActions, PencilButtons } from "src/card-editor/pencil-buttons";

const INK_SRC = "app://vault/sr-ink/sr-ink-20261031-141502123-back.svg?1730380000";
const INK_NAME = "sr-ink-20261031-141502123-back.svg";

function tFile(path: string): TFile {
    return Object.assign(new TFile(), { path, name: path.substring(path.lastIndexOf("/") + 1) });
}

const note = tFile("notes/bio.md");
const inkFile = tFile(`sr-ink/${INK_NAME}`);
const otherNote = tFile("notes/chem.md");

let leaves: { view: { containerEl: HTMLElement; file: TFile | null } }[];
let editInNote: jest.Mock;
let editInReview: jest.Mock;
let applyVersion: jest.Mock;
/** The file an image shows, as InkFiles finds it */
let imageFile: jest.Mock;
let buttons: PencilButtons;
let app: App;
let actions: PencilButtonActions;

beforeEach(() => {
    leaves = [];
    app = {
        vault: {
            getAbstractFileByPath: (path: string) => (path === note.path ? note : null),
        },
        workspace: {
            getLeavesOfType: () => leaves,
            iterateAllLeaves: (fn: (leaf: unknown) => void) => leaves.forEach(fn),
        },
    } as unknown as App;
    editInNote = jest.fn(() => Promise.resolve());
    editInReview = jest.fn(() => Promise.resolve());
    applyVersion = jest.fn();
    imageFile = jest.fn(() => inkFile);
    jest.mocked(Notice).mockClear();
    actions = {
        editInNote,
        editInReview,
        inkFiles: { applyVersion, imageFile } as unknown as InkFiles,
    };
    buttons = new PencilButtons(app, actions);
});

afterEach(() => {
    buttons.destroy();
    document.body.replaceChildren();
});

/** Waits for MutationObserver callbacks */
const mutations = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An image embed as Obsidian renders it: a span with the image inside */
function embed(src = INK_SRC, parent: HTMLElement = document.body): HTMLImageElement {
    const span = parent.createSpan({ cls: "internal-embed image-embed" });
    const img = span.createEl("img");
    img.setAttribute("src", src);
    return img;
}

/** Renders like a post-processed section of the note at sourcePath */
function postProcess(el: HTMLElement, sourcePath = note.path) {
    buttons.postProcess(el, { sourcePath } as MarkdownPostProcessorContext);
}

const buttonOf = (img: HTMLImageElement) =>
    img.parentElement.querySelector<HTMLButtonElement>(".sr-pencil-button");

function fire(el: HTMLElement, type: string, init: MouseEventInit = {}): MouseEvent {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    return e;
}

/** A pen or finger tap: pointer events, then the mouse events and click the browser adds */
function tap(el: HTMLElement): MouseEvent[] {
    return ["pointerdown", "mousedown", "pointerup", "mouseup"]
        .map((type) => fire(el, type))
        .concat(fire(el, "click", { detail: 1 }));
}

describe("adding the buttons", () => {
    test("rendered ink images get a bordered box with a pencil", () => {
        const section = document.body.createDiv();
        const img = embed(INK_SRC, section);
        postProcess(section);

        const button = buttonOf(img);
        expect(button).not.toBeNull();
        expect(button.getAttribute("aria-label")).toEqual("Edit handwritten card");
        expect(img.parentElement.classList.contains("sr-pencil-host")).toBe(true);
        expect(applyVersion).toHaveBeenCalledWith(img);

        // Processing the same image again adds no second button
        postProcess(section);
        expect(img.parentElement.querySelectorAll(".sr-pencil-button")).toHaveLength(1);
    });

    test("other images get no button", () => {
        const section = document.body.createDiv();
        const photo = embed("app://vault/photo.png", section);
        const png = embed("app://vault/sr-ink/sr-ink-sketch.png", section);
        postProcess(section);

        expect(buttonOf(photo)).toBeNull();
        expect(buttonOf(png)).toBeNull();
    });

    test("ink images whose name doesn't follow the scheme get a button too", () => {
        // Renamed by hand or by Obsidian on a name collision; the editor opens them as ink too
        const section = document.body.createDiv();
        const renamed = embed("app://vault/sr-ink/sr-ink-sketch.svg", section);
        const collided = embed("app://vault/sr-ink-x-front%201.svg", section);
        postProcess(section);

        expect(buttonOf(renamed)).not.toBeNull();
        expect(buttonOf(collided)).not.toBeNull();
    });

    test("images inside the card editor get no button", () => {
        const modal = document.body.createDiv({ cls: "sr-card-editor-modal" });
        const img = embed(INK_SRC, modal);
        postProcess(modal);
        expect(buttonOf(img)).toBeNull();
    });

    test("an embed whose image is loaded after rendering gets its button then", async () => {
        const section = document.body.createDiv();
        const span = section.createSpan({ cls: "internal-embed image-embed" });
        span.setAttribute("src", "sr-ink/sr-ink-20261031-141502123-back.svg");
        postProcess(section);

        const img = span.createEl("img");
        img.setAttribute("src", INK_SRC);
        await mutations();
        expect(buttonOf(img)).not.toBeNull();
    });

    test("an embed waiting for its image stops being watched on destroy or once detached", async () => {
        const disconnect = jest.spyOn(MutationObserver.prototype, "disconnect");
        const pending = () => {
            const section = document.body.createDiv();
            const span = section.createSpan({ cls: "internal-embed image-embed" });
            span.setAttribute("src", "sr-ink/sr-ink-20261031-141502123-back.svg");
            postProcess(section);
            return { section, span };
        };

        const { section } = pending();
        section.remove();
        disconnect.mockClear();
        buttons.watchLivePreview();
        expect(disconnect).toHaveBeenCalledTimes(1);

        const { span } = pending();
        disconnect.mockClear();
        buttons.destroy();
        expect(disconnect).toHaveBeenCalledTimes(1);
        const img = span.createEl("img");
        img.setAttribute("src", INK_SRC);
        await mutations();
        expect(buttonOf(img)).toBeNull();
        disconnect.mockRestore();
    });

    test("an unresolved embed (missing file) is not watched", () => {
        const observe = jest.spyOn(MutationObserver.prototype, "observe");
        const section = document.body.createDiv();
        const span = section.createSpan({ cls: "internal-embed is-unresolved" });
        span.setAttribute("src", "sr-ink/sr-ink-20261031-141502123-back.svg");
        postProcess(section);
        expect(observe).not.toHaveBeenCalled();
        observe.mockRestore();
    });

    test("destroy removes the buttons in detached sections too", () => {
        const section = document.body.createDiv();
        const img = embed(INK_SRC, section);
        postProcess(section);
        // Out of view, then put back by reading view after the plugin was reloaded
        section.remove();
        buttons.destroy();
        expect(buttonOf(img)).toBeNull();
        expect(img.parentElement.classList.contains("sr-pencil-host")).toBe(false);
    });

    test("a button left by an earlier instance is replaced by a working one", () => {
        const section = document.body.createDiv();
        const img = embed(INK_SRC, section);
        img.parentElement.createEl("button", { cls: "sr-pencil-button" });
        postProcess(section);

        const all = img.parentElement.querySelectorAll(".sr-pencil-button");
        expect(all).toHaveLength(1);
        tap(all[0] as HTMLElement);
        expect(editInNote).toHaveBeenCalledWith(note, inkFile);

        // The old instance survives in a detached section; the new one takes the image over
        const reloaded = new PencilButtons(app, actions);
        section.remove();
        buttons.destroy();
        img.parentElement.createEl("button", { cls: "sr-pencil-button" });
        document.body.appendChild(section);
        reloaded.postProcess(section, { sourcePath: note.path } as MarkdownPostProcessorContext);
        expect(img.parentElement.querySelectorAll(".sr-pencil-button")).toHaveLength(1);
        editInNote.mockClear();
        tap(buttonOf(img));
        expect(editInNote).toHaveBeenCalledTimes(1);
        reloaded.destroy();
    });

    test("destroy removes the buttons and the boxes", () => {
        const section = document.body.createDiv();
        const img = embed(INK_SRC, section);
        postProcess(section);
        buttons.destroy();

        expect(buttonOf(img)).toBeNull();
        expect(img.parentElement.classList.contains("sr-pencil-host")).toBe(false);
    });
});

describe("tapping the pencil", () => {
    let img: HTMLImageElement;
    let parentListener: jest.Mock;

    beforeEach(() => {
        const section = document.body.createDiv();
        parentListener = jest.fn();
        ["touchstart", "mousedown", "mouseup", "pointerdown", "pointerup", "click"].forEach(
            (type) => section.addEventListener(type, parentListener),
        );
        img = embed(INK_SRC, section);
        postProcess(section);
    });

    test("a tap opens the card of the note once, and no part of it reaches the page", () => {
        const events = tap(buttonOf(img));

        expect(editInNote).toHaveBeenCalledTimes(1);
        expect(editInNote).toHaveBeenCalledWith(note, inkFile);
        expect(editInReview).not.toHaveBeenCalled();
        expect(events.every((e) => e.defaultPrevented)).toBe(true);
        expect(parentListener).not.toHaveBeenCalled();
    });

    test("touch events are swallowed too", () => {
        const e = new Event("touchstart", { bubbles: true, cancelable: true });
        buttonOf(img).dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
        expect(parentListener).not.toHaveBeenCalled();
    });

    test("a pointer released without being pressed on the button, or cancelled, opens nothing", () => {
        const button = buttonOf(img);
        fire(button, "pointerup");
        fire(button, "pointerdown");
        fire(button, "pointercancel");
        fire(button, "pointerup");
        expect(editInNote).not.toHaveBeenCalled();
    });

    test("a drag that starts on the button is not a tap", () => {
        const button = buttonOf(img);
        fire(button, "pointerdown", { clientX: 10, clientY: 100 });
        fire(button, "pointerup", { clientX: 12, clientY: 40 });
        expect(editInNote).not.toHaveBeenCalled();

        // A little jitter is still a tap
        fire(button, "pointerdown", { clientX: 10, clientY: 100 });
        fire(button, "pointerup", { clientX: 14, clientY: 104 });
        expect(editInNote).toHaveBeenCalledTimes(1);
    });

    test("a button left behind after destroy opens nothing", () => {
        const button = buttonOf(img);
        img.parentElement.remove();
        buttons.destroy();
        tap(button);
        expect(editInNote).not.toHaveBeenCalled();
    });

    test("Enter or Space (a click without pointer events) opens the card", () => {
        fire(buttonOf(img), "click", { detail: 0 });
        expect(editInNote).toHaveBeenCalledWith(note, inkFile);
    });

    test("the card is looked up by the file the image shows, in the note's folder", () => {
        tap(buttonOf(img));
        expect(imageFile).toHaveBeenCalledWith(img, note.path);
    });

    test("an image whose file can't be told gets a notice", () => {
        imageFile.mockReturnValue(null);
        tap(buttonOf(img));
        expect(editInNote).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith("This image is not part of any card in this note.");
    });

    test("nothing opens when the note can't be found", () => {
        const section = document.body.createDiv();
        const other = embed(INK_SRC, section);
        postProcess(section, otherNote.path);
        tap(buttonOf(other));
        expect(editInNote).not.toHaveBeenCalled();
    });
});

test("in the review window the pencil edits the card under review", () => {
    const view = document.body.createDiv({ cls: "sr-view" });
    const card = view.createDiv();
    const img = embed(INK_SRC, card);
    postProcess(card);

    tap(buttonOf(img));
    expect(editInReview).toHaveBeenCalledTimes(1);
    expect(editInNote).not.toHaveBeenCalled();
});

describe("live preview", () => {
    let sourceView: HTMLElement;
    let readingView: HTMLElement;
    let file: TFile | null;

    beforeEach(() => {
        const containerEl = document.body.createDiv({ cls: "workspace-leaf-content" });
        sourceView = containerEl.createDiv({ cls: "markdown-source-view" });
        readingView = containerEl.createDiv({ cls: "markdown-reading-view" });
        file = note;
        const view = {
            containerEl,
            get file() {
                return file;
            },
        };
        leaves = [{ view }];
    });

    test("images already in the editor and added later get a button", async () => {
        const existing = embed(INK_SRC, sourceView);
        buttons.watchLivePreview();
        expect(buttonOf(existing)).not.toBeNull();

        const line = document.createElement("div");
        const added = embed(INK_SRC, line);
        sourceView.appendChild(line);
        await mutations();
        expect(buttonOf(added)).not.toBeNull();

        // The image of an embed is often given its src after it was added
        const late = embed("", sourceView);
        await mutations();
        late.setAttribute("src", INK_SRC);
        await mutations();
        expect(buttonOf(late)).not.toBeNull();
    });

    test("the pencil edits the card of the note the editor shows at the time of the tap", async () => {
        buttons.watchLivePreview();
        const img = embed(INK_SRC, sourceView);
        await mutations();

        file = otherNote;
        tap(buttonOf(img));
        expect(editInNote).toHaveBeenCalledWith(otherNote, inkFile);
    });

    test("only the live preview is watched; embedded notes are left to the post-processor", async () => {
        buttons.watchLivePreview();
        const inReading = embed(INK_SRC, readingView);
        const transclusion = sourceView.createDiv({ cls: "internal-embed markdown-embed" });
        const inEmbeddedNote = embed(INK_SRC, transclusion);
        await mutations();

        expect(buttonOf(inReading)).toBeNull();
        expect(buttonOf(inEmbeddedNote)).toBeNull();
    });

    test("images in a popout window (another window's classes) get a button", async () => {
        const frame = document.body.createEl("iframe");
        const popoutDoc = frame.contentDocument;
        // Obsidian adds its DOM helpers to popout windows too
        const popoutWindow = frame.contentWindow as unknown as typeof globalThis;
        for (const [ours, theirs] of [
            [Node.prototype, popoutWindow.Node.prototype],
            [HTMLElement.prototype, popoutWindow.HTMLElement.prototype],
        ]) {
            for (const key of Object.getOwnPropertyNames(ours)) {
                if (!(key in theirs))
                    Object.defineProperty(theirs, key, Object.getOwnPropertyDescriptor(ours, key));
            }
        }
        const popoutView = popoutDoc.body.appendChild(popoutDoc.createElement("div"));
        popoutView.className = "markdown-source-view";
        leaves = [{ view: { containerEl: popoutDoc.body, file: note } }];
        buttons.watchLivePreview();

        const span = popoutDoc.createElement("span");
        const img = span.appendChild(popoutDoc.createElement("img"));
        img.setAttribute("src", INK_SRC);
        popoutView.appendChild(span);
        await mutations();
        expect(img instanceof HTMLElement).toBe(false);
        expect(span.querySelector(".sr-pencil-button")).not.toBeNull();
    });

    test("a section scrolled out of view keeps being tracked, so destroy cleans it", () => {
        const section = document.body.createDiv();
        const img = embed(INK_SRC, section);
        postProcess(section);
        section.remove();
        buttons.watchLivePreview();
        document.body.appendChild(section);

        buttons.destroy();
        expect(buttonOf(img)).toBeNull();
    });

    test("an editor is watched only once, and not after destroy", async () => {
        buttons.watchLivePreview();
        buttons.watchLivePreview();
        const img = embed(INK_SRC, sourceView);
        await mutations();
        expect(img.parentElement.querySelectorAll(".sr-pencil-button")).toHaveLength(1);

        buttons.destroy();
        const after = embed(INK_SRC, sourceView);
        await mutations();
        expect(buttonOf(after)).toBeNull();
    });
});
