import { NodeSpec, NodeType, Node as ProsemirrorNode } from "prosemirror-model";
import { Command } from "prosemirror-state";
import * as React from "react";
// Assuming InlineBehaviorExample is the default export of TldrawEditor.tsx
import InlineBehaviorExample from "../components/TldrawEditor";
import { MarkdownSerializerState } from "../lib/markdown/serializer";
import { ComponentProps } from "../types";
import Node from "./Node";

export default class TldrawInstance extends Node {
  get name() {
    return "tldraw_instance";
  }

  get schema(): NodeSpec {
    return {
      group: "block",
      atom: true,
      attrs: {
        // No attributes needed for now as InlineBehaviorExample is self-contained
      },
      parseDOM: [
        {
          tag: "div[data-tldraw-instance]",
          getAttrs: () => ({}),
        },
      ],
      toDOM: () => {
        return [
          "div",
          {
            "data-tldraw-instance": "true",
          },
          0, // Indicates a content hole, though atom nodes usually don't render children this way
        ];
      },
      toPlainText: () => "[tldraw Canvas]",
    };
  }

  component = (props: ComponentProps) => {
    // InlineBehaviorExample sets up its own context and multiple blocks.
    // props are passed in case it needs editor access in the future,
    // but currently InlineBehaviorExample is self-contained.
    return <InlineBehaviorExample />;
  };

  commands({ type }: { type: NodeType }) {
    return (): Command =>
      (state, dispatch) => {
        if (dispatch) {
          dispatch(
            state.tr.replaceSelectionWith(type.create()).scrollIntoView()
          );
        }
        return true;
      };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    // Basic placeholder for markdown representation
    state.write("\n\n```tldraw\n// tldraw content would go here\n```\n\n");
  }

  parseMarkdown() {
    return {
      node: this.name,
      getAttrs: () => ({}), // No attributes to parse from markdown for now
    };
  }
}
