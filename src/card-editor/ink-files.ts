import { App, normalizePath, TFile, TFolder } from "obsidian";

import { INK_FILE_PREFIX, linksIn } from "src/card-editor/core/card-text";
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

    /** How many links and embeds in the text of the note at sourcePath resolve to the file */
    linksTo(file: TFile, text: string, sourcePath: string): number {
        return linksIn(text).filter(
            (link) => this.resolve(link.path, sourcePath)?.path === file.path,
        ).length;
    }

    /**
     * Whether a note or canvas in the vault still refers to the file: a link or embed resolving to
     * it, or its name anywhere else (e.g. in an HTML <img> or a canvas file node). Reads the files
     * themselves, as Obsidian's link index may lag behind. The note at sourcePath was just written,
     * so it is read from disk. Resolves to true when unsure, e.g. when a file can't be read.
     */
    async isReferenced(file: TFile, sourcePath: string): Promise<boolean> {
        const vault = this.app.vault;
        try {
            for (const other of vault.getFiles()) {
                if (other.extension !== "md" && other.extension !== "canvas") continue;
                const text =
                    other.path === sourcePath
                        ? await vault.read(other)
                        : await vault.cachedRead(other);
                if (this.refersTo(text, other.path, file)) return true;
            }
            return false;
        } catch (err) {
            console.error("SR: looking for links to the ink image failed", err);
            return true;
        }
    }

    /** Whether the text of the file at sourcePath refers to the file (see isReferenced) */
    private refersTo(text: string, sourcePath: string, file: TFile): boolean {
        const names = [file.name, encodeURI(file.name), encodeURIComponent(file.name)].map((n) =>
            n.toLowerCase(),
        );
        const mentions = (s: string) => {
            const lower = s.toLowerCase();
            return names.some((name) => lower.includes(name));
        };
        if (!mentions(text)) return false;

        // Links to files of the same name in other folders don't count
        let rest = text;
        for (const link of linksIn(text)) {
            if (!mentions(link.match)) continue;
            if (this.resolve(link.path, sourcePath)?.path === file.path) return true;
            rest = rest.replace(link.match, "");
        }
        return mentions(rest);
    }

    /**
     * The ink file an <img> shows, or null. The link path of its embed is resolved against the note
     * at sourcePath; without one, the file is found by the image's src.
     */
    imageFile(img: HTMLImageElement, sourcePath: string): TFile | null {
        const name = imageFileName(img);
        if (name === null) return null;
        const link = img.closest(".internal-embed")?.getAttribute("src");
        if (link) {
            const file = this.resolve(link.split(/[|#]/)[0], sourcePath);
            // Not the embed of a note around the image (a transclusion)
            if (file?.name === name) return file;
        }

        const src = withoutQuery(img.getAttribute("src") ?? "");
        const vault = this.app.vault;
        const sameName = vault.getFiles().filter((file) => file.name === name);
        return (
            sameName.find((file) => withoutQuery(vault.getResourcePath(file)) === src) ??
            (sameName.length === 1 ? sameName[0] : null)
        );
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
