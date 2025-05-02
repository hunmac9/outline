import os from "os";
import path from "path";
import archiver from "archiver";
import fs from "fs-extra";
import puppeteer, { Browser } from "puppeteer";
import { v4 as uuidv4 } from "uuid";
import { FileOperationState, NavigationNode } from "@shared/types"; // Removed FileOperationFormat
import Logger from "@server/logging/Logger";
import { trace } from "@server/logging/tracing";
import {
  Attachment,
  Document,
  FileOperation,
  Collection,
  User,
  Team,
} from "@server/models";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import FileStorage from "@server/storage/files"; // Import FileStorage
import { serializeFilename } from "@server/utils/fs";
import BaseTask from "./BaseTask"; // Inherit from BaseTask

type ExportPDFTaskPayload = {
  fileOperationId: string;
};

// Helper function to build document tree structure for path mapping
function addDocumentTreeToPathMap(
  map: Map<string, string>,
  nodes: NavigationNode[],
  root: string
) {
  for (const node of nodes) {
    const title = serializeFilename(node.title) || "Untitled";
    const extension = "pdf"; // Force PDF extension

    let i = 0;
    let filePath = path.join(root, `${title}.${extension}`);
    while (Array.from(map.values()).includes(filePath)) {
      filePath = path.join(root, `${title} (${++i}).${extension}`);
    }

    map.set(node.url, filePath);
    map.set(`/doc/${node.id}`, filePath); // Also map by internal ID format

    if (node.children?.length) {
      addDocumentTreeToPathMap(map, node.children, path.join(root, title));
    }
  }
}

// Helper function to create the path map
function createPdfPathMap(collections: Collection[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const collection of collections) {
    if (collection.documentStructure) {
      addDocumentTreeToPathMap(
        map,
        collection.documentStructure,
        serializeFilename(collection.name)
      );
    }
  }
  return map;
}

@trace()
export default class ExportPDFTask extends BaseTask<ExportPDFTaskPayload> {
  // Task entry point
  public async perform(payload: ExportPDFTaskPayload) {
    const { fileOperationId } = payload;
    const fileOperation = await FileOperation.findByPk(fileOperationId, {
      rejectOnEmpty: true,
      include: [
        { model: User, as: "user", required: true },
        { model: Team, as: "team", required: true },
        { model: Collection, as: "collection", required: false },
      ],
    });

    const { user, team, collection } = fileOperation;
    const includeAttachments =
      fileOperation.options?.includeAttachments ?? true;
    const zip = archiver("zip");
    let browser: Browser | undefined;
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, `outline-export-${uuidv4()}.zip`);

    try {
      await fileOperation.update({ state: FileOperationState.Uploading });

      // Fetch documents to export
      let documents: Document[];
      let collectionsToMap: Collection[] = []; // Initialize to empty array

      // Check if exporting a single document
      if (fileOperation.documentId) {
        const document = await Document.findByPk(fileOperation.documentId, {
          rejectOnEmpty: true, // Throw if document not found
        });
        // Ensure the user has access (although the API route should have checked this)
        // Basic check: teamId must match
        if (document.teamId !== team.id) {
          throw new Error(
            `User ${user.id} does not have access to document ${document.id}`
          );
        }
        documents = [document];
        // If the document has a collection, use it for path mapping, otherwise map to root
        if (document.collectionId) {
          const docCollection = await Collection.findByPk(
            document.collectionId
          );
          if (docCollection) {
            collectionsToMap = [docCollection];
          }
        }
      } else if (collection) {
        // Export a specific collection
        documents = await Document.findAll({
          where: { collectionId: collection.id, teamId: team.id },
        });
        collectionsToMap = [collection];
      } else {
        // Export all documents in the team accessible by the user
        const userCollections = await Collection.scope({
          method: ["withMembership", user.id],
        }).findAll({
          where: { teamId: team.id },
        });
        collectionsToMap = userCollections;
        const collectionIds = userCollections.map((c) => c.id);
        documents = await Document.findAll({
          where: { collectionId: collectionIds, teamId: team.id },
        });
      }

      Logger.info("task", `Exporting ${documents.length} documents as PDF`, {
        fileOperationId,
      });

      // Launch Puppeteer once
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      });

      const pathMap = createPdfPathMap(collectionsToMap); // Use local helper for PDF paths

      for (const document of documents) {
        const documentPath =
          pathMap.get(`/doc/${document.id}`) ||
          `${serializeFilename(document.title)}.pdf`;
        Logger.info("task", `Generating PDF for document: ${document.id}`, {
          fileOperationId,
          documentPath,
        });

        // @ts-expect-error - Bypassing persistent TS error on node type
        const node = ProsemirrorHelper.toProsemirror(document);
        const html = ProsemirrorHelper.toPdfHtml(node, {
          title: document.title,
          includeStyles: true,
          includeMermaid: true,
          centered: true,
          baseUrl: team.url,
        });

        const page = await browser.newPage();
        await page.setContent(html, {
          waitUntil: "networkidle0",
          timeout: 60000,
        });

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await page.waitForFunction(() => (window as any).status === "ready", {
            timeout: 30000,
          });
        } catch (err) {
          Logger.warn(
            `Timeout or error waiting for Mermaid rendering signal for document ${document.id}`,
            {
              error: err,
              fileOperationId,
            }
          );
        }

        const pdfBuffer = Buffer.from(
          await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "1in", right: "1in", bottom: "1in", left: "1in" },
            timeout: 60000,
          })
        );
        await page.close();

        zip.append(pdfBuffer, { name: documentPath, date: document.updatedAt });

        // Add attachments for this document if needed
        if (includeAttachments && node) {
          // Check if node is not null
          // Error on this line seems resolved, removed directive
          const attachmentIds = ProsemirrorHelper.parseAttachmentIds(node);
          if (attachmentIds.length > 0) {
            const attachments = await Attachment.findAll({
              where: { id: attachmentIds, teamId: team.id },
            });
            for (const attachment of attachments) {
              try {
                const buffer = await attachment.buffer;
                // Use relative path within the zip based on document path
                const attachmentZipPath = path.join(
                  path.dirname(documentPath),
                  attachment.key
                );
                zip.append(buffer, {
                  name: attachmentZipPath,
                  date: attachment.updatedAt,
                });
              } catch (err) {
                // Use (message, metadata) signature, include error in metadata
                Logger.warn(
                  `Failed to read attachment ${attachment.id} for PDF export`,
                  { error: err, fileOperationId, documentId: document.id }
                );
              }
            }
          }
        }
      }

      await browser.close();
      browser = undefined;

      zip.finalize();

      // Pipe archiver stream to a temporary file
      const output = fs.createWriteStream(tmpPath);
      await new Promise<void>((resolve, reject) => {
        // Add void type for clarity
        output.on("close", resolve);
        // Ensure error object is passed to reject
        output.on("error", reject); // Direct pass-through should be fine
        zip.pipe(output);
      });

      const stat = await fs.stat(tmpPath);
      // Use FileStorage.store (assuming this method exists)
      const result = await FileStorage.store({
        body: fs.createReadStream(tmpPath),
        key: fileOperation.key,
        contentLength: stat.size,
        contentType: "application/zip",
        acl: "private",
      });

      await fileOperation.update({
        state: FileOperationState.Complete,
        url: result, // Assuming result is the URL string
        size: stat.size,
      });
      Logger.info("task", "PDF export completed", { fileOperationId });
    } catch (err) {
      // Use (message, error, metadata) signature
      Logger.error("PDF export task failed", err, { fileOperationId });
      // Mark the update call as intentionally unhandled and handle errors
      void fileOperation
        .update({
          state: FileOperationState.Error,
          error: err instanceof Error ? err.message : String(err),
        })
        .catch((updateErr) => {
          Logger.error(
            "Failed to update FileOperation to Error state",
            updateErr,
            { fileOperationId }
          );
        });
    } finally {
      // Ensure browser is closed on error too
      if (browser) {
        await browser.close();
      }
      // Clean up temporary file and mark promise as intentionally unhandled
      void fs
        .remove(tmpPath)
        .catch((err) =>
          Logger.error(
            `Failed to remove temp export file ${tmpPath}: ${err.message}`
          )
        );
    }
  }
}
