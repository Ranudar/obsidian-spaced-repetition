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
    test("rendered ink images get a pencil, other images and images in the card editor don't", () => {
        const section = document.body.createDiv();
        const img = embed(INK_SRC, section);
        const photo = embed("app://vault/photo.png", section);
        const modal = document.body.createDiv({ cls: "sr-card-editor-modal" });
        const inEditor = embed(INK_SRC, modal);
        postProcess(section);
        postProcess(modal);

        expect(buttonOf(img)).not.toBeNull();
        expect(applyVersion).toHaveBeenCalledWith(img);
        expect(buttonOf(photo)).toBeNull();
        expect(buttonOf(inEditor)).toBeNull();

        // Processing the same image again adds no second button
        postProcess(section);
        expect(img.parentElement.querySelectorAll(".sr-pencil-button")).toHaveLength(1);
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

    test("destroy removes the buttons and the boxes, in detached sections too", () => {
        const section = document.body.createDiv();
        const img = embed(INK_SRC, section);
        postProcess(section);
        // Out of view, then put back by reading view after the plugin was reloaded
        section.remove();
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
        expect(imageFile).toHaveBeenCalledWith(img, note.path);
        expect(editInReview).not.toHaveBeenCalled();
        expect(events.every((e) => e.defaultPrevented)).toBe(true);
        expect(parentListener).not.toHaveBeenCalled();
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

    test("an image whose file can't be told opens nothing", () => {
        imageFile.mockReturnValue(null);
        tap(buttonOf(img));
        expect(editInNote).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalled();
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
});
