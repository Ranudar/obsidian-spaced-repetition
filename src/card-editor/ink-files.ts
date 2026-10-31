import { App, normalizePath, TFile } from "obsidian";

import { INK_FILE_PREFIX } from "src/card-editor/core/card-text";

/** Query parameter added to the src of images rewritten in this session */
const VERSION_PARAM = "sr-ink";

/**
 * Reads and writes the SVG files of handwritten card sides,
 * and reloads images showing a file that was rewritten.
 */
export class InkFiles {
    private app: App;
    private imageFolder: () => string;
    /** Ink images rewritten in this session → cache-busting value, so every copy shows the new ink */
    private versions = new Map<string, number>();

    /** imageFolder: the configured folder; empty means Obsidian's attachment folder */
    constructor(app: App, imageFolder: () => string) {
        this.app = app;
        this.imageFolder = imageFolder;
    }

    /** The ink file an embed in the note at sourcePath links to, or null if there is none */
    resolve(name: string, sourcePath: string): TFile | null {
        return this.app.metadataCache.getFirstLinkpathDest(name, sourcePath);
    }

    async read(file: TFile): Promise<string> {
        return this.app.vault.read(file);
    }

    /** Creates a new ink file for the note at sourcePath */
    async create(name: string, svg: string, sourcePath: string): Promise<TFile> {
        const folder = this.imageFolder().trim();
        let path: string;
        if (folder) {
            const dir = normalizePath(folder);
            if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
            path = normalizePath(`${dir}/${name}`);
        } else {
            path = await this.app.fileManager.getAvailablePathForAttachment(name, sourcePath);
        }
        return this.app.vault.create(path, svg);
    }

    /** Same file, same name: the card text stays unchanged */
    async overwrite(file: TFile, svg: string): Promise<void> {
        await this.app.vault.modify(file, svg);
    }

    /** Moves the file to the trash the user chose in Obsidian's settings */
    async trash(file: TFile): Promise<void> {
        await this.app.fileManager.trashFile(file);
    }

    /** Link text for an embed of the file in the note at sourcePath */
    linkPath(file: TFile, sourcePath: string): string {
        return this.app.metadataCache.fileToLinktext(file, sourcePath, false);
    }

    /**
     * Reloads every image showing one of the files,
     * and remembers the files so images rendered later in the session can be updated too.
     */
    refresh(files: TFile[]): void {
        for (const file of files) {
            const version = Date.now();
            this.versions.set(file.name, version);
            const src = this.app.vault.getResourcePath(file);
            activeDocument
                .querySelectorAll<HTMLImageElement>(`img[src*="${INK_FILE_PREFIX}"]`)
                .forEach((img) => {
                    if (imageFileName(img) === file.name) img.src = withVersion(src, version);
                });
        }
    }

    /** Loads the latest version of an ink image rendered after its file was rewritten */
    applyVersion(img: HTMLImageElement): void {
        const name = imageFileName(img);
        if (name === null) return;
        const version = this.versions.get(name);
        const src = img.getAttribute("src") ?? "";
        if (version !== undefined && !src.includes(`${VERSION_PARAM}=${version}`)) {
            img.src = withVersion(src, version);
        }
    }
}

/** File name of the ink image an <img> shows, or null for other images */
export function imageFileName(img: HTMLImageElement): string | null {
    const src = img.getAttribute("src");
    if (!src || !src.includes(INK_FILE_PREFIX)) return null;
    const path = src.split(/[?#]/)[0];
    const name = path.substring(path.lastIndexOf("/") + 1);
    try {
        return decodeURIComponent(name);
    } catch {
        return name;
    }
}

/** src with the version query set (replacing an earlier one) */
export function withVersion(src: string, version: number): string {
    const clean = src
        .replace(new RegExp(`([?&])${VERSION_PARAM}=\\d+&?`), "$1")
        .replace(/[?&]$/, "");
    return `${clean}${clean.includes("?") ? "&" : "?"}${VERSION_PARAM}=${version}`;
}
