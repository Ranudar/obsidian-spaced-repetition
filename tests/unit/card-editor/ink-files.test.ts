import { App, TFile, TFolder } from "obsidian";

import { imageFileName, InkFiles, withVersion } from "src/card-editor/ink-files";

const file = (path: string) =>
    ({ path, name: path.substring(path.lastIndexOf("/") + 1) }) as unknown as TFile;

/** Documents of popout windows, as the leaves shown in them report */
let popouts: Document[];

function inkFiles(): InkFiles {
    const app = {
        vault: { getResourcePath: (f: TFile) => `app://vault/${encodeURI(f.path)}?100` },
        workspace: {
            iterateAllLeaves: (fn: (leaf: unknown) => void) =>
                [document, ...popouts].forEach((doc) =>
                    fn({ view: { containerEl: doc.createElement("div") } }),
                ),
        },
    } as unknown as App;
    return new InkFiles(app, () => "pencards");
}

beforeEach(() => {
    popouts = [];
});

function image(src: string): HTMLImageElement {
    const img = document.body.createEl("img");
    img.setAttribute("src", src);
    return img;
}

afterEach(() => {
    document.body.replaceChildren();
    jest.useRealTimers();
});

describe("imageFileName", () => {
    test("returns the decoded file name of ink images only", () => {
        expect(imageFileName(image("app://vault/ink%20cards/pencard-a-front.svg?123"))).toEqual(
            "pencard-a-front.svg",
        );
        expect(imageFileName(image("app://vault/pencards/pencard-%E2%9C%8E-back.svg"))).toEqual(
            "pencard-✎-back.svg",
        );
        expect(imageFileName(image("app://vault/photo.png"))).toBeNull();
        expect(imageFileName(document.body.createEl("img"))).toBeNull();
    });
});

describe("withVersion", () => {
    test("adds the version query, replacing an earlier one", () => {
        expect(withVersion("a.svg", 1)).toEqual("a.svg?sr-ink=1");
        expect(withVersion("a.svg?100", 2)).toEqual("a.svg?100&sr-ink=2");
        expect(withVersion("a.svg?100&sr-ink=2", 3)).toEqual("a.svg?100&sr-ink=3");
        expect(withVersion("a.svg?sr-ink=2", 3)).toEqual("a.svg?sr-ink=3");
    });
});

describe("InkFiles.refresh", () => {
    test("reloads every image showing a rewritten file and nothing else", () => {
        jest.useFakeTimers().setSystemTime(5000);
        const files = inkFiles();
        const a1 = image("app://vault/pencards/pencard-a-front.svg?100");
        const a2 = image("app://vault/pencards/pencard-a-front.svg?100&sr-ink=1");
        const b = image("app://vault/pencards/pencard-a-back.svg?100");

        files.refresh([file("pencards/pencard-a-front.svg")]);

        const expected = "app://vault/pencards/pencard-a-front.svg?100&sr-ink=5000";
        expect(a1.getAttribute("src")).toEqual(expected);
        expect(a2.getAttribute("src")).toEqual(expected);
        expect(b.getAttribute("src")).toEqual("app://vault/pencards/pencard-a-back.svg?100");
    });

    test("images of a same-named file in another folder are left alone", () => {
        jest.useFakeTimers().setSystemTime(5000);
        const other = image("app://vault/archive/pencard-a-front.svg?100");
        inkFiles().refresh([file("pencards/pencard-a-front.svg")]);
        expect(other.getAttribute("src")).toEqual("app://vault/archive/pencard-a-front.svg?100");
    });

    test("images in popout windows are reloaded too", () => {
        jest.useFakeTimers().setSystemTime(6000);
        const popout = document.implementation.createHTMLDocument("popout");
        popouts.push(popout);
        const img = popout.createElement("img");
        img.setAttribute("src", "app://vault/pencards/pencard-a-front.svg?100");
        popout.body.appendChild(img);

        inkFiles().refresh([file("pencards/pencard-a-front.svg")]);
        expect(img.getAttribute("src")).toEqual(
            "app://vault/pencards/pencard-a-front.svg?100&sr-ink=6000",
        );
    });

    test("images rendered later in the session get the latest version", () => {
        jest.useFakeTimers().setSystemTime(7000);
        const files = inkFiles();
        files.refresh([file("pencards/pencard-a-front.svg")]);

        const later = image("app://vault/pencards/pencard-a-front.svg?200");
        files.applyVersion(later);
        expect(later.getAttribute("src")).toEqual(
            "app://vault/pencards/pencard-a-front.svg?200&sr-ink=7000",
        );

        const other = image("app://vault/pencards/pencard-b-front.svg?200");
        files.applyVersion(other);
        expect(other.getAttribute("src")).toEqual("app://vault/pencards/pencard-b-front.svg?200");
    });
});

describe("InkFiles.create", () => {
    const folder = (path: string) => Object.assign(new TFolder(), { path });

    function setup(existing: (TFolder | TFile)[]) {
        const vault = {
            getAbstractFileByPath: jest.fn(
                (path: string) => existing.find((f) => f.path === path) ?? null,
            ),
            getAllLoadedFiles: () => existing,
            createFolder: jest.fn(() => Promise.resolve()),
            create: jest.fn((path: string) => Promise.resolve(file(path))),
        };
        const app = { vault } as unknown as App;
        return { vault, files: new InkFiles(app, () => "Pencards") };
    }

    test("creates the image folder if it is missing", async () => {
        const { vault, files } = setup([]);
        await files.create("pencard-a-front.svg", "<svg/>", "note.md");
        expect(vault.createFolder).toHaveBeenCalledWith("Pencards");
        expect(vault.create).toHaveBeenCalledWith("Pencards/pencard-a-front.svg", "<svg/>");
    });

    test("uses a folder that exists with another letter case", async () => {
        const { vault, files } = setup([folder("pencards")]);
        await files.create("pencard-a-front.svg", "<svg/>", "note.md");
        expect(vault.createFolder).not.toHaveBeenCalled();
        expect(vault.create).toHaveBeenCalledWith("pencards/pencard-a-front.svg", "<svg/>");
    });

    test("an image folder path that is a file gives a clear error", async () => {
        const { vault, files } = setup([Object.assign(new TFile(), { path: "Pencards" })]);
        await expect(files.create("pencard-a-front.svg", "<svg/>", "note.md")).rejects.toThrow(
            "The image folder Pencards is a file.",
        );
        expect(vault.create).not.toHaveBeenCalled();
    });
});
