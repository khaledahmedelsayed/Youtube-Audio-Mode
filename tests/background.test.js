const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

/**
 * Run background.js in a vm with a recording chrome API.
 * @param {object} syncStorage Values chrome.storage.sync.get returns
 * @returns {{calls: Array, change: function(object): void, timers: Array}}
 */
function loadBackground(syncStorage = {}) {
    const calls = [];
    const changeListeners = [];
    const timers = [];
    const record = name => details => calls.push([name, details]);
    const context = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: fn => timers.push(fn),
        clearTimeout() {},
        chrome: {
            runtime: { onInstalled: { addListener() {} } },
            storage: {
                sync: {
                    get: (keys, callback) => callback({ ...syncStorage }),
                    getBytesInUse: (_keys, callback) => callback(0)
                },
                onChanged: { addListener: fn => changeListeners.push(fn) }
            },
            action: {
                setBadgeText: record('text'),
                setBadgeBackgroundColor: record('background'),
                setBadgeTextColor: record('textColor')
            }
        }
    };
    context.importScripts = (...files) => files.forEach(file => {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    });
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context, { filename: 'background.js' });
    const change = changes => changeListeners.forEach(fn => fn(changes, 'sync'));
    return { calls, change, timers, context };
}

const last = (calls, name) => calls.filter(call => call[0] === name).pop()?.[1];

test('badge uses the stored accent and its ink', () => {
    const { calls, context } = loadBackground({ audioModeType: 'always', accentColor: 'mint' });
    const mint = context.Earmode.accentPreset('mint');
    assert.equal(last(calls, 'text').text, 'A');
    assert.equal(last(calls, 'background').color, mint.color);
    assert.equal(last(calls, 'textColor').color, mint.ink);
});

test('badge falls back to sunflower', () => {
    const { calls } = loadBackground({ audioModeType: 'filtered' });
    assert.equal(last(calls, 'background').color, '#F2C14E');
    assert.equal(last(calls, 'textColor').color, '#1C1B22');
});

test('badge recolors when accentColor changes', () => {
    const { calls, change, context } = loadBackground({ audioModeType: 'always' });
    change({ accentColor: { newValue: 'coral' } });
    assert.equal(last(calls, 'background').color, context.Earmode.accentPreset('coral').color);
    change({ accentColor: { newValue: 'bogus' } });
    assert.equal(last(calls, 'background').color, '#F2C14E');
});
