import { NodeSpec, NodeType, Node as ProsemirrorNode } from "prosemirror-model";
import { Command } from "prosemirror-state";
import * as React from "react";
// Assuming InlineBehaviorExample is the default export of TldrawEditor.tsx
// import InlineBehaviorExample from "../components/TldrawEditor"; // This line is now removed
import { MarkdownSerializerState } from "../lib/markdown/serializer";
import { ComponentProps } from "../types";
import Node from "./Node";

// Forward declaration for the component type, actual component loaded client-side
let LoadedInlineBehaviorExample: React.ComponentType<any> | undefined;

export default class TldrawInstance extends Node {
  private _cachedComponent: React.ComponentType<ComponentProps> | undefined;

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

  get component(): React.ComponentType<ComponentProps> | undefined {
    if (typeof window === 'undefined') {
      return undefined; // On server, no component is provided
    }

    if (!this._cachedComponent) {
      if (!LoadedInlineBehaviorExample) {
        // Dynamically require the component only on the client side
        LoadedInlineBehaviorExample = require('../components/TldrawEditor').default;
      }
      
      // The actual component function that Prosemirror will use for rendering
      this._cachedComponent = (props: ComponentProps) => {
        // props from ComponentView (node, view, getPos, etc.) are available here
        // LoadedInlineBehaviorExample (InlineBehaviorExample) doesn't use them directly currently
        if (!LoadedInlineBehaviorExample) {
          // This should ideally not happen if the component getter is called on client
          // and require works, but it's a good safeguard.
          return null; 
        }
        return <LoadedInlineBehaviorExample />;
      };
    }
    return this._cachedComponent;
  }

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
