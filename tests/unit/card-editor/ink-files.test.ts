import { App, TFile } from "obsidian";

import { imageFileName, InkFiles, withVersion } from "src/card-editor/ink-files";

const file = (path: string) =>
    ({ path, name: path.substring(path.lastIndexOf("/") + 1) }) as unknown as TFile;

function inkFiles(): InkFiles {
    const app = {
        vault: { getResourcePath: (f: TFile) => `app://vault/${encodeURI(f.path)}?100` },
    } as unknown as App;
    return new InkFiles(app, () => "pencards");
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
