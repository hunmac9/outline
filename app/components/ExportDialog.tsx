import { observer } from "mobx-react";
import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import {
  FileOperationFormat,
  NotificationEventType,
  ExportContentType, // Import ExportContentType
} from "@shared/types";
import Collection from "~/models/Collection";
import Document from "~/models/Document"; // Import Document model
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import env from "~/env";
import useCurrentUser from "~/hooks/useCurrentUser";
import useStores from "~/hooks/useStores";
import history from "~/utils/history";
// Removed incorrect imports for downloadFile and serializeFilename
import { settingsPath } from "~/utils/routeHelpers";
// We'll add a simple slugify function later if needed

type Props = {
  collection?: Collection;
  document?: Document; // Add document prop for single document export
  onSubmit: () => void;
};

// Update function signature to include document prop
function ExportDialog({ collection, document, onSubmit }: Props) {
  const [format, setFormat] = React.useState<FileOperationFormat>(
    FileOperationFormat.MarkdownZip
  );
  const [includeAttachments, setIncludeAttachments] =
    React.useState<boolean>(true);
  const user = useCurrentUser();
  const { collections } = useStores(); // Will add documents store later if needed
  const { t } = useTranslation();
  const appName = env.APP_NAME;

  const handleFormatChange = React.useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      setFormat(ev.target.value as FileOperationFormat);
    },
    []
  );

  const handleIncludeAttachmentsChange = React.useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      setIncludeAttachments(ev.target.checked);
    },
    []
  );

  // Simple slugify function for filenames
  const slugify = (text: string) =>
    text
      .toString()
      .toLowerCase()
      .replace(/\s+/g, "-") // Replace spaces with -
      .replace(/[^\w-]+/g, "") // Remove all non-word chars
      .replace(/--+/g, "-") // Replace multiple - with single -
      .replace(/^-+/, "") // Trim - from start of text
      .replace(/-+$/, ""); // Trim - from end of text

  const handleSubmit = async () => {
    // Direct PDF download for single document
    if (document && format === FileOperationFormat.PDF) {
      try {
        // Use the correct enum case ExportContentType.Pdf
        const response = await document.download(ExportContentType.Pdf);
        const blob = await response.blob(); // Get the blob from the response

        // Create a URL for the blob
        const url = window.URL.createObjectURL(blob);
        // Use window.document for DOM manipulation
        const a = window.document.createElement("a");
        a.style.display = "none";
        a.href = url;
        // Create a filename
        const filename = `${slugify(document.titleWithDefault)}.pdf`;
        a.download = filename;

        // Append the link to the body, click it, and remove it
        window.document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

        toast.success(t("PDF downloaded"));
        onSubmit(); // Close the dialog
      } catch (error) {
        toast.error(t("Failed to download PDF"), {
          description: error instanceof Error ? error.message : undefined,
        });
      }
      return; // Stop execution here for direct download
    }

    // Existing async export logic for collections or other formats
    if (collection) {
      await collection.export(format, includeAttachments);
      toast.success(t("Export started"), {
        description: t(`Your file will be available in {{ location }} soon`, {
          location: `"${t("Settings")} > ${t("Export")}"`,
        }),
        action: {
          label: t("View"),
          onClick: () => {
            history.push(settingsPath("export"));
          },
        },
      });
    } else if (!document) { // Check if it's a workspace export (no document, no collection)
      await collections.export(format, includeAttachments);
      toast.success(t("Workspace export started"));
    } else {
       // Handle non-PDF export for single document (use the document model's download method)
       // The original documents.export call was incorrect here.
       // We need to map FileOperationFormat back to ExportContentType
       let contentType: ExportContentType;
       if (format === FileOperationFormat.MarkdownZip) {
         contentType = ExportContentType.Markdown;
       } else if (format === FileOperationFormat.HTMLZip) {
         contentType = ExportContentType.Html; // Corrected enum case
       } else {
         // Handle JSON or other formats if needed, or throw error
         toast.error(t("Unsupported format for direct download"));
         return;
       }

       try {
         await document.download(contentType);
         // Since the non-PDF download is also direct (handled by browser via content-disposition)
         // we can show a direct success message.
         toast.success(t("Download started"));
       } catch (error) {
         toast.error(t("Failed to start download"), {
           description: error instanceof Error ? error.message : undefined,
         });
       }
    }
    onSubmit(); // Close the dialog for async exports
  };

  const items = [
    {
      title: "Markdown",
      description: t(
        "A ZIP file containing the images, and documents in the Markdown format."
      ),
      value: FileOperationFormat.MarkdownZip,
    },
    {
      title: "HTML",
      description: t(
        "A ZIP file containing the images, and documents as HTML files."
      ),
      value: FileOperationFormat.HTMLZip,
    },
    {
      title: "JSON",
      description: t(
        "Structured data that can be used to transfer data to another compatible {{ appName }} instance.",
        {
          appName,
        }
      ),
      value: FileOperationFormat.JSON,
    },
    {
      title: "PDF", // Add translation key later
      description: t(
        "A ZIP file containing the documents as PDF files, formatted for printing." // Add translation key later
      ),
      value: FileOperationFormat.PDF,
    },
  ];

  return (
    <ConfirmationDialog onSubmit={handleSubmit} submitText={t("Export")}>
      {collection && (
        <Text as="p">
          <Trans
            defaults="Exporting the collection <em>{{collectionName}}</em> may take some time."
            values={{
              collectionName: collection.name,
            }}
            components={{
              em: <strong />,
            }}
          />{" "}
          {user.subscribedToEventType(NotificationEventType.ExportCompleted) &&
            t("You will receive an email when it's complete.")}
        </Text>
      )}
      <Flex gap={12} column>
        {items.map((item) => (
          <Option key={item.value}>
            <input
              type="radio"
              name="format"
              value={item.value}
              checked={format === item.value}
              onChange={handleFormatChange}
            />
            <div>
              <Text as="p" size="small" weight="bold">
                {item.title}
              </Text>
              <Text size="small">{item.description}</Text>
            </div>
          </Option>
        ))}
      </Flex>
      <hr />
      <Option>
        <input
          type="checkbox"
          name="includeAttachments"
          checked={includeAttachments}
          onChange={handleIncludeAttachmentsChange}
        />
        <div>
          <Text as="p" size="small" weight="bold">
            {t("Include attachments")}
          </Text>
          <Text size="small">
            {t("Including uploaded images and files in the exported data")}.
          </Text>{" "}
        </div>
      </Option>
    </ConfirmationDialog>
  );
}

const Option = styled.label`
  display: flex;
  align-items: center;
  gap: 16px;

  p {
    margin: 0;
  }
`;

export default observer(ExportDialog);
