import puppeteer, { Browser } from "puppeteer";
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
    let browser: Browser | undefined;
    // Access NODE_ENV directly from process.env
    const isProduction = process.env.NODE_ENV === "production";

    // Use "task" string literal directly
    Logger.info("task", `Generating direct PDF for document: ${document.id}`);

    try {
      browser = await puppeteer.launch({
        headless: true,
        // Use the installed Chromium in production (set via ENV in Dockerfile)
        // Access PUPPETEER_EXECUTABLE_PATH directly from process.env
        executablePath: isProduction
          ? process.env.PUPPETEER_EXECUTABLE_PATH
          : undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage", // Recommended for Docker environments
        ],
      });

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

      const page = await browser.newPage();
      // Increased timeout for complex documents
      await page.setContent(html, {
        waitUntil: "networkidle0",
        timeout: 90000,
      });

      try {
        // Wait for Mermaid diagrams to render if present
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.waitForFunction(() => (window as any).status === "ready", {
          timeout: 45000, // Increased timeout
        });
      } catch (err) {
        Logger.warn(
          `Timeout or error waiting for Mermaid rendering signal during direct PDF export for document ${document.id}`,
          { error: err }
        );
        // Continue anyway, Mermaid diagrams might not be fully rendered
      }

      const pdfBuffer = Buffer.from(
        await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "1in", right: "1in", bottom: "1in", left: "1in" },
          timeout: 90000, // Increased timeout
        })
      );
      await page.close();
      await browser.close();
      browser = undefined; // Ensure it's marked as closed

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
    } finally {
      // Ensure browser is closed even if an error occurred mid-process
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          Logger.error("Failed to close browser during cleanup", closeError, {
            documentId: document.id,
          });
        }
      }
    }
  }
}

export default new PdfGenerator();
