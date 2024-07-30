// ==UserScript==
// @name         ZZZ records auto-paste
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatically pastes and presses import on ZZZ warp tracker. Make sure to focus the page + allow clipboard perms on rng.moe.
// @author       You
// @match        https://*/*import
// @require      https://cdn.jsdelivr.net/npm/@violentmonkey/dom@2
// @downloadURL  https://raw.githubusercontent.com/nyakowint/theme-stuff/main/zzz_tracker_paste.js
// ==/UserScript==

const inputSelector = `input[placeholder*="URL here"]`;

async function getClipboardContents() {
    try {
        return await navigator.clipboard.readText();
    } catch (err) {
        console.error("Failed to read clipboard contents: ", err);
        return null;
    }
}

function isValidUrl(url) {
    const regex = /^https:\/\/([^.]+\.)?(hoyoverse\.com|mihoyo\.com)/;
    return regex.test(url);
}

async function findAndPasteURL(inputField) {
    const clipboardContents = await getClipboardContents();

    console.log(clipboardContents);
    if (clipboardContents && isValidUrl(clipboardContents)) {
        console.log("Found clipboard contents");
        // these probably dont work lol
        window.focus();
        inputField.focus();
        //
        inputField.value = clipboardContents;
        inputField.dispatchEvent(new Event("input", { bubbles: true }));
        inputField.nextElementSibling.click()
    }
}

function findAndClickImportButton() {
    const buttons = document.querySelectorAll('button');
    for (const button of buttons) {
        if (button.textContent.trim() === "Import") {
            button.click();
            break;
        }
    }
}

VM.observe(document.body, () => {
    const inputField = document.querySelector(inputSelector);
    if (inputField) {
        console.log('found');
      window.buttons = document.querySelectorAll('button');
        findAndPasteURL(inputField);
        return true;
    }
});
