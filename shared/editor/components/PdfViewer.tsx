import * as React from "react";
import { useState } from "react";
import styled from "styled-components";
// Assuming react-pdf is installed in the target environment
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import { LoadingIcon } from "outline-icons";

// Configure pdfjs worker source (adjust path if necessary based on build setup)
// This is often needed for react-pdf to work correctly.
// Option 1: Use CDN (simpler if allowed)
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
// Option 2: Copy worker file during build and reference locally (more robust)
// pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

const PdfWrapper = styled.div`
  border: 1px solid ${s("divider")};
  margin: 1em 0;
  user-select: none;
  position: relative; /* Needed for absolute positioning of loader/error */
  background: ${s("background")};
  overflow: hidden; /* Prevents scrollbars within the wrapper */
`;

const ViewerContainer = styled.div`
  max-height: 600px; /* Limit initial height */
  overflow-y: auto; /* Allow vertical scrolling for multi-page PDFs */
  display: flex;
  flex-direction: column;
  align-items: center; /* Center pages horizontally */
  padding: 8px 0; /* Add some padding around pages */

  .react-pdf__Page {
    margin-bottom: 8px; /* Space between pages */
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.1); /* Subtle shadow for pages */
  }
`;

const StatusOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.8);
  color: ${s("textSecondary")};
  font-size: 1em;
  min-height: 100px;
`;

const LoadingIndicator = styled(LoadingIcon)`
  width: 24px;
  height: 24px;
`;

const ErrorMessage = styled.div`
  color: ${s("danger")};
  padding: 1em;
  text-align: center;
`;

type Props = {
  attachmentId: string;
  isSelected: boolean; // Prosemirror provides this
  isEditable: boolean; // Prosemirror provides this
  // Add other relevant props from Prosemirror if needed
};

const PdfViewer: React.FC<Props> = ({
  attachmentId,
  isSelected,
  isEditable,
}: Props) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pdfUrl = `/api/attachments.redirect?id=${attachmentId}`;

  function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
    setNumPages(numPages);
    setIsLoading(false);
    setError(null);
  }

  function onDocumentLoadError(loadError: Error): void {
    console.error("Failed to load PDF", loadError);
    setError(
      `Failed to load PDF: ${loadError.message || "Unknown error"}`
    );
    setIsLoading(false);
  }

  // Prevent interaction when not selected and editable
  const contentEditable = isSelected && isEditable;

  return (
    <PdfWrapper contentEditable={false} data-selected={isSelected}>
      {isLoading && (
        <StatusOverlay>
          <LoadingIndicator />
        </StatusOverlay>
      )}
      {error && !isLoading && (
        <StatusOverlay>
          <ErrorMessage>{error}</ErrorMessage>
        </StatusOverlay>
      )}
      {!isLoading && !error && (
        <ViewerContainer>
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading="" // Disable default loader, we use our own StatusOverlay
            error="" // Disable default error, we use our own StatusOverlay
          >
            {Array.from(new Array(numPages || 0), (el, index) => (
              <Page
                key={`page_${index + 1}`}
                pageNumber={index + 1}
                renderAnnotationLayer // Keep annotations if they exist
                renderTextLayer // Allow text selection
                // Adjust width as needed, maybe based on editor width?
                // width={600}
              />
            ))}
          </Document>
        </ViewerContainer>
      )}
    </PdfWrapper>
  );
};

// Helper function 's' for styled-components theme access (assuming it exists globally or is imported)
// This is a common pattern in Outline's codebase based on search results.
// If it's not available globally, it needs to be imported from the correct location.
// Example: import { s } from "@shared/styles";
declare function s(key: string): any;

export default PdfViewer;
