document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const copyBtn = document.getElementById('copyBtn');
    const statusDiv = document.getElementById('status');
    const resultArea = document.getElementById('resultArea');

    let scrapedContent = '';

    // Helper to update UI state
    function updateState(state, message) {
        statusDiv.textContent = message;
        statusDiv.className = 'status ' + state;

        if (state === 'working') {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            copyBtn.style.display = 'none';
            startBtn.style.display = 'block';
        } else if (state === 'ready_to_copy') {
            startBtn.style.display = 'none';
            stopBtn.disabled = true;
            stopBtn.style.display = 'none';
            copyBtn.style.display = 'block'; // Show copy button
        } else {
            // Idle or Error
            startBtn.disabled = false;
            startBtn.style.display = 'block';
            stopBtn.disabled = true;
            stopBtn.style.display = 'block'; // Reset
            copyBtn.style.display = 'none';
        }
    }

    // Handle Start
    startBtn.addEventListener('click', async () => {
        updateState('working', 'Initializing...');
        scrapedContent = '';

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            const isGemini = tab.url.includes('gemini.google.com');
            const isChatGPT = tab.url.includes('chatgpt.com') || tab.url.includes('chat.openai.com');

            if (!isGemini && !isChatGPT) {
                updateState('error', 'Not a Gemini or ChatGPT tab!');
                return;
            }

            // Send start message to content script
            chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPE' }, (response) => {
                if (chrome.runtime.lastError) {
                    updateState('error', 'Please refresh the page first.');
                }
            });

        } catch (err) {
            updateState('error', 'Error: ' + err.message);
        }
    });

    // Handle Stop
    stopBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCRAPE' });
        updateState('idle', 'Stopped by user');
    });

    // Handle Copy - THIS IS THE CRITICAL USER GESTURE
    copyBtn.addEventListener('click', async () => {
        if (!scrapedContent) {
            updateState('error', 'No content to copy.');
            return;
        }

        try {
            // Method 1: Navigator API
            await navigator.clipboard.writeText(scrapedContent);
            updateState('success', 'Copied to Clipboard!');
        } catch (err) {
            console.warn('Navigator clipboard failed, trying fallback execCommand', err);
            // Method 2: Fallback to textarea selection
            resultArea.value = scrapedContent;
            resultArea.select();
            try {
                document.execCommand('copy');
                updateState('success', 'Copied (Fallback)!');
            } catch (fallbackErr) {
                updateState('error', 'Copy failed completely: ' + fallbackErr.message);
            }
        }

        setTimeout(() => {
            updateState('idle', 'Idle');
            startBtn.textContent = 'Scroll & Scrape again';
        }, 3000);
    });

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'STATUS_UPDATE') {
            statusDiv.textContent = message.text;
        } else if (message.type === 'COMPLETE') {
            // Receive payload but DO NOT COPY yet
            if (message.payload) {
                scrapedContent = message.payload;
                updateState('ready_to_copy', 'Done! Click Copy below.');
            } else {
                updateState('error', 'No text found.');
            }
        } else if (message.type === 'ERROR') {
            updateState('error', message.text);
        }
    });
});
