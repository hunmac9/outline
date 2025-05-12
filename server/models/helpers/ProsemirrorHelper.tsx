import hljs from "highlight.js";
import { JSDOM } from "jsdom";
import katex from "katex";
import fs from "fs"; // Changed from fs/promises
import path from "path";
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
    // Generate base HTML using the toHTML method, which is known to work well for direct download.
    // Pass through relevant options.
    const baseHtml = ProsemirrorHelper.toHTML(node, {
      title: options?.title,
      includeStyles: options?.includeStyles, // Should be true to get EditorContainer styles
      includeMermaid: options?.includeMermaid,
      centered: options?.centered,
      baseUrl: options?.baseUrl,
    });

    const dom = new JSDOM(baseHtml);
    const doc = dom.window.document;

    // Inject PDF-specific font size for the body if desired,
    // but try to rely on toHTML's existing styles as much as possible.
    const pdfOverrideStyles = `
      body {
        font-size: 10pt; /* Base font for PDF */
        /* line-height: 1.4; /* Base line-height for PDF - consider if needed or if toHTML's is fine */
      }
      /* Ensure heading point sizes are applied for PDF if toHTML uses relative units */
      .ProseMirror h1 { font-size: 18pt !important; }
      .ProseMirror h2 { font-size: 16pt !important; }
      .ProseMirror h3 { font-size: 14pt !important; }
      .ProseMirror h4 { font-size: 12pt !important; }
      .ProseMirror h5 { font-size: 11pt !important; }
      .ProseMirror h6 { font-size: 10pt !important; }
    `;

    const styleElement = doc.createElement("style");
    styleElement.setAttribute("type", "text/css");
    styleElement.innerHTML = pdfOverrideStyles;
    doc.head.appendChild(styleElement);

    // Phase 1: Implement Server-Side Rendering (SSR) for KaTeX
    const mathInlineElements = doc.querySelectorAll("math-inline");
    mathInlineElements.forEach((el) => {
      const latexSource = el.textContent || "";
      try {
        const renderedHtml = katex.renderToString(latexSource, {
          displayMode: false,
          output: "html",
          throwOnError: false,
        });
        const span = doc.createElement("span");
        span.innerHTML = renderedHtml;
        // Replace current element with all children of the new span
        // as renderToString might return multiple top-level elements (though usually one wrapper)
        // or just text nodes if it's simple.
        // A common pattern is to replace the element with the first child of the rendered HTML container.
        // If renderedHtml is just text, it needs to be handled.
        // A safer way is to parse the renderedHtml into a fragment and replace.
        const tempDiv = doc.createElement("div");
        tempDiv.innerHTML = renderedHtml;
        const parent = el.parentNode;
        if (parent) {
          while (tempDiv.firstChild) {
            parent.insertBefore(tempDiv.firstChild, el);
          }
          parent.removeChild(el);
        }
      } catch (error) {
        Logger.error("KaTeX rendering error for inline math", error, {
          latex: latexSource,
        });
        el.innerHTML = `<span style="color:red;">KaTeX Error: ${
          (error as Error).message
        }</span>`;
      }
    });

    const mathDisplayElements = doc.querySelectorAll("math-display");
    mathDisplayElements.forEach((el) => {
      const latexSource = el.textContent || "";
      try {
        const renderedHtml = katex.renderToString(latexSource, {
          displayMode: true,
          output: "html",
          throwOnError: false,
        });
        const div = doc.createElement("div");
        div.innerHTML = renderedHtml;
        // Replace current element with the rendered HTML
        const parent = el.parentNode;
        if (parent) {
          while (div.firstChild) {
            parent.insertBefore(div.firstChild, el);
          }
          parent.removeChild(el);
        }
      } catch (error) {
        Logger.error("KaTeX rendering error for display math", error, {
          latex: latexSource,
        });
        el.innerHTML = `<div style="color:red;">KaTeX Error: ${
          (error as Error).message
        }</div>`;
      }
    });

    // Phase 2: Include KaTeX CSS Styles
    // This part needs to be async if we use fs.readFile, or we need to make toPdfHtml async
    // For now, let's assume we can make it async or handle the promise.
    // The original function is synchronous, so we'll need to change its signature.
    // However, the calling function in PdfGenerator.ts is async, so this should be fine.
    // Let's adjust toPdfHtml to be async.

    // The path to katex.min.css. This might need adjustment based on your project structure
    // and how node_modules are resolved at runtime.
    // Using require.resolve to get the path to the katex package and then construct the path to the CSS file.
    let katexCSS = "";
    try {
      const katexPackagePath = path.dirname(require.resolve("katex/package.json"));
      const katexCSSPath = path.join(katexPackagePath, "dist", "katex.min.css");
      katexCSS = fs.readFileSync(katexCSSPath, "utf8"); // Use readFileSync for now to keep it simple
                                                       // If this causes issues, we'll make the function async
      const katexStyleElement = doc.createElement("style");
      katexStyleElement.setAttribute("data-katex-styles", "true");
      katexStyleElement.innerHTML = katexCSS;
      doc.head.appendChild(katexStyleElement);
    } catch (error) {
      Logger.error("Could not read or inject katex.min.css", error);
      // Optionally, add a visible error or placeholder in the HTML
    }
    
    // Ensure `window.status = "ready"` script is present for Gotenberg.
    // toHTML's mermaid handling already includes this, but if mermaid is not included,
    // or to be absolutely sure, we can add it.
    // Check if a script setting window.status already exists from toHTML (mermaid case)
    let windowStatusScriptExists = false;
    const scripts = doc.body.querySelectorAll("script");
    scripts.forEach(script => {
      if (script.innerHTML.includes("window.status = \"ready\"")) {
        windowStatusScriptExists = true;
      }
    });

    if (!windowStatusScriptExists) {
      const readyScript = doc.createElement("script");
      readyScript.innerHTML = `window.status = "ready";`;
      doc.body.appendChild(readyScript);
    }
    
    return dom.serialize();
  }
}
