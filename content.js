let isScraping = false;
let scrollInterval = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'START_SCRAPE') {
        if (!isScraping) {
            isScraping = true;
            startProcess();
        }
    } else if (message.action === 'STOP_SCRAPE') {
        isScraping = false;
        chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', text: 'Stopped.' });
    }
    return true;
});

async function startProcess() {
    try {
        const scroller = findScrollContainer();
        if (!scroller) {
            throw new Error('Could not find chat scroll container.');
        }

        chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', text: 'Scrolling to top...' });

        // Auto-scroll logic
        await autoScrollToTop(scroller);

        if (!isScraping) return; // User stopped

        chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', text: 'Scraping text...' });

        // Scraping logic
        const transcript = scrapeConversation();

        // FIX: Send payload to Popup instead of writing to clipboard here
        chrome.runtime.sendMessage({ type: 'COMPLETE', payload: transcript });

    } catch (error) {
        console.error(error);
        chrome.runtime.sendMessage({ type: 'ERROR', text: error.message });
    } finally {
        isScraping = false;
    }
}

function findScrollContainer() {
    // Common containers for Gemini/chat apps
    const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
        const style = window.getComputedStyle(el);
        return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });

    if (candidates.length === 0) return document.documentElement; // Fallback

    // Usually the chat container is the largest scrollable one closest to body
    candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
    return candidates[0];
}

async function autoScrollToTop(scroller) {
    let previousHeight = scroller.scrollHeight;
    let noChangeCount = 0;
    const MAX_NO_CHANGE = 2;

    while (isScraping) {
        scroller.scrollTop = 0;

        // Wait for load
        await new Promise(r => setTimeout(r, 1500));

        const newHeight = scroller.scrollHeight;

        if (newHeight > previousHeight) {
            // Content loaded
            previousHeight = newHeight;
            noChangeCount = 0;
            chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', text: 'Loading older messages...' });
        } else {
            // No new content loaded
            noChangeCount++;
            if (noChangeCount >= MAX_NO_CHANGE) {
                break; // Reached top
            }
        }
    }
}

function scrapeConversation() {
    const scroller = findScrollContainer();

    // Determine the container holding the messages
    let messageList = scroller.children;

    // If the scroller has very few children (e.g., 1 wrapper), and that wrapper has many children, 
    // it's likely the wrapper holds the messages.
    // The previous logic `scroller.firstElementChild` blindly picked the first child, 
    // which fails if messages are direct children of scroller.
    if (scroller.children.length === 1 && scroller.firstElementChild.children.length > 0) {
        messageList = scroller.firstElementChild.children;
    } else if (scroller.children.length > 0 && scroller.children.length < 3) {
        // Fallback or detailed check: sometimes there's a header + wrapper
        // Use the child with greatest height if it has significantly more children
        const sortedChildren = Array.from(scroller.children).sort((a, b) => b.scrollHeight - a.scrollHeight);
        const likelyWrapper = sortedChildren[0];
        if (likelyWrapper.children.length > scroller.children.length) {
            messageList = likelyWrapper.children;
        }
    }

    let transcript = "[START OF PREVIOUS CONTEXT]\n(Auto-scrolled to beginning)\n\n";

    // Heuristic: Iterate over block level elements
    const blocks = Array.from(messageList);

    transcript += scrapeNodes(blocks);

    transcript += "\n[END OF CONTEXT]";
    return transcript;
}

function scrapeNodes(nodeList) {
    let text = "";
    Array.from(nodeList).forEach(node => {
        // Ignore hidden or empty nodes
        if (node.innerText.trim() === "") return;

        // Try to identify speaker using Heuristics
        // ChatGPT uses data-message-author-role="user" or "assistant"
        const chatGptRole = node.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');

        const isUser = chatGptRole === 'user' ||
            node.querySelector('img[alt*="profile"], svg[class*="user"], [aria-label*="User"], [data-testid="user-avatar"]') ||
            node.innerText.includes('You\n') ||
            node.classList.toString().includes('user');

        const isModel = chatGptRole === 'assistant' ||
            node.querySelector('img[src*="google"], img[src*="gemini"], svg[class*="sparkle"], [aria-label*="Gemini"], [data-testid="model-avatar"]') ||
            node.classList.toString().includes('model');

        // Determine header
        let header = "";
        if (isUser) header = "### USER:";
        else if (isModel) header = "### MODEL:"; // Changed from GEMINI to MODEL to be generic
        else {
            header = "---";
        }

        const content = node.innerText.trim();
        text += `\n${header}\n${content}\n\n`;
    });
    return text;
}


