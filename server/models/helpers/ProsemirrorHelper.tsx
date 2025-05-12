import hljs from "highlight.js";
import { JSDOM } from "jsdom";
import katex from "katex";
import compact from "lodash/compact";
import flatten from "lodash/flatten";
import isMatch from "lodash/isMatch";
import uniq from "lodash/uniq";
import { Node, DOMSerializer, Fragment } from "prosemirror-model";
import * as React from "react";
import { renderToString } from "react-dom/server";
import styled, { ServerStyleSheet, ThemeProvider } from "styled-components";
import { prosemirrorToYDoc } from "y-prosemirror";
import * as Y from "yjs";
// Import CSS as strings for injection - adjust paths if necessary
// Assuming CSS files are available relative to this file or configured via build tool
// import katexCss from 'katex/dist/katex.min.css';
// import hljsCss from 'highlight.js/styles/default.css'; // Choose a theme

// Content of highlight.js/styles/github.css
const hljsGithubCss = `
pre code.hljs {
  display: block;
  overflow-x: auto;
  padding: 1em
}
code.hljs {
  padding: 3px 5px
}
/*!
  Theme: GitHub
  Description: Light theme as seen on github.com
  Author: github.com
  Maintainer: @Hirse
  Updated: 2021-05-15

  Outdated base version: https://github.com/primer/github-syntax-light
  Current colors taken from GitHub's CSS
*/
.hljs {
  color: #24292e;
  background: #ffffff
}
.hljs-doctag,
.hljs-keyword,
.hljs-meta .hljs-keyword,
.hljs-template-tag,
.hljs-template-variable,
.hljs-type,
.hljs-variable.language_ {
  /* prettylights-syntax-keyword */
  color: #d73a49
}
.hljs-title,
.hljs-title.class_,
.hljs-title.class_.inherited__,
.hljs-title.function_ {
  /* prettylights-syntax-entity */
  color: #6f42c1
}
.hljs-attr,
.hljs-attribute,
.hljs-literal,
.hljs-meta,
.hljs-number,
.hljs-operator,
.hljs-variable,
.hljs-selector-attr,
.hljs-selector-class,
.hljs-selector-id {
  /* prettylights-syntax-constant */
  color: #005cc5
}
.hljs-regexp,
.hljs-string,
.hljs-meta .hljs-string {
  /* prettylights-syntax-string */
  color: #032f62
}
.hljs-built_in,
.hljs-symbol {
  /* prettylights-syntax-variable */
  color: #e36209
}
.hljs-comment,
.hljs-code,
.hljs-formula {
  /* prettylights-syntax-comment */
  color: #6a737d
}
.hljs-name,
.hljs-quote,
.hljs-selector-tag,
.hljs-selector-pseudo {
  /* prettylights-syntax-entity-tag */
  color: #22863a
}
.hljs-subst {
  /* prettylights-syntax-storage-modifier-import */
  color: #24292e
}
.hljs-section {
  /* prettylights-syntax-markup-heading */
  color: #005cc5;
  font-weight: bold
}
.hljs-bullet {
  /* prettylights-syntax-markup-list */
  color: #735c0f
}
.hljs-emphasis {
  /* prettylights-syntax-markup-italic */
  color: #24292e;
  font-style: italic
}
.hljs-strong {
  /* prettylights-syntax-markup-bold */
  color: #24292e;
  font-weight: bold
}
.hljs-addition {
  /* prettylights-syntax-markup-inserted */
  color: #22863a;
  background-color: #f0fff4
}
.hljs-deletion {
  /* prettylights-syntax-markup-deleted */
  color: #b31d28;
  background-color: #ffeef0
}
.hljs-char.escape_,
.hljs-link,
.hljs-params,
.hljs-property,
.hljs-punctuation,
.hljs-tag {
  /* purposely ignored */
  
}
`;

import EditorContainer from "@shared/editor/components/Styles";
import GlobalStyles from "@shared/styles/globals";
import light from "@shared/styles/theme";
import { MentionType, ProsemirrorData, UnfurlResponse } from "@shared/types";
import { attachmentRedirectRegex } from "@shared/utils/ProsemirrorHelper";
import parseDocumentSlug from "@shared/utils/parseDocumentSlug";
import { isRTL } from "@shared/utils/rtl";
import { isInternalUrl } from "@shared/utils/urls";
import { schema, parser } from "@server/editor";
import Logger from "@server/logging/Logger";
import { trace } from "@server/logging/tracing";
import Attachment from "@server/models/Attachment";
import FileStorage from "@server/storage/files";

export type HTMLOptions = {
  /** A title, if it should be included */
  title?: string;
  /** Whether to include style tags in the generated HTML (defaults to true) */
  includeStyles?: boolean;
  /** Whether to include mermaidjs scripts in the generated HTML (defaults to false) */
  includeMermaid?: boolean;
  /** Whether to include styles to center diff (defaults to true) */
  centered?: boolean;
  /** The base URL to use for relative links */
  baseUrl?: string;
};

// Define options specific to PDF HTML generation if needed
export type PdfHtmlOptions = HTMLOptions;

export type MentionAttrs = {
  type: MentionType;
  label: string;
  modelId: string;
  actorId: string | undefined;
  id: string;
  href?: string;
  unfurl?: UnfurlResponse[keyof UnfurlResponse];
};

@trace()
export class ProsemirrorHelper {
  /**
   * Returns the input text as a Y.Doc.
   *
   * @param markdown The text to parse
   * @returns The content as a Y.Doc.
   */
  static toYDoc(input: string | ProsemirrorData, fieldName = "default"): Y.Doc {
    if (typeof input === "object") {
      return prosemirrorToYDoc(
        ProsemirrorHelper.toProsemirror(input),
        fieldName
      );
    }

    const node = parser.parse(input);
    return node ? prosemirrorToYDoc(node, fieldName) : new Y.Doc();
  }

  /**
   * Returns the input Y.Doc encoded as a YJS state update.
   *
   * @param ydoc The Y.Doc to encode
   * @returns The content as a YJS state update
   */
  static toState(ydoc: Y.Doc) {
    return Buffer.from(Y.encodeStateAsUpdate(ydoc));
  }

  /**
   * Converts a plain object into a Prosemirror Node.
   *
   * @param data The ProsemirrorData object or string to parse.
   * @returns The content as a Prosemirror Node, or an empty node if input is invalid.
   */
  static toProsemirror(
    data: ProsemirrorData | string | null | undefined
  ): Node {
    if (typeof data === "string") {
      try {
        const parsed = parser.parse(data);
        return parsed || Node.fromJSON(schema, { type: "doc", content: [] }); // Return empty doc if parse fails
      } catch (error) {
        Logger.error(
          "Failed to parse markdown string in toProsemirror",
          error,
          { input: data }
        );
        return Node.fromJSON(schema, { type: "doc", content: [] }); // Fallback to empty doc
      }
    }

    if (!data || typeof data !== "object" || !data.type) {
      Logger.warn(
        "Invalid or null data passed to toProsemirror, returning empty document.",
        { data }
      );
      return Node.fromJSON(schema, { type: "doc", content: [] }); // Return empty doc for null/invalid input
    }

    try {
      // Attempt to create the node from JSON
      return Node.fromJSON(schema, data);
    } catch (error) {
      // Log the error and the problematic data structure
      Logger.error("Failed to create Node from JSON in toProsemirror", error, {
        data,
      });
      // Return an empty document node as a fallback
      return Node.fromJSON(schema, { type: "doc", content: [] });
    }
  }

  /**
   * Returns an array of attributes of all mentions in the node.
   *
   * @param node The node to parse mentions from
   * @param options Attributes to use for filtering mentions
   * @returns An array of mention attributes
   */
  static parseMentions(doc: Node, options?: Partial<MentionAttrs>) {
    const mentions: MentionAttrs[] = [];

    const isApplicableNode = (node: Node) => {
      if (node.type.name !== "mention") {
        return false;
      }

      if (
        (options?.type && options.type !== node.attrs.type) ||
        (options?.modelId && options.modelId !== node.attrs.modelId)
      ) {
        return false;
      }

      return !mentions.some((m) => m.id === node.attrs.id);
    };

    doc.descendants((node: Node) => {
      if (isApplicableNode(node)) {
        mentions.push(node.attrs as MentionAttrs);
        return false;
      }

      if (!node.content.size) {
        return false;
      }

      return true;
    });

    return mentions;
  }

  /**
   * Returns an array of document IDs referenced through links or mentions in the node.
   *
   * @param node The node to parse document IDs from
   * @returns An array of document IDs
   */
  static parseDocumentIds(doc: Node) {
    const identifiers: string[] = [];

    doc.descendants((node: Node) => {
      if (
        node.type.name === "mention" &&
        node.attrs.type === MentionType.Document &&
        !identifiers.includes(node.attrs.modelId)
      ) {
        identifiers.push(node.attrs.modelId);
        return true;
      }

      if (node.type.name === "text") {
        // get marks for text nodes
        node.marks.forEach((mark) => {
          // any of the marks identifiers?
          if (mark.type.name === "link") {
            const slug = parseDocumentSlug(mark.attrs.href);

            // don't return the same link more than once
            if (slug && !identifiers.includes(slug)) {
              identifiers.push(slug);
            }
          }
        });
      }

      if (!node.content.size) {
        return false;
      }

      return true;
    });

    return identifiers;
  }

  /**
   * Find the nearest ancestor block node which contains the mention.
   *
   * @param doc The top-level doc node of a document / revision.
   * @param mention The mention for which the ancestor node is needed.
   * @returns A new top-level doc node with the ancestor node as the only child.
   */
  static getNodeForMentionEmail(doc: Node, mention: MentionAttrs) {
    let blockNode: Node | undefined;
    const potentialBlockNodes = [
      "table",
      "checkbox_list",
      "heading",
      "paragraph",
    ];

    const isNodeContainingMention = (node: Node) => {
      let foundMention = false;

      node.descendants((childNode: Node) => {
        if (
          childNode.type.name === "mention" &&
          isMatch(childNode.attrs, mention)
        ) {
          foundMention = true;
          return false;
        }

        // No need to traverse other descendants once we find the mention.
        if (foundMention) {
          return false;
        }

        return true;
      });

      return foundMention;
    };

    doc.descendants((node: Node) => {
      // No need to traverse other descendants once we find the containing block node.
      if (blockNode) {
        return false;
      }

      if (potentialBlockNodes.includes(node.type.name)) {
        if (isNodeContainingMention(node)) {
          blockNode = node;
        }
        return false;
      }

      return true;
    });

    // Use the containing block node to maintain structure during serialization.
    // Minify to include mentioned child only.
    if (blockNode && !["heading", "paragraph"].includes(blockNode.type.name)) {
      const children: Node[] = [];

      blockNode.forEach((child: Node) => {
        if (isNodeContainingMention(child)) {
          children.push(child);
        }
      });

      blockNode = blockNode.copy(Fragment.fromArray(children));
    }

    // Return a new top-level "doc" node to maintain structure during serialization.
    return blockNode ? doc.copy(Fragment.fromArray([blockNode])) : undefined;
  }

  /**
   * Removes all marks from the node that match the given types.
   *
   * @param data The ProsemirrorData object to remove marks from
   * @param marks The mark types to remove
   * @returns The content with marks removed
   */
  static removeMarks(doc: Node | ProsemirrorData, marks: string[]) {
    const json = "toJSON" in doc ? (doc.toJSON() as ProsemirrorData) : doc;

    function removeMarksInner(node: ProsemirrorData) {
      if (node.marks) {
        node.marks = node.marks.filter((mark) => !marks.includes(mark.type));
      }
      if (node.content) {
        node.content.forEach(removeMarksInner);
      }
      return node;
    }
    return removeMarksInner(json);
  }

  static async replaceInternalUrls(
    doc: Node | ProsemirrorData,
    basePath: string
  ) {
    const json = "toJSON" in doc ? (doc.toJSON() as ProsemirrorData) : doc;

    if (basePath.endsWith("/")) {
      throw new Error("internalUrlBase must not end with a slash");
    }

    function replaceUrl(url: string) {
      return url.replace(`/doc/`, `${basePath}/doc/`);
    }

    function replaceInternalUrlsInner(node: ProsemirrorData) {
      if (typeof node.attrs?.href === "string") {
        node.attrs.href = replaceUrl(node.attrs.href);
      } else if (node.marks) {
        node.marks.forEach((mark) => {
          if (
            typeof mark.attrs?.href === "string" &&
            isInternalUrl(mark.attrs?.href)
          ) {
            mark.attrs.href = replaceUrl(mark.attrs.href);
          }
        });
      }

      if (node.content) {
        node.content.forEach(replaceInternalUrlsInner);
      }

      return node;
    }

    return replaceInternalUrlsInner(json);
  }

  /**
   * Returns the document as a plain JSON object with attachment URLs signed.
   *
   * @param node The node to convert to JSON
   * @param teamId The team ID to use for signing
   * @param expiresIn The number of seconds until the signed URL expires
   * @returns The content as a JSON object
   */
  static async signAttachmentUrls(doc: Node, teamId: string, expiresIn = 60) {
    const attachmentIds = ProsemirrorHelper.parseAttachmentIds(doc);
    const attachments = await Attachment.findAll({
      where: {
        id: attachmentIds,
        teamId,
      },
    });

    const mapping: Record<string, string> = {};

    await Promise.all(
      attachments.map(async (attachment) => {
        const signedUrl = await FileStorage.getSignedUrl(
          attachment.key,
          expiresIn
        );
        mapping[attachment.redirectUrl] = signedUrl;
      })
    );

    const json = doc.toJSON() as ProsemirrorData;

    function getMapping(href: string) {
      let relativeHref;

      try {
        const url = new URL(href);
        relativeHref = url.toString().substring(url.origin.length);
      } catch {
        // Noop: Invalid url.
      }

      for (const originalUrl of Object.keys(mapping)) {
        if (
          href.startsWith(originalUrl) ||
          relativeHref?.startsWith(originalUrl)
        ) {
          return mapping[originalUrl];
        }
      }

      return href;
    }

    function replaceAttachmentUrls(node: ProsemirrorData) {
      if (node.attrs?.src) {
        node.attrs.src = getMapping(String(node.attrs.src));
      } else if (node.attrs?.href) {
        node.attrs.href = getMapping(String(node.attrs.href));
      } else if (node.marks) {
        node.marks.forEach((mark) => {
          if (mark.attrs?.href) {
            mark.attrs.href = getMapping(String(mark.attrs.href));
          }
        });
      }

      if (node.content) {
        node.content.forEach(replaceAttachmentUrls);
      }

      return node;
    }

    return replaceAttachmentUrls(json);
  }

  /**
   * Returns an array of attachment IDs in the node.
   *
   * @param node The node to parse attachments from
   * @returns An array of attachment IDs
   */
  static parseAttachmentIds(doc: Node) {
    const urls: string[] = [];

    doc.descendants((node) => {
      node.marks.forEach((mark) => {
        if (mark.type.name === "link") {
          if (mark.attrs.href) {
            urls.push(mark.attrs.href);
          }
        }
      });
      if (["image", "video"].includes(node.type.name)) {
        if (node.attrs.src) {
          urls.push(node.attrs.src);
        }
      }
      if (node.type.name === "attachment") {
        if (node.attrs.href) {
          urls.push(node.attrs.href);
        }
      }
    });

    return uniq(
      compact(
        flatten(
          urls.map((url) =>
            [...url.matchAll(attachmentRedirectRegex)].map(
              (match) => match.groups?.id
            )
          )
        )
      )
    );
  }

  /**
   * Returns the node as HTML. This is a lossy conversion and should only be used
   * for export.
   *
   * @param node The node to convert to HTML
   * @param options Options for the HTML output
   * @returns The content as a HTML string
   */
  static toHTML(node: Node, options?: HTMLOptions) {
    const sheet = new ServerStyleSheet();
    let html = "";
    let styleTags = "";

    const Centered = options?.centered
      ? styled.article`
          max-width: 46em;
          margin: 0 auto;
          padding: 0 1em;
        `
      : "article";

    const rtl = isRTL(node.textContent);
    const content = <div id="content" className="ProseMirror" />;
    const children = (
      <>
        {options?.title && <h1 dir={rtl ? "rtl" : "ltr"}>{options.title}</h1>}
        {options?.includeStyles !== false ? (
          <EditorContainer dir={rtl ? "rtl" : "ltr"} rtl={rtl} staticHTML>
            {content}
          </EditorContainer>
        ) : (
          content
        )}
      </>
    );

    // First render the containing document which has all the editor styles,
    // global styles, layout and title.
    try {
      html = renderToString(
        sheet.collectStyles(
          <ThemeProvider theme={light}>
            <>
              {options?.includeStyles === false ? (
                <article>{children}</article>
              ) : (
                <>
                  <GlobalStyles staticHTML />
                  <Centered>{children}</Centered>
                </>
              )}
            </>
          </ThemeProvider>
        )
      );
      styleTags = sheet.getStyleTags();
    } catch (error) {
      Logger.error("Failed to render styles on node HTML conversion", error);
    } finally {
      sheet.seal();
    }

    // Render the Prosemirror document using virtual DOM and serialize the
    // result to a string
    const dom = new JSDOM(
      `<!DOCTYPE html>${
        options?.includeStyles === false ? "" : styleTags
      }${html}`
    );
    const doc = dom.window.document;
    const target = doc.getElementById("content");

    if (target) {
      const fragment = doc.createDocumentFragment();
      DOMSerializer.fromSchema(schema).serializeFragment(
        node.content,
        { document: doc },
        fragment
      );
      target.appendChild(fragment);
    } else {
      Logger.error("Target #content element not found for HTML serialization", new Error("Target #content element not found for HTML serialization"));
    }

    // Convert relative urls to absolute
    if (options?.baseUrl) {
      const selectors = [
        "a[href]",
        "img[src]",
        "video[src]",
        "audio[src]",
        "iframe[src]",
        "script[src]",
      ];
      const elements = doc.querySelectorAll(selectors.join(", "));

      for (const el of elements) {
        if (el instanceof HTMLAnchorElement || el instanceof HTMLAreaElement) {
          if (
            el.href &&
            (el.href.startsWith("/") ||
              el.href.includes("/api/attachments.redirect?id="))
          ) {
            try {
              const fullUrl = new URL(
                el.href.startsWith("/")
                  ? el.href
                  : el.href.substring(el.href.indexOf("/api/")),
                options.baseUrl
              ).toString();
              el.href = fullUrl;
            } catch (e) {
              Logger.warn("Failed to construct absolute URL for HTML (href)", {
                currentUrl: el.href,
                baseUrl: options.baseUrl,
                error: e,
              });
            }
          }
        } else if (
          el instanceof HTMLImageElement ||
          el instanceof HTMLScriptElement ||
          el instanceof HTMLIFrameElement ||
          el instanceof HTMLMediaElement // Catches <audio>, <video>
        ) {
          if (
            el.src &&
            (el.src.startsWith("/") ||
              el.src.includes("/api/attachments.redirect?id="))
          ) {
            try {
              const fullUrl = new URL(
                el.src.startsWith("/")
                  ? el.src
                  : el.src.substring(el.src.indexOf("/api/")),
                options.baseUrl
              ).toString();
              el.src = fullUrl;
            } catch (e) {
              Logger.warn("Failed to construct absolute URL for HTML (src)", {
                currentUrl: el.src,
                baseUrl: options.baseUrl,
                error: e,
              });
            }
          }
        }
      }
    }

    // Inject mermaidjs scripts if the document contains mermaid diagrams
    if (options?.includeMermaid) {
      const mermaidElements = dom.window.document.querySelectorAll(
        `[data-language="mermaidjs"] pre code`
      );

      // Unwrap <pre> tags to enable Mermaid script to correctly render inner content
      for (const el of mermaidElements) {
        const parent = el.parentNode as HTMLElement;
        if (parent) {
          while (el.firstChild) {
            parent.insertBefore(el.firstChild, el);
          }
          parent.removeChild(el);
          parent.setAttribute("class", "mermaid");
        }
      }

      const element = dom.window.document.createElement("script");
      element.setAttribute("type", "module");

      // Inject Mermaid script
      if (mermaidElements.length) {
        element.innerHTML = `
          import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
          mermaid.initialize({
            startOnLoad: true,
            fontFamily: "inherit",
          });
          window.status = "ready";
        `;
      } else {
        element.innerHTML = `
          window.status = "ready";
        `;
      }

      dom.window.document.body.appendChild(element);
    }

    return dom.serialize();
  }

  /**
   * Returns the node as HTML specifically formatted for PDF generation.
   * Includes server-side rendering for math and code, and placeholders for embeds.
   *
   * @param node The node to convert to HTML
   * @param options Options for the HTML output
   * @returns The content as a HTML string suitable for PDF conversion
   */
  static toPdfHtml(node: Node, options?: PdfHtmlOptions): string {
    const sheet = new ServerStyleSheet();
    let html = "";
    let styleTags = "";

    const pdfSpecificCss = `
      body {
        font-size: 10pt; /* Base font for PDF */
        line-height: 1.4; /* Base line-height for PDF */
      }
      /* PDF-specific font sizes for headings. Margins and line-heights should primarily come from EditorContainer styles. */
      .ProseMirror h1 { font-size: 18pt !important; }
      .ProseMirror h2 { font-size: 16pt !important; }
      .ProseMirror h3 { font-size: 14pt !important; }
      .ProseMirror h4 { font-size: 12pt !important; }
      .ProseMirror h5 { font-size: 11pt !important; }
      .ProseMirror h6 { font-size: 10pt !important; }

      /* Let EditorContainer styles primarily handle paragraph and list styling. */
      /* Avoid broad white-space overrides here as they conflict. */
      
      /* Minimal list styling if EditorContainer doesn't cover it adequately for PDF. */
      /* These might be re-introduced if lists are still problematic after removing broader overrides. */
      /*
      .ProseMirror ul, .ProseMirror ol {
        padding-left: 20px; 
        margin-bottom: 1em;
      }
      .ProseMirror li {
        list-style-position: outside;
        padding-left: 5px; 
        margin-bottom: 0.5em; 
      }
      .ProseMirror li p {
        margin-top: 0;
        margin-bottom: 0.25em; 
      }
      .ProseMirror li p:last-child {
        margin-bottom: 0;
      }
      */

      /* Code block font size can be adjusted here if needed, but let hljs theme and EditorContainer handle most styling. */
      /* Example: .ProseMirror .code-block pre code.hljs { font-size: 9pt !important; } */
      
      .math-inline, .math-block {
        font-size: 10pt; /* Adjust math font size if needed */
      }
    `;

    // Order: 
    // 1. Styled-components base styles (will be collected by sheet.collectStyles and appended later)
    // 2. Highlight.js theme (for code syntax colors)
    // 3. pdfSpecificCss (for minimal PDF overrides like base font size and heading point sizes)
    
    let collectedStyleTags = ""; // Will hold styled-components styles

    // Inject KaTeX CSS if needed (example)
    // styleTags += `<style type="text/css">${katexCss}</style>`;

    // Start with highlight.js and our specific PDF CSS
    styleTags = `<style type="text/css">${hljsGithubCss}</style>`;
    styleTags += `<style type="text/css">${pdfSpecificCss}</style>`;

    const Centered = options?.centered
      ? styled.article`
          max-width: 46em;
          margin: 0 auto;
          padding: 0 1em;
        `
      : "article";

    const rtl = isRTL(node.textContent);
    const content = <div id="content" className="ProseMirror" />;
    const children = (
      <>
        {options?.title && <h1 dir={rtl ? "rtl" : "ltr"}>{options.title}</h1>}
        {options?.includeStyles !== false ? (
          <EditorContainer dir={rtl ? "rtl" : "ltr"} rtl={rtl} staticHTML>
            {content}
          </EditorContainer>
        ) : (
          content
        )}
      </>
    );

    try {
      html = renderToString(
        sheet.collectStyles(
          <ThemeProvider theme={light}>
            <>
              {options?.includeStyles === false ? (
                <article>{children}</article>
              ) : (
                <>
                  <GlobalStyles staticHTML />
                  <Centered>{children}</Centered>
                </>
              )}
            </>
          </ThemeProvider>
        )
      );
      collectedStyleTags = sheet.getStyleTags(); // Capture styled-components styles
    } catch (error) {
      Logger.error("Failed to render styles for PDF HTML conversion", error);
    } finally {
      sheet.seal();
    }

    // Append styled-components styles last so they form the base and can be specifically overridden
    styleTags += collectedStyleTags;

    const dom = new JSDOM(
      `<!DOCTYPE html><html><head><meta charset="utf-8">${styleTags}</head><body>${html}</body></html>`
    );
    const doc = dom.window.document;
    const target = doc.getElementById("content");

    if (!target) {
      Logger.error(
        "Target #content element not found for PDF HTML serialization", new Error("Target #content element not found for PDF HTML serialization")
      );
      return dom.serialize(); // Return what we have
    }

    // Custom serializer function to handle specific nodes
    const serializeNode = (
      nodeToSerialize: Node,
      targetElement: HTMLElement
    ) => {
      if (
        nodeToSerialize.type.name === "math_inline" ||
        nodeToSerialize.type.name === "math_block"
      ) {
        try {
          const isBlock = nodeToSerialize.type.name === "math_block";
          const renderedMath = katex.renderToString(
            nodeToSerialize.textContent || "",
            {
              displayMode: isBlock,
              throwOnError: false, // Don't throw errors, maybe log them
              output: "html", // Use HTML+MathML for better compatibility
            }
          );
          const span = doc.createElement(isBlock ? "div" : "span");
          span.className = `math ${isBlock ? "math-block" : "math-inline"}`;
          span.innerHTML = renderedMath;
          targetElement.appendChild(span);
        } catch (e) {
          Logger.warn("KaTeX rendering failed server-side", {
            error: e,
            latex: nodeToSerialize.textContent,
          });
          // Fallback: render the raw LaTeX source
          const fallback = doc.createElement(
            nodeToSerialize.type.name === "math_block" ? "div" : "span"
          );
          fallback.className = `math-error ${nodeToSerialize.type.name}`;
          fallback.textContent = nodeToSerialize.textContent;
          targetElement.appendChild(fallback);
        }
      } else if (nodeToSerialize.type.name === "code_block") {
        const language = nodeToSerialize.attrs.language || "plaintext";
        const code = nodeToSerialize.textContent || "";
        let highlightedCode;
        try {
          if (language === "mermaidjs") {
            // Keep mermaid code raw for client-side rendering via script
            highlightedCode = code;
          } else if (hljs.getLanguage(language)) {
            highlightedCode = hljs.highlight(code, {
              language,
              ignoreIllegals: true,
            }).value;
          } else {
            highlightedCode = hljs.highlightAuto(code).value; // Auto-detect if language not supported/found
          }
        } catch (e) {
          Logger.warn("Highlight.js rendering failed server-side", {
            error: e,
            language,
            code,
          });
          highlightedCode = code; // Fallback to raw code
        }

        const div = doc.createElement("div");
        div.className = `code-block language-${language}`; // Add language class for potential CSS
        div.dataset.language = language;
        const pre = doc.createElement("pre");
        const codeEl = doc.createElement("code");
        codeEl.innerHTML = highlightedCode; // Use innerHTML as highlight.js returns HTML
        codeEl.spellcheck = false;
        pre.appendChild(codeEl);
        div.appendChild(pre);
        targetElement.appendChild(div);
      } else if (nodeToSerialize.type.name === "embed") {
        const href = nodeToSerialize.attrs.href || "#";
        const placeholder = doc.createElement("div");
        placeholder.className = "embed-placeholder";
        const link = doc.createElement("a");
        link.href = href;
        link.textContent = `[Embed: ${href}]`;
        link.target = "_blank"; // Open in new tab
        placeholder.appendChild(link);
        // Optional: Add icon/thumbnail later
        targetElement.appendChild(placeholder);
      } else if (nodeToSerialize.isText) {
        // Handle text nodes directly
        targetElement.appendChild(
          doc.createTextNode(nodeToSerialize.text || "")
        );
      } else {
        // Default serialization for other nodes using DOMSerializer
        const serializer = DOMSerializer.fromSchema(schema);
        try {
          // Create a fragment of the node's content if it's a block node,
          // otherwise, create a fragment containing the node itself (for inline nodes with marks)
          const fragment = nodeToSerialize.isBlock
            ? nodeToSerialize.content
            : Fragment.from(nodeToSerialize);

          // Serialize the fragment into a temporary DocumentFragment
          const tempFragment = doc.createDocumentFragment();
          // Note: serializeFragment requires a Node or DocumentFragment as target.
          serializer.serializeFragment(
            fragment,
            { document: doc },
            tempFragment
          );

          // Append the serialized content from the fragment
          // to the target element
          targetElement.appendChild(tempFragment);
        } catch (e) {
          Logger.error(
            `Failed to serialize node type ${nodeToSerialize.type.name} for PDF`,
            e
          );
          // Optionally render text content as fallback
          if (nodeToSerialize.textContent) {
            targetElement.appendChild(
              doc.createTextNode(nodeToSerialize.textContent)
            );
          }
        }
      }
    };

    // Serialize the main document content using the custom function
    node.content.forEach((childNode) => serializeNode(childNode, target));

    // Convert relative urls to absolute (if base url provided)
    if (options?.baseUrl) {
      const selectors = ["a[href]", "img[src]", "video[src]", "audio[src]"];
      const elements = doc.querySelectorAll(selectors.join(", "));

      for (const el of elements) {
        let urlAttr = "";
        // Use type guards to safely check for properties
        if (
          el instanceof HTMLAnchorElement ||
          el instanceof HTMLAreaElement ||
          el instanceof HTMLLinkElement
        ) {
          if (typeof el.href === "string") {
            urlAttr = "href";
          }
        } else if (
          el instanceof HTMLImageElement ||
          el instanceof HTMLScriptElement ||
          el instanceof HTMLIFrameElement ||
          el instanceof HTMLMediaElement
        ) {
          if (typeof el.src === "string") {
            urlAttr = "src";
          }
        }

        if (urlAttr) {
          let currentUrlValue = "";
          let newUrlValue = "";

          // Access properties safely based on confirmed type
          if (
            urlAttr === "href" &&
            (el instanceof HTMLAnchorElement ||
              el instanceof HTMLAreaElement ||
              el instanceof HTMLLinkElement)
          ) {
            currentUrlValue = el.href;
            if (
              currentUrlValue.startsWith("/") ||
              currentUrlValue.includes("/api/attachments.redirect?id=")
            ) {
              try {
                newUrlValue = new URL(
                  currentUrlValue.startsWith("/")
                    ? currentUrlValue
                    : currentUrlValue.substring(
                        currentUrlValue.indexOf("/api/")
                      ),
                  options.baseUrl
                ).toString();
                el.href = newUrlValue; // Set property directly on typed element
              } catch (e) {
                Logger.warn("Failed to construct absolute URL for PDF (href)", {
                  currentUrl: currentUrlValue,
                  baseUrl: options.baseUrl,
                  error: e,
                });
              }
            }
          } else if (
            urlAttr === "src" &&
            (el instanceof HTMLImageElement ||
              el instanceof HTMLScriptElement ||
              el instanceof HTMLIFrameElement ||
              el instanceof HTMLMediaElement)
          ) {
            currentUrlValue = el.src;
            if (
              currentUrlValue.startsWith("/") ||
              currentUrlValue.includes("/api/attachments.redirect?id=")
            ) {
              try {
                newUrlValue = new URL(
                  currentUrlValue.startsWith("/")
                    ? currentUrlValue
                    : currentUrlValue.substring(
                        currentUrlValue.indexOf("/api/")
                      ),
                  options.baseUrl
                ).toString();
                el.src = newUrlValue; // Set property directly on typed element
              } catch (e) {
                Logger.warn("Failed to construct absolute URL for PDF (src)", {
                  currentUrl: currentUrlValue,
                  baseUrl: options.baseUrl,
                  error: e,
                });
              }
            }
          }
        }
      }
    }

    // Inject mermaidjs scripts if the document contains mermaid diagrams
    // (This part remains the same as the original toHTML)
    if (options?.includeMermaid) {
      const mermaidElements = doc.querySelectorAll(
        `[data-language="mermaidjs"] code` // Target the generated code element
      );

      if (mermaidElements.length > 0) {
        // Modify the container for mermaid rendering
        mermaidElements.forEach((el) => {
          const parentPre = el.parentElement; // pre
          const parentDiv = parentPre?.parentElement; // div.code-block
          if (parentDiv && parentPre) {
            parentDiv.innerHTML = el.innerHTML; // Move code content directly into div
            parentDiv.classList.add("mermaid"); // Add mermaid class for the script to find
            parentDiv.classList.remove("code-block", `language-mermaidjs`); // Remove code block classes
          }
        });

        const element = doc.createElement("script");
        element.setAttribute("type", "module");
        element.innerHTML = `
            try {
              await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(m => {
                m.default.initialize({
                  startOnLoad: false, // We call render explicitly
                  fontFamily: "inherit",
                  // Add any other necessary config
                });
                m.default.run({ nodes: document.querySelectorAll('.mermaid') });
              });
            } catch (e) {
              console.error("Mermaid failed to load or run", e);
            } finally {
              window.status = "ready"; // Signal completion regardless of mermaid success
            }
        `;
        doc.body.appendChild(element);
      } else {
        // Still need to signal ready even if no mermaid diagrams
        const element = doc.createElement("script");
        element.innerHTML = `window.status = "ready";`;
        doc.body.appendChild(element);
      }
    } else {
      // If mermaid isn't included, signal ready immediately
      const element = doc.createElement("script");
      element.innerHTML = `window.status = "ready";`;
      doc.body.appendChild(element);
    }

    return dom.serialize();
  }
}
