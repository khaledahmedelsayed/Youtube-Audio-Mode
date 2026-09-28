// Minimal DOM for vm tests: createElement, classes, styles, attributes, listeners, class queries.
// Setting innerHTML throws so tests catch any markup-string building.
class FakeElement {
    constructor(tagName, namespace = null) {
        this.tagName = tagName;
        this.namespace = namespace;
        this.children = [];
        this.parent = null;
        this.attributes = {};
        this.dataset = {};
        this.textContent = '';
        this.id = '';
        this.hidden = false;
        this.listeners = {};
        const props = {};
        this.style = {
            props,
            setProperty(name, value) {
                props[name] = value;
            },
            removeProperty(name) {
                delete props[name];
            }
        };
        const classes = new Set();
        this.classList = {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
            toggle: (name, force) => {
                const on = force === undefined ? !classes.has(name) : !!force;
                if (on) classes.add(name);
                else classes.delete(name);
                return on;
            }
        };
        this.classes = classes;
    }
    get className() {
        return [...this.classes].join(' ');
    }
    set className(value) {
        this.classes.clear();
        String(value).split(/\s+/).filter(Boolean).forEach(name => this.classes.add(name));
    }
    set innerHTML(_value) {
        throw new Error('innerHTML must not be used');
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === 'class') this.className = value;
    }
    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }
    removeAttribute(name) {
        delete this.attributes[name];
    }
    addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
    }
    removeEventListener(type, fn) {
        this.listeners[type] = (this.listeners[type] || []).filter(listener => listener !== fn);
    }
    /**
     * Call this element's listeners for `type`, then bubble to its parents until stopped.
     * @returns {object} The event object passed to listeners
     */
    dispatch(type, extra = {}) {
        const event = {
            type,
            target: this,
            stopped: false,
            defaultPrevented: false,
            stopPropagation() {
                this.stopped = true;
            },
            preventDefault() {
                this.defaultPrevented = true;
            },
            ...extra
        };
        for (let el = this; el && !event.stopped; el = el.parent) {
            (el.listeners[type] || []).forEach(fn => fn(event));
        }
        return event;
    }
    focus() {
        FakeElement.focused = this;
    }
    appendChild(child) {
        if (child.parent) child.remove();
        child.parent = this;
        this.children.push(child);
        return child;
    }
    append(...nodes) {
        nodes.forEach(node => this.appendChild(node));
    }
    remove() {
        if (this.parent) {
            this.parent.children = this.parent.children.filter(child => child !== this);
            this.parent = null;
        }
    }
    contains(node) {
        for (let el = node; el; el = el.parent) {
            if (el === this) return true;
        }
        return false;
    }
    *walk() {
        for (const child of this.children) {
            yield child;
            yield* child.walk();
        }
    }
    querySelectorAll(selector) {
        const name = selector.replace(/^\./, '');
        return [...this.walk()].filter(el => el.classes.has(name));
    }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
}

FakeElement.focused = null;

module.exports = { FakeElement };
