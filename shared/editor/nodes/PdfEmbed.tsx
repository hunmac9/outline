import { NodeSpec, NodeType, Node as ProsemirrorNode } from "prosemirror-model";
import { Command } from "prosemirror-state";
import * as React from "react";
import { Primitive } from "utility-types";
import PdfViewer from "../components/PdfViewer";
import { MarkdownSerializerState } from "../lib/markdown/serializer";
import { ComponentProps } from "../types";
import Node from "./Node";

export default class PdfEmbed extends Node {
  get name() {
    return "pdfEmbed";
  }

  get schema(): NodeSpec {
    return {
      group: "block",
      atom: true,
      attrs: {
        attachmentId: {
          validate: "string", // Ensure attachmentId is always a string
          default: "", // Provide a default empty string
        },
        // Consider adding width/height later if resizing is needed
      },
      parseDOM: [
        {
          tag: "div[data-pdf-attachment-id]",
          getAttrs: (dom: HTMLElement) => ({
            attachmentId: dom.getAttribute("data-pdf-attachment-id") || "",
          }),
        },
      ],
      toDOM: (node) => [
        "div",
        {
          "data-pdf-attachment-id": node.attrs.attachmentId,
          class: "pdf-embed-placeholder", // Add a class for potential styling
        },
        // No content inside the DOM representation itself,
        // the NodeView (component) handles the rendering.
      ],
      toPlainText: (node) => `[Embedded PDF: ${node.attrs.attachmentId}]`,
    };
  }

  // We might need rulePlugins later if we add specific input rules (e.g., pasting a PDF link)

  component = (props: ComponentProps) => {
    // Pass necessary props to the PdfViewer component
    return <PdfViewer attachmentId={props.node.attrs.attachmentId} />;
  };

  commands({ type }: { type: NodeType }) {
    return (attrs: { attachmentId: string }): Command =>
      (state, dispatch) => {
        if (!attrs.attachmentId) {
          console.error("Cannot insert PdfEmbed without attachmentId");
          return false; // Don't insert if attachmentId is missing
        }
        dispatch?.(
          state.tr.replaceSelectionWith(type.create(attrs)).scrollIntoView()
        );
        return true;
      };
  }

  // Define how this node is represented in Markdown.
  // Option 1: Simple placeholder text (less useful for re-parsing)
  // Option 2: Custom syntax like !pdf[attachmentId](url) - needs parser rule
  // Option 3: Just the attachment URL (if easily obtainable)
  // Let's go with a simple placeholder for now.
  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    state.write(`\n\n[Embedded PDF: ${node.attrs.attachmentId}]\n\n`);
  }

  // Define how to parse this node from Markdown.
  // This needs a corresponding rule if we use custom syntax.
  // For now, we won't parse it back from the simple placeholder.
  parseMarkdown() {
    return null; // Or define parsing logic if using custom Markdown syntax
  }
}
