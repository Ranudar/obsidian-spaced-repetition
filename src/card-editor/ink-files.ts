import { App, normalizePath, TFile, TFolder } from "obsidian";

import { INK_FILE_PREFIX } from "src/card-editor/core/card-text";
import { t } from "src/lang/helpers";

/** Query parameter added to the src of images rewritten in this session */
const VERSION_PARAM = "sr-ink";
const INK_IMAGE_SELECTOR = `img[src*="${INK_FILE_PREFIX}"]`;

/**
 * Reads and writes the SVG files of handwritten card sides,
 * and reloads images showing a file that was rewritten.
 */
export class InkFiles {
    private app: App;
    private imageFolder: () => string;
    /**
     * Ink images rewritten in this session (by resource path without query) → cache-busting value,
     * so every copy shows the new ink
     */
    private versions = new Map<string, number>();

    /** imageFolder: the configured folder; empty means Obsidian's attachment folder */
    constructor(app: App, imageFolder: () => string) {
        this.app = app;
        this.imageFolder = imageFolder;
    }

    /**
     * The file a link path (e.g. from an embed) in the note at sourcePath links to, or null.
     * A bare file name finds a file of that name anywhere in the vault.
     */
    resolve(linkPath: string, sourcePath: string): TFile | null {
        return this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    }

    async read(file: TFile): Promise<string> {
        return this.app.vault.read(file);
    }

    /** Creates a new ink file for the note at sourcePath */
    async create(name: string, svg: string, sourcePath: string): Promise<TFile> {
        const folder = this.imageFolder().trim();
        let path: string;
        if (folder) {
            const dir = await this.ensureFolder(normalizePath(folder));
            path = normalizePath(`${dir}/${name}`);
        } else {
            path = await this.app.fileManager.getAvailablePathForAttachment(name, sourcePath);
        }
        return this.app.vault.create(path, svg);
    }

    /**
     * The path of the folder, created if missing. A folder that exists with another letter case
     * (on a case-insensitive file system) is used as it is.
     */
    private async ensureFolder(dir: string): Promise<string> {
        const vault = this.app.vault;
        const exact = vault.getAbstractFileByPath(dir);
        if (exact instanceof TFolder) return exact.path;
        if (exact !== null) throw new Error(t("CARD_EDITOR_IMAGE_FOLDER_IS_FILE", { path: dir }));

        const lower = dir.toLowerCase();
        const sameName = vault
            .getAllLoadedFiles()
            .find((f) => f.path.toLowerCase() === lower && f instanceof TFolder);
        if (sameName) return sameName.path;
        await vault.createFolder(dir);
        return dir;
    }

    /** Same file, same name: the card text stays unchanged */
    async overwrite(file: TFile, svg: string): Promise<void> {
        await this.app.vault.modify(file, svg);
    }

    /** Moves the file to the trash the user chose in Obsidian's settings */
    async trash(file: TFile): Promise<void> {
        await this.app.fileManager.trashFile(file);
    }

    /** How many links and embeds in all notes point to the file, as Obsidian's link index has it */
    linkCount(file: TFile): number {
        const links = this.app.metadataCache.resolvedLinks ?? {};
        let count = 0;
        for (const targets of Object.values(links)) count += targets[file.path] ?? 0;
        return count;
    }

    /** Link text for an embed of the file in the note at sourcePath */
    linkPath(file: TFile, sourcePath: string): string {
        return this.app.metadataCache.fileToLinktext(file, sourcePath, false);
    }

    /**
     * Reloads every image showing one of the files, in every window,
     * and remembers the files so images rendered later in the session can be updated too.
     */
    refresh(files: TFile[]): void {
        const documents = this.openDocuments();
        for (const file of files) {
            const version = Date.now();
            const src = this.app.vault.getResourcePath(file);
            const key = withoutQuery(src);
            this.versions.set(key, version);
            for (const doc of documents) {
                doc.querySelectorAll<HTMLImageElement>(INK_IMAGE_SELECTOR).forEach((img) => {
                    if (imageKey(img) === key) img.src = withVersion(src, version);
                });
            }
        }
    }

    /** Loads the latest version of an ink image rendered after its file was rewritten */
    applyVersion(img: HTMLImageElement): void {
        const key = imageKey(img);
        if (key === null) return;
        const version = this.versions.get(key);
        const src = img.getAttribute("src") ?? "";
        if (version !== undefined && !src.includes(`${VERSION_PARAM}=${version}`)) {
            img.src = withVersion(src, version);
        }
    }

    /** The documents of the main window and of every popout window */
    private openDocuments(): Document[] {
        const documents = new Set<Document>([activeDocument]);
        this.app.workspace.iterateAllLeaves((leaf) => {
            const doc = leaf.view?.containerEl?.ownerDocument;
            if (doc) documents.add(doc);
        });
        return [...documents];
    }
}

/** The src of an ink image without query and hash (which file it shows), or null for other images */
function imageKey(img: HTMLImageElement): string | null {
    const src = img.getAttribute("src");
    if (!src || !src.includes(INK_FILE_PREFIX)) return null;
    return withoutQuery(src);
}

function withoutQuery(src: string): string {
    return src.split(/[?#]/)[0];
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
