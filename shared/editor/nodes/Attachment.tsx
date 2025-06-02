import { Token } from "markdown-it";
import { DownloadIcon } from "outline-icons";
import { NodeSpec, NodeType, Node as ProsemirrorNode } from "prosemirror-model";
import { Command, NodeSelection } from "prosemirror-state";
import React, {Suspense, lazy} from 'react';
import { Trans } from "react-i18next";
import { Primitive } from "utility-types";
import { bytesToHumanReadable, getEventFiles } from "../../utils/files";
import { sanitizeUrl } from "../../utils/urls";
import insertFiles from "../commands/insertFiles";
import toggleWrap from "../commands/toggleWrap";
import FileExtension from "../components/FileExtension";
import Widget from "../components/Widget";
import { MarkdownSerializerState } from "../lib/markdown/serializer";
import attachmentsRule from "../rules/links";
import { ComponentProps } from "../types";
import Node from "./Node";

const PdfEmbedComponent = lazy(
  () => import('../components/PdfEmbed')
);

const PdfLoading = () => (
  <div style={{textAlign: 'center', padding: '20px'}}>Loading PDF...</div>
);

export default class Attachment extends Node {
  get name() {
    return "attachment";
  }

  get rulePlugins() {
    return [attachmentsRule];
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        id: {
          default: null,
        },
        href: {
          default: null,
        },
        title: {},
        size: {
          default: 0,
        },
        height: {
          default: 500,
        },
      },
      group: "block",
      defining: true,
      atom: true,
      parseDOM: [
        {
          priority: 100,
          tag: "a.attachment",
          getAttrs: (dom: HTMLAnchorElement) => ({
            id: dom.id,
            title: dom.innerText,
            href: dom.getAttribute("href"),
            size: parseInt(dom.dataset.size || "0", 10),
            height:
              dom.getAttribute("href") &&
              dom.getAttribute("href")!.toLowerCase().endsWith('.pdf') &&
              dom.dataset.height
                ? parseInt(dom.dataset.height, 10)
                : undefined,
          }),
        },
      ],
      toDOM: (node) => [
        "a",
        {
          class: `attachment`,
          id: node.attrs.id,
          href: sanitizeUrl(node.attrs.href),
          download: node.attrs.title,
          "data-size": node.attrs.size,
          ...(node.attrs.href && node.attrs.href.toLowerCase().endsWith('.pdf')
            ? {'data-height': node.attrs.height}
            : {}),
        },
        String(node.attrs.title),
      ],
      toPlainText: (node) => node.attrs.title,
    };
  }

  handleSelect =
    ({ getPos }: ComponentProps) =>
    () => {
      const { view } = this.editor;
      const $pos = view.state.doc.resolve(getPos());
      const transaction = view.state.tr.setSelection(new NodeSelection($pos));
      view.dispatch(transaction);
    };

  component = (props: ComponentProps) => {
    const { isSelected, isEditable, theme, node } = props;
    const { href, title, size, height } = node.attrs;

    const isPdf = href && href.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      return (
        <Suspense fallback={<PdfLoading />}>
          <PdfEmbedComponent
            href={href}
            height={height}
            onSelect={this.handleSelect(props)}
            theme={theme}
            isEditable={isEditable}
          />
        </Suspense>
      );
    }

    return (
      <Widget
        icon={<FileExtension title={title} />}
        href={href}
        title={title}
        onMouseDown={this.handleSelect(props)}
        onDoubleClick={() => {
          this.editor.commands.downloadAttachment();
        }}
        onClick={(event) => {
          if (isEditable) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        context={
          href ? (
            bytesToHumanReadable(size || "0")
          ) : (
            <>
              <Trans>Uploading</Trans>…
            </>
          )
        }
        isSelected={isSelected}
        theme={theme}
        node={node}
      >
        {href && !isEditable && <DownloadIcon size={20} />}
      </Widget>
    );
  };

  commands({ type }: { type: NodeType }) {
    return {
      createAttachment: (attrs: Record<string, Primitive>) =>
        toggleWrap(type, attrs),
      deleteAttachment: (): Command => (state, dispatch) => {
        dispatch?.(state.tr.deleteSelection());
        return true;
      },
      replaceAttachment: (): Command => (state) => {
        if (!(state.selection instanceof NodeSelection)) {
          return false;
        }
        const { view } = this.editor;
        const { node } = state.selection;
        const { uploadFile, onFileUploadStart, onFileUploadStop } =
          this.editor.props;

        if (!uploadFile) {
          throw new Error("uploadFile prop is required to replace attachments");
        }

        if (node.type.name !== "attachment") {
          return false;
        }

        // create an input element and click to trigger picker
        const inputElement = document.createElement("input");
        inputElement.type = "file";
        inputElement.onchange = (event) => {
          const files = getEventFiles(event);
          void insertFiles(view, event, state.selection.from, files, {
            uploadFile,
            onFileUploadStart,
            onFileUploadStop,
            dictionary: this.options.dictionary,
            replaceExisting: true,
          });
        };
        inputElement.click();
        return true;
      },
      downloadAttachment: (): Command => (state) => {
        if (!(state.selection instanceof NodeSelection)) {
          return false;
        }
        const { node } = state.selection;

        // create a temporary link node and click it
        const link = document.createElement("a");
        link.href = node.attrs.href;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();

        // cleanup
        document.body.removeChild(link);
        return true;
      },
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    state.ensureNewLine();
    state.write(
      `[${node.attrs.title} ${node.attrs.size}](${node.attrs.href})\n\n`
    );
    state.ensureNewLine();
  }

  parseMarkdown() {
    return {
      node: "attachment",
      getAttrs: (tok: Token) => {
        const href = tok.attrGet("href");
        const linkText = tok.children?.[0]?.content || "";
        let title = linkText;
        let size = 0;

        // Try to match "[title pdf:size]"
        const pdfMatch = linkText.match(/^(.*?) +pdf:(\d+)$/i);
        if (pdfMatch) {
          title = pdfMatch[1].trim();
          size = parseInt(pdfMatch[2], 10);
        } else {
          // Try to match "[title size]"
          const genericMatch = linkText.match(/^(.*?) +(\d+)$/);
          if (genericMatch) {
            title = genericMatch[1].trim();
            size = parseInt(genericMatch[2], 10);
          }
        }

        // Fallback for title if no specific pattern matches, but href exists
        if (!title && href) {
          // Attempt to derive title from href (e.g., filename)
          const parts = href.split('/');
          const lastPart = parts.pop();
          if (lastPart) {
            // Remove query parameters or hash
            title = lastPart.split('?')[0].split('#')[0];
            // Decode URI components like %20 for space
            try {
              title = decodeURIComponent(title);
            } catch (e) {
              // If decoding fails, use the raw part
            }
          } else {
            title = "Attachment";
          }
        } else if (!title) {
          title = "Attachment";
        }

        return {
          href,
          title,
          size,
        };
      },
    };
  }
}
