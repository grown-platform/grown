// Hook for interacting with Pdf Signing Agent browser extension

import { useState, useEffect, useCallback } from "react";

// Types matching the extension's API
export interface SignerCertificate {
  id: string;
  subject: string;
  issuer: string;
  email?: string;
  notBefore: string;
  notAfter: string;
  keyType: string;
}

export interface SignerStatus {
  available: boolean;
  nativeHostConnected: boolean;
}

// Extend Window interface for PdfSigner
declare global {
  interface Window {
    PdfSigner?: {
      isAvailable(): Promise<SignerStatus>;
      listCertificates(): Promise<{ certificates: SignerCertificate[] }>;
      signHash(
        certificateId: string,
        hash: string,
        hashAlgorithm?: string,
      ): Promise<{ signature: string }>;
      getCertificate(
        certificateId: string,
      ): Promise<{ certificate: string; chain: string[] }>;
    };
  }
}

export interface UsePdfSignerResult {
  // Status
  extensionReady: boolean;
  nativeConnected: boolean;
  isChecking: boolean;
  error: string | null;

  // Certificates
  certificates: SignerCertificate[];
  selectedCertificate: SignerCertificate | null;
  setSelectedCertificate: (cert: SignerCertificate | null) => void;

  // Actions
  refreshCertificates: () => Promise<void>;
  signHash: (
    hash: string,
    hashAlgorithm?: string,
  ) => Promise<{
    signature: string;
    certificate: string;
    chain: string[];
  } | null>;
}

export function usePdfSigner(): UsePdfSignerResult {
  const [extensionReady, setExtensionReady] = useState(false);
  const [nativeConnected, setNativeConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [certificates, setCertificates] = useState<SignerCertificate[]>([]);
  const [selectedCertificate, setSelectedCertificate] =
    useState<SignerCertificate | null>(null);

  // Check if extension is available
  const checkExtension = useCallback(async () => {
    setIsChecking(true);
    setError(null);

    try {
      // Wait for extension to inject its API
      if (!window.PdfSigner) {
        // Try waiting a bit for the extension to load
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (!window.PdfSigner) {
        setExtensionReady(false);
        setNativeConnected(false);
        return;
      }

      const status = await window.PdfSigner.isAvailable();
      setExtensionReady(status.available);
      setNativeConnected(status.nativeHostConnected);

      if (status.available && status.nativeHostConnected) {
        // Auto-load certificates
        await loadCertificates();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to check extension",
      );
      setExtensionReady(false);
      setNativeConnected(false);
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Load certificates from smart card
  const loadCertificates = async () => {
    if (!window.PdfSigner) {
      throw new Error("Extension not available");
    }

    try {
      const result = await window.PdfSigner.listCertificates();
      setCertificates(result.certificates || []);

      // Auto-select first certificate if none selected
      if (result.certificates?.length > 0 && !selectedCertificate) {
        setSelectedCertificate(result.certificates[0]);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load certificates",
      );
      setCertificates([]);
    }
  };

  // Refresh certificates
  const refreshCertificates = useCallback(async () => {
    setError(null);
    try {
      await loadCertificates();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh certificates",
      );
    }
  }, []);

  // Sign a hash using selected certificate
  const signHash = useCallback(
    async (hash: string, hashAlgorithm: string = "SHA256") => {
      if (!window.PdfSigner) {
        setError("Extension not available");
        return null;
      }

      if (!selectedCertificate) {
        setError("No certificate selected");
        return null;
      }

      setError(null);

      try {
        // Sign the hash
        const signResult = await window.PdfSigner.signHash(
          selectedCertificate.id,
          hash,
          hashAlgorithm,
        );

        // Get full certificate chain
        const certResult = await window.PdfSigner.getCertificate(
          selectedCertificate.id,
        );

        return {
          signature: signResult.signature,
          certificate: certResult.certificate,
          chain: certResult.chain || [],
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sign");
        return null;
      }
    },
    [selectedCertificate],
  );

  // Check extension on mount and listen for extension load event
  useEffect(() => {
    checkExtension();

    // Listen for extension ready event
    const handleExtensionReady = () => {
      checkExtension();
    };

    window.addEventListener("PdfSignerReady", handleExtensionReady);

    return () => {
      window.removeEventListener("PdfSignerReady", handleExtensionReady);
    };
  }, [checkExtension]);

  return {
    extensionReady,
    nativeConnected,
    isChecking,
    error,
    certificates,
    selectedCertificate,
    setSelectedCertificate,
    refreshCertificates,
    signHash,
  };
}
