import { AttachmentIcon } from "outline-icons"; // Changed from FileIcon
import * as React from "react";
import { Document, Page, pdfjs } from "react-pdf";
// CSS imports are safe here as this component is only loaded client-side
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import styled from "styled-components";
import { ComponentProps } from "../types"; // Assuming ComponentProps is needed and defined here or imported
import Widget from "./Widget"; // Assuming Widget is needed and defined here or imported

// Configure pdfjs worker (can also be done here or globally)
// pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

// Memoize the options object outside the component
const pdfDocumentOptions = {
  workerSrc: pdfjs.GlobalWorkerOptions.workerSrc,
};

const PdfContainer = styled.div`
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 4px;
  padding: 8px;
  margin: 8px 0;
  max-width: 100%;
  overflow: hidden; /* Restore overflow */
  /* min-height: 100px; */ /* Remove minimum height */
  position: relative; /* For potential resize handles */

  .react-pdf__Document {
    max-height: 500px; /* Limit initial height */
    overflow-y: auto;
  }

  /* Basic resize handle styling (example) */
  .resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 15px;
    height: 15px;
    background: ${(props) => props.theme.textSecondary};
    cursor: nwse-resize;
    opacity: 0.5;
    border-top-left-radius: 4px;
  }
`;

const ErrorMessage = styled.div`
  color: ${(props) => props.theme.danger};
  padding: 10px;
`;

const LoadingMessage = styled.div`
  padding: 10px;
  color: ${(props) => props.theme.textSecondary};
`;

interface PdfComponentState {
  numPages: number | null;
  error: string | null;
  containerWidth: number;
  memoizedFile: { url: string } | null; // Add state for memoized file prop
}

// Renamed to avoid conflict if PdfComponent exists elsewhere
export default class PdfEmbedComponent extends React.Component<
  ComponentProps,
  PdfComponentState
> {
  // Initialize state including memoizedFile
  state: PdfComponentState = {
    numPages: null,
    error: null,
    containerWidth: 0,
    memoizedFile: this.props.node.attrs.href
      ? { url: this.props.node.attrs.href }
      : null,
  };

  containerRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    this.updateContainerWidth();
    window.addEventListener("resize", this.updateContainerWidth);
  }

  componentDidUpdate(prevProps: ComponentProps) {
    // Update memoizedFile only if href actually changes
    const currentHref = this.props.node.attrs.href;
    const previousHref = prevProps.node.attrs.href;

    if (currentHref !== previousHref) {
      this.setState({
        memoizedFile: currentHref ? { url: currentHref } : null,
        // Reset numPages and error when file changes
        numPages: null,
        error: null,
      });
    }
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.updateContainerWidth);
  }

  updateContainerWidth = () => {
    if (this.containerRef.current) {
      // Subtract padding/border width for accurate page width
      this.setState({
        containerWidth: this.containerRef.current.offsetWidth - 18,
      });
    }
  };

  onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    this.setState({ numPages, error: null });
  };

  onDocumentLoadError = (error: Error) => {
    this.setState({
      error: `Failed to load PDF: ${error.message}`,
      numPages: null,
    });
  };

  // Basic resize logic (could be improved with drag events)
  handleResize = (event: React.MouseEvent) => {
    // Placeholder for more complex resize handling
    event.preventDefault(); // Prevent default drag behavior if any
  };

  render() {
    // theme might need to be accessed differently if not passed via props directly
    const { node, isSelected, isEditable, theme } = this.props;
    // Use title from node.attrs, but file from state (href is implicitly in memoizedFile.url)
    const { title } = node.attrs;
    const { numPages, error, containerWidth, memoizedFile } = this.state;

    // Initial loading state before href is available (via memoizedFile)
    if (!memoizedFile) {
      return (
        <Widget
          icon={<AttachmentIcon color={theme.textSecondary} />} // Changed from FileIcon
          title={title || "Uploading PDF..."}
          isSelected={isSelected}
          theme={theme}
        >
          <LoadingMessage theme={theme}>Uploading…</LoadingMessage>
        </Widget>
      );
    }

    return (
      <PdfContainer
        ref={this.containerRef}
        theme={theme}
        data-nodetype="pdf_document"
      >
        {/* Restore Widget wrapper */}
        <Widget
          icon={<AttachmentIcon color={theme.textSecondary} />}
          title={title || "PDF Document"}
          isSelected={isSelected}
          theme={theme}
          // Prevent clicks inside the widget from deselecting the node
          onClick={(e) => e.stopPropagation()}
        >
          {error ? (
            <ErrorMessage theme={theme}>{error}</ErrorMessage>
          ) : (
            <Document
              key={memoizedFile.url} // Use memoizedFile.url for key
              file={memoizedFile} // Pass memoized file object
              onLoadSuccess={this.onDocumentLoadSuccess}
              onLoadError={this.onDocumentLoadError}
              loading={
                <LoadingMessage theme={theme}>Loading PDF…</LoadingMessage>
              }
              options={pdfDocumentOptions} // Use the memoized options object
            >
              {/* Restore original page rendering loop */}
              {Array.from(new Array(numPages ?? 0), (el, index) => (
                <Page
                  key={`page_${index + 1}`}
                  pageNumber={index + 1}
                  width={containerWidth > 0 ? containerWidth : undefined} // Use container width
                  renderAnnotationLayer={false} // Disable annotation layer for simplicity
                  renderTextLayer={false} // Disable text layer for simplicity
                />
              ))}
            </Document>
          )}
          {/* Example resize handle - needs proper event handling */}
          {isEditable && (
            <div className="resize-handle" onMouseDown={this.handleResize} />
          )}
        </Widget>
      </PdfContainer>
    );
  }
}
