// Pdf Signing Agent - Content Script
// Bridges communication between web page and extension background

// Cross-browser compatibility
const browserAPI = typeof browser !== "undefined" ? browser : chrome;

// Inject the page-accessible script
const script = document.createElement("script");
script.src = browserAPI.runtime.getURL("injected.js");
script.onload = function () {
  this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the injected script (web page)
window.addEventListener("message", async (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;

  // Only handle Pdf messages
  if (!event.data || !event.data.type?.startsWith("PDF_")) return;

  const { type, payload, messageId } = event.data;

  try {
    // Forward to background script
    const response = await browserAPI.runtime.sendMessage({ type, ...payload });

    // Send response back to page
    window.postMessage(
      {
        type: `${type}_RESPONSE`,
        messageId,
        payload: response,
      },
      "*",
    );
  } catch (error) {
    // Send error back to page
    window.postMessage(
      {
        type: `${type}_RESPONSE`,
        messageId,
        payload: { error: error.message },
      },
      "*",
    );
  }
});

// Announce extension presence to page
window.postMessage({ type: "PDF_EXTENSION_LOADED" }, "*");
