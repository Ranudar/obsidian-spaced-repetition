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

// Obsidian's globals for the active window, used instead of window/document in src/
globalThis.activeWindow = window;
globalThis.activeDocument = document;

class Modal {
    constructor(app) {
        this.app = app;
        this.modalEl = document.createElement("div");
        this.contentEl = this.modalEl.createDiv();
    }
    open() {
        this.onOpen();
    }
    close() {
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
    Modal,
    ButtonComponent,
};
