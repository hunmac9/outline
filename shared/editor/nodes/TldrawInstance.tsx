import { NodeSpec, NodeType, Node as ProsemirrorNode } from "prosemirror-model";
import { Command } from "prosemirror-state";
import * as React from "react";
const { lazy, Suspense } = React;
// Note: The static import of TldrawEditor is removed.
// It will be dynamically imported via React.lazy.
import { MarkdownSerializerState } from "../lib/markdown/serializer";
import { ComponentProps } from "../types"; // ComponentProps from Prosemirror
import Node from "./Node";

// Dynamically import the TldrawEditor component for client-side rendering
const LazyTldrawEditor = lazy(() => import('../components/TldrawEditor'));

// Wrapper component to provide Suspense fallback
const TldrawInstanceWrapper = (props: ComponentProps) => {
  // props here are from Prosemirror (node, view, getPos, etc.)
  // InlineBehaviorExample (default export of TldrawEditor) currently doesn't take these.
  // If it needed them, they could be passed down: <LazyTldrawEditor {...props} />
  return (
    <Suspense fallback={<div>Loading tldraw canvas...</div>}>
      <LazyTldrawEditor />
    </Suspense>
  );
};

export default class TldrawInstance extends Node {
  // private _cachedComponent: React.ComponentType<ComponentProps> | undefined; // This is now removed

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
    // Return the wrapper component that handles Suspense
    return TldrawInstanceWrapper;
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
