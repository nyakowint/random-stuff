// ==UserScript==
// @name         Copy twitch point reward IDs
// @namespace    https://github.com/nyakowint/random-stuff/
// @version      0.2
// @description  Extract data-reward-id attributes from Twitch channel points rewards
// @match        https://dashboard.twitch.tv/*/viewer-rewards/channel-points/rewards
// @downloadURL  https://raw.githubusercontent.com/nyakowint/random-stuff/main/ttv_copy_reward_id.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function extractRewardId(button) {
        const rewardId = button.getAttribute('data-reward-id');
        console.log('Extracted Reward ID:', rewardId);
        navigator.clipboard.writeText(rewardId).then(() => {
            alert(`Reward ID copied to clipboard: ${rewardId}`);
        });
    }

    function addExtractButton(container) {
        if (!container.querySelector('.extract-reward-id-button')) {
            const rewardId = container.getAttribute('data-reward-id');
            const button = document.createElement('button');
            button.textContent = '📋';
            button.className = 'extract-reward-id-button button';
            button.style.cssText = 'padding: 3px; margin-left: 5px; color: var(--color-text-button-secondary); background-color: var(--color-background-button-secondary-default); border-radius: 6px;';
            button.setAttribute('data-reward-id', rewardId);
            button.setAttribute('title', "Copy reward ID");
            button.addEventListener('click', function() {
                extractRewardId(this);
            });
            container.parentNode.insertBefore(button, container.nextSibling);
        }
    }

    function observeDOM() {
        const targetNode = document.querySelector('.channel-points-rewards__list');
        if (!targetNode) return;

        const config = { childList: true, subtree: true };
        const observer = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const container = node.querySelector('button[data-reward-id]:has(> div > div[data-a-target])');
                            if (container) {
                                addExtractButton(container);
                            }
                        }
                    });
                }
            }
        });

        observer.observe(targetNode, config);
    }

    function initializeButtons() {
        const containers = document.querySelectorAll('button[data-reward-id]:has(> div > div[data-a-target])');
        containers.forEach(addExtractButton);
    }

    // Wait for the page to load before initializing
    window.addEventListener('load', () => {
        setTimeout(() => {
            initializeButtons();
            observeDOM();
        }, 300);
    });
})();
