import { observer } from "mobx-react";
import { DOMParser as ProsemirrorDOMParser } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import * as React from "react";
import { mergeRefs } from "react-merge-refs";
import { Optional } from "utility-types";
import insertFiles from "~/scenes/EditorOnly/editor/commands/insertFiles";
import EditorContainer from "~/scenes/EditorOnly/components/Styles";
import { AttachmentPreset } from "~/scenes/EditorOnly/types";
import { ProsemirrorHelper } from "~/scenes/EditorOnly/utils/ProsemirrorHelper";
import { getDataTransferFiles } from "~/scenes/EditorOnly/utils/files";
import { AttachmentValidation } from "~/scenes/EditorOnly/validations/AttachmentValidation";
import ClickablePadding from "~/components/ClickablePadding";
import ErrorBoundary from "~/components/ErrorBoundary";
import type { Props as EditorProps, Editor as SharedEditor } from "~/scenes/EditorOnly/editor";
import { uploadFile, uploadFileFromUrl } from "~/scenes/EditorOnly/utils/appFiles";
import lazyWithRetry from "~/scenes/EditorOnly/utils/lazyWithRetry";

const LazyLoadedEditor = lazyWithRetry(() => import("~/scenes/EditorOnly/editor"));

export type Props = Optional<
  EditorProps,
  | "placeholder"
  | "defaultValue"
  | "embeds"
  | "dictionary"
  | "extensions"
  | "onClickLink" // Added onClickLink to Optional
>; // Removed shareId, embedsDisabled, onSynced, onPublish, editorStyle

function Editor(props: Props, ref: React.RefObject<SharedEditor> | null) {
  const { id, onChange } = props;
  const localRef = React.useRef<SharedEditor>();

  // Mock dictionary for now
  const dictionary = {
    addColumnAfter: "",
    addColumnBefore: "",
    addRowAfter: "",
    addRowBefore: "",
    alignCenter: "",
    alignLeft: "",
    alignRight: "",
    alignDefaultWidth: "",
    alignFullWidth: "",
    bulletList: "",
    checkboxList: "",
    codeBlock: "",
    codeCopied: "",
    codeInline: "",
    comment: "",
    copy: "",
    createLink: "",
    createLinkError: "",
    createNewDoc: "",
    createNewChildDoc: "",
    deleteColumn: "",
    deleteRow: "",
    deleteTable: "",
    deleteAttachment: "",
    download: "",
    downloadAttachment: "",
    replaceAttachment: "",
    deleteImage: "",
    downloadImage: "",
    replaceImage: "",
    em: "",
    embedInvalidLink: "",
    file: "",
    enterLink: "",
    h1: "",
    h2: "",
    h3: "",
    h4: "",
    heading: "",
    hr: "",
    image: "",
    fileUploadError: "",
    imageCaptionPlaceholder: "",
    info: "",
    infoNotice: "",
    link: "",
    linkCopied: "",
    mark: "",
    newLineEmpty: "",
    newLineWithSlash: "",
    noResults: "",
    openLink: "",
    goToLink: "",
    openLinkError: "",
    orderedList: "",
    pageBreak: "",
    pasteLink: "",
    pasteLinkWithTitle: () => "",
    placeholder: "",
    quote: "",
    removeLink: "",
    searchOrPasteLink: "",
    strikethrough: "",
    strong: "",
    subheading: "",
    sortAsc: "",
    sortDesc: "",
    table: "",
    exportAsCSV: "",
    toggleHeader: "",
    mathInline: "",
    mathBlock: "",
    tip: "",
    tipNotice: "",
    warning: "",
    warningNotice: "",
    success: "",
    successNotice: "",
    insertDate: "",
    insertTime: "",
    insertDateTime: "",
    indent: "",
    outdent: "",
    video: "",
    uploadPdf: "",
    untitled: "",
    none: "",
  };

  const handleUploadFile = React.useCallback(
    async (file: File | string) => {
      const options = {
        documentId: id,
        preset: AttachmentPreset.DocumentAttachment,
      };
      const result =
        file instanceof File
          ? await uploadFile(file, options)
          : await uploadFileFromUrl(file, options);
      return result.url;
    },
    [id]
  );

  const focusAtEnd = React.useCallback(() => {
    localRef?.current?.focusAtEnd();
  }, [localRef]);

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const files = getDataTransferFiles(event);

      const view = localRef?.current?.view;
      if (!view) {
        return;
      }

      const pos = TextSelection.near(
        view.state.doc.resolve(view.state.doc.nodeSize - 2)
      ).from;

      if (files.length === 0) {
        const text =
          event.dataTransfer.getData("text/html") ||
          event.dataTransfer.getData("text/plain");

        const dom = new DOMParser().parseFromString(text, "text/html");

        view.dispatch(
          view.state.tr.insert(
            pos,
            ProsemirrorDOMParser.fromSchema(view.state.schema).parse(dom)
          )
        );

        return;
      }

      const isSinglePdf =
        files.length === 1 && files[0].type === "application/pdf";
      const nodeType = isSinglePdf
        ? view.state.schema.nodes.pdf_document
        : undefined;

      const isAttachment = files.some(
        (file) => !AttachmentValidation.imageContentTypes.includes(file.type)
      );

      return insertFiles(view, event, pos, files, {
        uploadFile: handleUploadFile,
        onFileUploadStart: props.onFileUploadStart,
        onFileUploadStop: props.onFileUploadStop,
        dictionary, // Added dictionary
        isAttachment,
        nodeType,
      });
    },
    [
      localRef,
      props.onFileUploadStart,
      props.onFileUploadStop,
      handleUploadFile,
      dictionary, // Added dictionary dependency
    ]
  );

  const handleDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.preventDefault();
    },
    []
  );

  const handleChange = React.useCallback(
    (event: any) => {
      onChange?.(event);
    },
    [onChange]
  );

  const handleRefChanged = React.useCallback(
    (node: SharedEditor | null) => {
      // No-op
    },
    []
  );

  const paragraphs = React.useMemo(() => {
    if (props.readOnly && typeof props.value === "object") {
      return ProsemirrorHelper.getPlainParagraphs(props.value);
    }
    return undefined;
  }, [props.readOnly, props.value]);

  return (
    <ErrorBoundary component="div" reloadOnChunkMissing>
      <>
        {paragraphs ? (
          <EditorContainer
            rtl={props.dir === "rtl"}
            grow={props.grow}
            style={props.style}
            editorStyle={props.editorStyle}
          >
            <div className="ProseMirror">
              {paragraphs.map((paragraph: any, index: any) => (
                <p key={index} dir="auto">
                  {paragraph.content?.map((content: any) => content.text)}
                </p>
              ))}
            </div>
          </EditorContainer>
        ) : (
          <LazyLoadedEditor
            key={props.extensions?.length || 0}
            ref={mergeRefs([ref, localRef, handleRefChanged])}
            uploadFile={handleUploadFile}
            dictionary={dictionary}
            embeds={[]} // Provide empty array for embeds
            onClickLink={() => {}} // Provide no-op function for onClickLink
            {...props}
            onChange={handleChange}
            placeholder={props.placeholder || ""}
            defaultValue={props.defaultValue || ""}
          />
        )}
        {props.editorStyle?.paddingBottom && !props.readOnly && (
          <ClickablePadding
            onClick={props.readOnly ? undefined : focusAtEnd}
            onDrop={props.readOnly ? undefined : handleDrop}
            onDragOver={props.readOnly ? undefined : handleDragOver}
            minHeight={props.editorStyle.paddingBottom}
          />
        )}
      </>
    </ErrorBoundary>
  );
}

export default observer(React.forwardRef(Editor));
