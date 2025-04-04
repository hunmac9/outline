import * as React from "react";
import styled from "styled-components";

const Container = styled.div`
  border: 1px solid #ccc;
  padding: 1rem;
  margin: 1rem 0;
  min-height: 100px; /* Placeholder height */
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f9f9f9;
  color: #666;
`;

type Props = {
  attachmentId: string;
  // We will likely need more props later, e.g., isSelected, isEditable
};

const PdfViewer: React.FC<Props> = ({ attachmentId }) => {
  // TODO: Fetch attachment URL using attachmentId
  // TODO: Integrate a PDF rendering library (e.g., react-pdf)
  // TODO: Handle loading and error states

  return (
    <Container contentEditable={false}>
      [PDF Viewer Placeholder: Attachment ID {attachmentId}]
    </Container>
  );
};

export default PdfViewer;
