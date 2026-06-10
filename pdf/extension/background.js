// Pdf Signing Agent - Background Service Worker
// Handles communication between content script and native signing helper

// Cross-browser compatibility: Firefox uses 'browser', Chrome uses 'chrome'
const browserAPI = typeof browser !== "undefined" ? browser : chrome;

const NATIVE_HOST_NAME = "dev.pick.pdf.signer";
let nativePort = null;
let pendingRequests = new Map();
let requestId = 0;

// Connect to native signing helper
function connectNativeHost() {
  if (nativePort) {
    return true;
  }

  try {
    nativePort = browserAPI.runtime.connectNative(NATIVE_HOST_NAME);

    nativePort.onMessage.addListener((message) => {
      console.log("Received from native host:", message);

      if (message.requestId && pendingRequests.has(message.requestId)) {
        const { resolve, reject } = pendingRequests.get(message.requestId);
        pendingRequests.delete(message.requestId);

        if (message.error) {
          reject(new Error(message.error));
        } else {
          resolve(message);
        }
      }
    });

    nativePort.onDisconnect.addListener(() => {
      console.log(
        "Native host disconnected:",
        browserAPI.runtime.lastError?.message,
      );
      nativePort = null;

      // Reject all pending requests
      for (const [id, { reject }] of pendingRequests) {
        reject(new Error("Native host disconnected"));
      }
      pendingRequests.clear();
    });

    return true;
  } catch (error) {
    console.error("Failed to connect to native host:", error);
    return false;
  }
}

// Send message to native host and wait for response
function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    if (!connectNativeHost()) {
      reject(
        new Error("Cannot connect to Pdf Signing Helper. Is it installed?"),
      );
      return;
    }

    const id = ++requestId;
    message.requestId = id;
    pendingRequests.set(id, { resolve, reject });

    // Set timeout
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Request timed out"));
      }
    }, 60000); // 60 second timeout for signing operations

    nativePort.postMessage(message);
  });
}

// Handle messages from content script
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received:", message.type);

  // Use async/await pattern with sendResponse
  (async () => {
    try {
      switch (message.type) {
        case "PDF_CHECK_EXTENSION":
          // Check if extension and native host are available
          const connected = connectNativeHost();
          sendResponse({
            available: true,
            nativeHostConnected: connected,
          });
          break;

        case "PDF_LIST_CERTIFICATES":
          // List available certificates from smart cards
          const certs = await sendNativeMessage({ action: "listCertificates" });
          sendResponse(certs);
          break;

        case "PDF_SIGN_HASH":
          // Sign a hash with specified certificate
          const signResult = await sendNativeMessage({
            action: "signHash",
            certificateId: message.certificateId,
            hash: message.hash,
            hashAlgorithm: message.hashAlgorithm || "SHA256",
          });
          sendResponse(signResult);
          break;

        case "PDF_GET_CERTIFICATE":
          // Get full certificate chain for a certificate
          const certResult = await sendNativeMessage({
            action: "getCertificate",
            certificateId: message.certificateId,
          });
          sendResponse(certResult);
          break;

        default:
          sendResponse({ error: "Unknown message type" });
      }
    } catch (error) {
      console.error("Background error:", error);
      sendResponse({ error: error.message });
    }
  })();

  // Return true to indicate async response
  return true;
});

// Listen for extension install/update
browserAPI.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("Pdf Signing Agent installed");
    // Could open options page here
  } else if (details.reason === "update") {
    console.log(
      "Pdf Signing Agent updated to",
      browserAPI.runtime.getManifest().version,
    );
  }
});
