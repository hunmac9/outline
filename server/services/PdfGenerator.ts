import axios from "axios";
import FormData from "form-data";
import { ProsemirrorData } from "@shared/types";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { trace } from "@server/logging/tracing";
import { Document, Team } from "@server/models";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
// LogCategory is a type alias, not exported. Use string literal directly.

@trace()
class PdfGenerator {
  public async generatePdfForDocument(
    document: Document,
    team: Team
  ): Promise<Buffer> {
    // Use "task" string literal directly
    Logger.info("task", `Generating direct PDF for document: ${document.id}`);

    try {
      // Removed unused @ts-expect-error directive
      const node = ProsemirrorHelper.toProsemirror(document.content);
      const html = ProsemirrorHelper.toPdfHtml(node as any, {
        // Cast to any to bypass TS error temporarily
        title: document.title,
        includeStyles: true,
        includeMermaid: true,
        centered: true,
        baseUrl: team.url, // Use team URL for resolving relative links if any
      });

      const form = new FormData();
      form.append("files", Buffer.from(html, "utf8"), {
        filename: "index.html",
        contentType: "text/html",
      });
      // Add Gotenberg options - refer to Gotenberg docs for specifics
      form.append("marginTop", "0.5");
      form.append("marginBottom", "0.5");
      form.append("marginLeft", "0.5");
      form.append("marginRight", "0.5");
      form.append("paperWidth", "8.27"); // A4 width in inches
      form.append("paperHeight", "11.69"); // A4 height in inches
      form.append("printBackground", "true");
      // Wait for Mermaid rendering signal (if mermaid.js adds window.status = 'ready')
      form.append("waitForExpression", "window.status === 'ready'");
      // Increase timeout for complex pages or slow rendering
      form.append("waitTimeout", "30s");

      // Remove explicit type parameter, rely on responseType
      const response = await axios.post(
        `${env.GOTENBERG_URL}/forms/chromium/convert/html`,
        form,
        {
          headers: form.getHeaders(),
          responseType: "arraybuffer", // Crucial for receiving binary data
          // Increase overall request timeout if needed
          timeout: 90000,
        }
      );

      const pdfBuffer = Buffer.from(response.data);

      // Use "task" string literal directly
      Logger.info(
        "task",
        `Direct PDF generation successful for document: ${document.id}`
      );
      return pdfBuffer;
    } catch (err) {
      Logger.error("Direct PDF generation failed", err, {
        documentId: document.id,
      });
      throw err; // Re-throw the error to be handled by the API route
    }
  }
}

export default new PdfGenerator();
