import * as React from "react";
import { useState, useCallback } from "react";
import Editor from "~/scenes/EditorOnly/components/Editor";
import EditorContainer from "~/scenes/EditorOnly/components/Styles";

const QUICKDOCS_COLLECTION_ID = "3324d2b3-284e-4fc6-9c8b-2465066ee705";

function EditorOnly() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const editorRef = React.useRef<any>(); // Ref to access editor content

  const handleCreateDocument = useCallback(async () => {
    if (!title.trim() || !content.trim()) {
      alert("Title and content cannot be empty.");
      return;
    }

    try {
      const response = await fetch("/api/documents.create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title,
          text: content,
          publish: true,
          collectionId: QUICKDOCS_COLLECTION_ID,
        }),
      });

      if (response.ok) {
        alert("Document created successfully!");
        setTitle("");
        setContent("");
        if (editorRef.current) {
          editorRef.current.clearContent(); // Assuming an editor method to clear content
        }
      } else {
        const errorData = await response.json();
        alert(`Failed to create document: ${errorData.message || response.statusText}`);
      }
    } catch (error) {
      console.error("Error creating document:", error);
      alert("An error occurred while creating the document.");
    }
  }, [title, content]);

  const handleEditorChange = useCallback((event: any) => {
    // Assuming event.json is the ProseMirror JSON content
    // and event.text is the plain text content
    setContent(event.text);
  }, []);

  return (
    <div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
      <h1>Create New Quickdoc</h1>
      <input
        type="text"
        placeholder="Document Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ width: "100%", padding: "10px", marginBottom: "20px", fontSize: "1.2em" }}
      />
      <EditorContainer rtl={false} style={{ border: "1px solid #ddd", minHeight: "300px", padding: "10px" }}>
        <Editor
          ref={editorRef}
          onChange={handleEditorChange}
          defaultValue=""
          placeholder="Start writing your document..."
        />
      </EditorContainer>
      <button
        onClick={handleCreateDocument}
        style={{
          marginTop: "20px",
          padding: "10px 20px",
          fontSize: "1em",
          backgroundColor: "#007bff",
          color: "white",
          border: "none",
          borderRadius: "5px",
          cursor: "pointer",
        }}
      >
        Create Document
      </button>
    </div>
  );
}

export default EditorOnly;
