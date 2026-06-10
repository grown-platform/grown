// Pdf Signing Agent - Popup Script

// Cross-browser compatibility
const browserAPI = typeof browser !== "undefined" ? browser : chrome;

const statusSection = document.getElementById("status-section");
const certsSection = document.getElementById("certs-section");
const refreshBtn = document.getElementById("refresh-btn");

async function checkStatus() {
  statusSection.innerHTML = `
    <div class="loader">
      <div class="spinner"></div>
      <div>Checking status...</div>
    </div>
  `;
  certsSection.innerHTML = "";

  try {
    // Check native host connection
    const response = await browserAPI.runtime.sendMessage({
      type: "PDF_CHECK_EXTENSION",
    });

    if (!response.nativeHostConnected) {
      statusSection.innerHTML = `
        <div class="status error">
          <span class="status-icon"></span>
          Native signing helper not connected
        </div>
        <p style="font-size: 12px; color: #6b7280; margin-top: 8px;">
          Please install the Pdf Signing Helper from the Pdf website.
        </p>
      `;
      return;
    }

    statusSection.innerHTML = `
      <div class="status success">
        <span class="status-icon"></span>
        Ready to sign
      </div>
    `;

    // List certificates
    await listCertificates();
  } catch (error) {
    console.error("Status check error:", error);
    statusSection.innerHTML = `
      <div class="status error">
        <span class="status-icon"></span>
        Error: ${error.message}
      </div>
    `;
  }
}

async function listCertificates() {
  certsSection.innerHTML = `
    <div class="certs-section">
      <h2>Signing Certificates</h2>
      <div class="loader">
        <div class="spinner"></div>
        <div>Loading certificates...</div>
      </div>
    </div>
  `;

  try {
    const response = await browserAPI.runtime.sendMessage({
      type: "PDF_LIST_CERTIFICATES",
    });

    if (response.error) {
      throw new Error(response.error);
    }

    const certificates = response.certificates || [];

    if (certificates.length === 0) {
      certsSection.innerHTML = `
        <div class="certs-section">
          <h2>Signing Certificates</h2>
          <div class="no-certs">
            <p>No certificates found</p>
            <p style="font-size: 12px; margin-top: 4px;">
              Insert your CAC/PIV card and click Refresh
            </p>
          </div>
        </div>
      `;
      return;
    }

    const certsHtml = certificates
      .map(
        (cert) => `
      <div class="cert-card">
        <div class="name">${escapeHtml(cert.subject || "Unknown")}</div>
        <div class="details">
          ${cert.email ? `Email: ${escapeHtml(cert.email)}<br>` : ""}
          Issuer: ${escapeHtml(cert.issuer || "Unknown")}<br>
          Expires: ${cert.notAfter ? new Date(cert.notAfter).toLocaleDateString() : "Unknown"}
        </div>
      </div>
    `,
      )
      .join("");

    certsSection.innerHTML = `
      <div class="certs-section">
        <h2>Signing Certificates (${certificates.length})</h2>
        ${certsHtml}
      </div>
    `;
  } catch (error) {
    console.error("Certificate list error:", error);
    certsSection.innerHTML = `
      <div class="certs-section">
        <h2>Signing Certificates</h2>
        <div class="status error">
          <span class="status-icon"></span>
          ${escapeHtml(error.message)}
        </div>
      </div>
    `;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

refreshBtn.addEventListener("click", checkStatus);

// Check status on popup open
checkStatus();
