/* eslint-disable no-undef */
/* eslint-disable getter-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */

// Minimal stand-ins for the DOM helpers Obsidian adds to HTMLElement, so UI classes can be unit tested
Object.assign(HTMLElement.prototype, {
    createEl(tag, o) {
        const el = document.createElement(tag);
        if (o?.cls) el.className = [].concat(o.cls).join(" ");
        if (o?.text) el.textContent = o.text;
        this.appendChild(el);
        return el;
    },
    createDiv(o) {
        return this.createEl("div", o);
    },
    createSpan(o) {
        return this.createEl("span", o);
    },
    addClass(...cls) {
        this.classList.add(...cls);
    },
    addClasses(cls) {
        this.classList.add(...cls);
    },
    removeClass(...cls) {
        this.classList.remove(...cls);
    },
    toggleClass(cls, value) {
        [].concat(cls).forEach((c) => this.classList.toggle(c, value));
    },
    hasClass(cls) {
        return this.classList.contains(cls);
    },
    setAttr(name, value) {
        if (value === null) this.removeAttribute(name);
        else this.setAttribute(name, String(value));
    },
    setCssProps(props) {
        Object.entries(props).forEach(([k, v]) => this.style.setProperty(k, v));
    },
    setText(text) {
        this.textContent = text;
    },
    empty() {
        this.replaceChildren();
    },
});

// Obsidian's cross-window instanceof: a node of a popout window has that window's classes
Node.prototype.instanceOf = function (type) {
    const own = this.ownerDocument?.defaultView?.[type.name];
    return this instanceof type || (typeof own === "function" && this instanceof own);
};

// Obsidian's globals for the active window, used instead of window/document in src/
globalThis.activeWindow = window;
globalThis.activeDocument = document;

class Modal {
    constructor(app) {
        this.app = app;
        // Same structure as Obsidian: container > background + modal > close button + content
        this.containerEl = document.createElement("div");
        this.containerEl.createDiv({ cls: "modal-bg" });
        this.modalEl = this.containerEl.createDiv({ cls: "modal" });
        this.modalEl.createDiv({ cls: "modal-close-button" });
        this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
    }
    open() {
        document.body.appendChild(this.containerEl);
        this.onOpen();
    }
    close() {
        this.containerEl.remove();
        this.onClose();
    }
    onOpen() {}
    onClose() {}
}

class ButtonComponent {
    constructor(containerEl) {
        this.buttonEl = containerEl.createEl("button");
    }
    setClass(cls) {
        this.buttonEl.addClass(cls);
        return this;
    }
    setButtonText(text) {
        this.buttonEl.setText(text);
        return this;
    }
    setDisabled(disabled) {
        this.buttonEl.disabled = disabled;
        return this;
    }
    onClick(callback) {
        this.buttonEl.addEventListener("click", callback);
        return this;
    }
}

// A menu records its items; Menu.last is the menu shown last, so a test can pick an item
class MenuItem {
    title = "";
    checked = false;
    callback = null;
    setTitle(title) {
        this.title = title;
        return this;
    }
    setChecked(checked) {
        this.checked = checked;
        return this;
    }
    setIcon() {
        return this;
    }
    onClick(callback) {
        this.callback = callback;
        return this;
    }
    click() {
        this.callback?.();
    }
}

class Menu {
    static last = null;
    items = [];
    addItem(fn) {
        const item = new MenuItem();
        fn(item);
        this.items.push(item);
        return this;
    }
    showAtPosition() {
        Menu.last = this;
    }
    showAtMouseEvent() {
        Menu.last = this;
    }
}

class Component {
    loaded = false;
    load() {
        this.loaded = true;
    }
    unload() {
        this.loaded = false;
    }
}

// Renders the markdown as plain text
const MarkdownRenderer = {
    render: jest.fn((app, markdown, el) => {
        el.createDiv({ cls: "rendered", text: markdown });
        return Promise.resolve();
    }),
};

class TFile {}
class TFolder {}
class MarkdownView {}

module.exports = {
    moment: {
        locale: jest.fn(() => "en"),
    },
    PluginSettingTab: jest.fn().mockImplementation(),
    Platform: {
        get isMobile() {
            jest.fn(() => false);
        },
    },

    Notice: jest.fn().mockImplementation(),
    normalizePath: (path) =>
        path
            .replace(/[\\/]+/g, "/")
            .replace(/^\/|\/$/g, "")
            .trim(),
    setIcon: jest.fn(),
    Modal,
    ButtonComponent,
    Menu,
    Component,
    MarkdownRenderer,
    TFile,
    TFolder,
    MarkdownView,
};
