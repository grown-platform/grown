// Pdf Signing Agent - Injected Script
// Provides window.PdfSigner API for web pages

(function () {
  "use strict";

  let messageId = 0;
  const pendingMessages = new Map();

  // Listen for responses from content script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data?.type?.endsWith("_RESPONSE")) return;

    const { messageId: id, payload } = event.data;
    if (pendingMessages.has(id)) {
      const { resolve, reject } = pendingMessages.get(id);
      pendingMessages.delete(id);

      if (payload?.error) {
        reject(new Error(payload.error));
      } else {
        resolve(payload);
      }
    }
  });

  // Send message to extension and wait for response
  function sendMessage(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      pendingMessages.set(id, { resolve, reject });

      // Timeout after 60 seconds
      setTimeout(() => {
        if (pendingMessages.has(id)) {
          pendingMessages.delete(id);
          reject(new Error("Request timed out"));
        }
      }, 60000);

      window.postMessage(
        {
          type,
          messageId: id,
          payload,
        },
        "*",
      );
    });
  }

  // Public API
  window.PdfSigner = {
    /**
     * Check if the signing extension is available
     * @returns {Promise<{available: boolean, nativeHostConnected: boolean}>}
     */
    async isAvailable() {
      try {
        const result = await sendMessage("PDF_CHECK_EXTENSION");
        return {
          available: result.available === true,
          nativeHostConnected: result.nativeHostConnected === true,
        };
      } catch (error) {
        return { available: false, nativeHostConnected: false };
      }
    },

    /**
     * List available signing certificates from connected smart cards
     * @returns {Promise<{certificates: Array<{id: string, subject: string, issuer: string, email: string, notBefore: string, notAfter: string}>}>}
     */
    async listCertificates() {
      return sendMessage("PDF_LIST_CERTIFICATES");
    },

    /**
     * Sign a hash using a certificate's private key
     * @param {string} certificateId - The ID of the certificate to use
     * @param {string} hash - Base64-encoded hash to sign
     * @param {string} hashAlgorithm - Hash algorithm (SHA256, SHA384, SHA512)
     * @returns {Promise<{signature: string}>} - Base64-encoded signature
     */
    async signHash(certificateId, hash, hashAlgorithm = "SHA256") {
      return sendMessage("PDF_SIGN_HASH", {
        certificateId,
        hash,
        hashAlgorithm,
      });
    },

    /**
     * Get the full certificate and chain for a certificate ID
     * @param {string} certificateId - The ID of the certificate
     * @returns {Promise<{certificate: string, chain: string[]}>} - Base64-encoded certificates
     */
    async getCertificate(certificateId) {
      return sendMessage("PDF_GET_CERTIFICATE", {
        certificateId,
      });
    },

    /**
     * Complete signing flow: list certs, let user pick, sign hash
     * @param {string} hash - Base64-encoded hash to sign
     * @param {string} hashAlgorithm - Hash algorithm
     * @returns {Promise<{signature: string, certificate: string, chain: string[]}>}
     */
    async signWithSelection(hash, hashAlgorithm = "SHA256") {
      // List available certificates
      const { certificates } = await this.listCertificates();

      if (!certificates || certificates.length === 0) {
        throw new Error(
          "No signing certificates found. Please insert your CAC/PIV card.",
        );
      }

      // If only one cert, use it. Otherwise, user should have picked via UI.
      // This method assumes UI selection happened before calling this.
      const cert = certificates[0];

      // Sign the hash
      const signResult = await this.signHash(cert.id, hash, hashAlgorithm);

      // Get full certificate chain
      const certResult = await this.getCertificate(cert.id);

      return {
        signature: signResult.signature,
        certificate: certResult.certificate,
        chain: certResult.chain || [],
      };
    },
  };

  // Dispatch custom event to let page know API is ready
  window.dispatchEvent(new CustomEvent("PdfSignerReady"));
})();
