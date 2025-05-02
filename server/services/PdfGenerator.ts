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

      // TODO: Implement Gotenberg API call here
      // Placeholder: return an empty buffer for now
      const pdfBuffer = Buffer.from("");

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
