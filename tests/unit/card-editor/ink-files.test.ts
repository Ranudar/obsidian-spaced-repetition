import { App, TFile, TFolder } from "obsidian";

import { imageFileName, InkFiles } from "src/card-editor/ink-files";

const file = (path: string) =>
    ({ path, name: path.substring(path.lastIndexOf("/") + 1) }) as unknown as TFile;

function inkFiles(): InkFiles {
    const app = {
        vault: { getResourcePath: (f: TFile) => `app://vault/${encodeURI(f.path)}?100` },
        workspace: {
            iterateAllLeaves: (fn: (leaf: unknown) => void) =>
                fn({ view: { containerEl: document.createElement("div") } }),
        },
    } as unknown as App;
    return new InkFiles(app, () => "sr-ink");
}

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
        expect(imageFileName(image("app://vault/ink%20cards/sr-ink-a-front.svg?123"))).toEqual(
            "sr-ink-a-front.svg",
        );
        expect(imageFileName(image("app://vault/photo.png"))).toBeNull();
        expect(imageFileName(document.body.createEl("img"))).toBeNull();
    });
});

describe("InkFiles.refresh", () => {
    test("reloads every image showing a rewritten file and nothing else", () => {
        jest.useFakeTimers().setSystemTime(5000);
        const files = inkFiles();
        const a1 = image("app://vault/sr-ink/sr-ink-a-front.svg?100");
        const a2 = image("app://vault/sr-ink/sr-ink-a-front.svg?100&sr-ink=1");
        const b = image("app://vault/sr-ink/sr-ink-a-back.svg?100");
        const sameName = image("app://vault/archive/sr-ink-a-front.svg?100");

        files.refresh([file("sr-ink/sr-ink-a-front.svg")]);

        const expected = "app://vault/sr-ink/sr-ink-a-front.svg?100&sr-ink=5000";
        expect(a1.getAttribute("src")).toEqual(expected);
        expect(a2.getAttribute("src")).toEqual(expected);
        expect(b.getAttribute("src")).toEqual("app://vault/sr-ink/sr-ink-a-back.svg?100");
        expect(sameName.getAttribute("src")).toEqual("app://vault/archive/sr-ink-a-front.svg?100");
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
        return { vault, files: new InkFiles(app, () => "SR-Ink") };
    }

    test("creates the image folder if it is missing, or uses one with another letter case", async () => {
        const missing = setup([]);
        await missing.files.create("sr-ink-a-front.svg", "<svg/>", "note.md");
        expect(missing.vault.createFolder).toHaveBeenCalledWith("SR-Ink");
        expect(missing.vault.create).toHaveBeenCalledWith("SR-Ink/sr-ink-a-front.svg", "<svg/>");

        const { vault, files } = setup([folder("sr-ink")]);
        await files.create("sr-ink-a-front.svg", "<svg/>", "note.md");
        expect(vault.createFolder).not.toHaveBeenCalled();
        expect(vault.create).toHaveBeenCalledWith("sr-ink/sr-ink-a-front.svg", "<svg/>");
    });
});

describe("InkFiles.imageFile", () => {
    const ink = file("sr-ink/sr-ink-a-front.svg");
    const archived = file("archive/sr-ink-a-front.svg");

    function withFiles(files: TFile[]): InkFiles {
        const app = {
            vault: {
                getFiles: () => files,
                getResourcePath: (f: TFile) => `app://vault/${encodeURI(f.path)}?100`,
            },
            metadataCache: {
                getFirstLinkpathDest: (link: string) =>
                    files.find((f) => f.path === link || f.name === link) ?? null,
            },
        } as unknown as App;
        return new InkFiles(app, () => "sr-ink");
    }

    test("resolves the embed's link path, so a file of the same name elsewhere isn't it", () => {
        const span = document.body.createSpan({ cls: "internal-embed image-embed" });
        span.setAttribute("src", "archive/sr-ink-a-front.svg|200");
        const img = span.createEl("img");
        img.setAttribute("src", "app://vault/archive/sr-ink-a-front.svg?100");
        expect(withFiles([ink, archived]).imageFile(img, "notes/bio.md")).toBe(archived);
    });
});

describe("InkFiles.isReferenced", () => {
    const ink = file("sr-ink/sr-ink-a-front.svg");
    const archived = file("archive/sr-ink-a-front.svg");
    let texts: Record<string, string>;
    let read: jest.Mock;

    function inkFilesOf(): InkFiles {
        const all = () =>
            [ink, archived, ...Object.keys(texts).map(file)].map((f) =>
                Object.assign(f, { extension: f.name.substring(f.name.lastIndexOf(".") + 1) }),
            );
        read = jest.fn((f: TFile) => Promise.resolve(texts[f.path]));
        const app = {
            vault: {
                getFiles: all,
                read,
                cachedRead: (f: TFile) => Promise.resolve(texts[f.path]),
            },
            metadataCache: {
                getFirstLinkpathDest: (link: string) =>
                    [ink, archived].find((f) => f.path === link) ??
                    (link === ink.name ? ink : null),
            },
        } as unknown as App;
        return new InkFiles(app, () => "sr-ink");
    }

    test("links and embeds resolving to the file, or its name anywhere else, refer to it", async () => {
        for (const text of [
            "![[sr-ink/sr-ink-a-front.svg]]",
            "a link: [[sr-ink-a-front.svg|drawing]]",
            '<img src="sr-ink/sr-ink-a-front.svg">',
        ]) {
            texts = { "notes/a.md": text };
            await expect(inkFilesOf().isReferenced(ink, "notes/bio.md")).resolves.toBe(true);
        }
        texts = {
            "board.canvas": '{"nodes":[{"type":"file","file":"sr-ink/sr-ink-a-front.svg"}]}',
        };
        await expect(inkFilesOf().isReferenced(ink, "notes/bio.md")).resolves.toBe(true);
    });

    test("links to a file of the same name in another folder, and other files, don't", async () => {
        texts = {
            "notes/a.md": "![[archive/sr-ink-a-front.svg]] and ![[photo.png]]",
            "notes/b.md": "nothing",
            "data.json": "sr-ink/sr-ink-a-front.svg",
        };
        const files = inkFilesOf();
        await expect(files.isReferenced(ink, "notes/a.md")).resolves.toBe(false);
        // The note just written is read from disk
        expect(read).toHaveBeenCalledTimes(1);
        expect(files.linksTo(archived, texts["notes/a.md"], "notes/a.md")).toEqual(1);
        expect(files.linksTo(ink, texts["notes/a.md"], "notes/a.md")).toEqual(0);
    });

    test("unsure when a file can't be read", async () => {
        texts = { "notes/a.md": "x" };
        const files = inkFilesOf();
        read.mockRejectedValue(new Error("locked"));
        const error = jest.spyOn(console, "error").mockImplementation(() => {});
        await expect(files.isReferenced(ink, "notes/a.md")).resolves.toBe(true);
        error.mockRestore();
    });
});
