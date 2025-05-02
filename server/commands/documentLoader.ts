import invariant from "invariant";
import { Op, WhereOptions } from "sequelize";
import isUUID from "validator/lib/isUUID";
import { UrlHelper } from "@shared/utils/UrlHelper";
import {
  NotFoundError,
  InvalidRequestError,
  AuthorizationError,
  AuthenticationError,
  PaymentRequiredError,
} from "@server/errors";
import { Collection, Document, Share, User, Team } from "@server/models";
import { authorize, can } from "@server/policies";

type Props = {
  id?: string;
  shareId?: string;
  teamId?: string;
  user?: User;
  includeState?: boolean;
};

type Result = {
  document: Document;
  share?: Share;
  collection?: Collection | null;
};

export default async function loadDocument({
  id,
  shareId,
  teamId,
  user,
  includeState,
}: Props): Promise<Result> {
  let document;
  let collection;
  let share;

  if (!shareId && !(id && user)) {
    throw AuthenticationError(`Authentication or shareId required`);
  }

  const shareUrlId =
    shareId && !isUUID(shareId) && UrlHelper.SHARE_URL_SLUG_REGEX.test(shareId)
      ? shareId
      : undefined;

  if (shareUrlId && !teamId) {
    throw InvalidRequestError(
      "teamId required for fetching share using shareUrlId"
    );
  }

  if (shareId) {
    let whereClause: WhereOptions<Share> = {
      revokedAt: {
        [Op.is]: null,
      },
      id: shareId,
    };
    if (shareUrlId) {
      whereClause = {
        revokedAt: {
          [Op.is]: null,
        },
        teamId,
        urlId: shareUrlId,
      };
    }
    share = await Share.findOne({
      where: whereClause,
      include: [
        {
          // unscoping here allows us to return unpublished documents
          model: Document.unscoped(),
          include: [
            {
              model: User,
              as: "createdBy",
              paranoid: false,
            },
            {
              model: User,
              as: "updatedBy",
              paranoid: false,
            },
          ],
          required: true,
          as: "document",
        },
        {
          model: Team,
          as: "team",
          required: true,
        },
      ],
    });

    if (!share || share.document?.archivedAt) {
      throw InvalidRequestError("Document could not be found for shareId");
    }

    // It is possible to pass both an id and a shareId to the documents.info
    // endpoint. In this case we'll load the document based on the `id` and check
    // if the provided share token allows access. This is used by the frontend
    // to navigate nested documents from a single share link.
    if (id) {
      document = await Document.findByPk(id, {
        userId: user ? user.id : undefined,
        paranoid: false,
      }); // otherwise, if the user has an authenticated session make sure to load
      // with their details so that we can return the correct policies, they may
      // be able to edit the shared document
    } else if (user) {
      document = await Document.findByPk(share.documentId, {
        userId: user.id,
        paranoid: false,
        // Ensure team is included here too
        include: [
          {
            model: Team,
            as: "team",
            required: true,
          },
        ],
      });
    } else {
      document = share.document;
      // Eager load team if it wasn't loaded via findByPk
      // Add null check for document before accessing properties
      if (document && !document.team) {
        // Remove invalid rejectOnEmpty option and handle potential null return
        const team = await document.$get("team");
        invariant(team, "Team not found for document");
      }
    }

    if (!document) {
      throw NotFoundError("Document could not be found for shareId");
    }

    if (document.isTrialImport) {
      throw PaymentRequiredError();
    }

    // If the user has access to read the document, we can just update
    // the last access date and return the document without additional checks.
    const canReadDocument = user && can(user, "read", document);

    if (canReadDocument) {
      // Cannot use document.collection here as it does not include the
      // documentStructure by default through the relationship.
      if (document.collectionId) {
        collection = await Collection.findByPk(document.collectionId);

        if (!collection) {
          throw NotFoundError("Collection could not be found for document");
        }
      }

      return {
        document,
        share,
        collection,
      };
    }

    // "published" === on the public internet.
    // We already know that there's either no logged in user or the user doesn't
    // have permission to read the document, so we can throw an error.
    if (!share.published) {
      throw AuthorizationError();
    }

    // It is possible to disable sharing at the collection so we must check
    if (document.collectionId) {
      collection = await Collection.findByPk(document.collectionId);
    }
    invariant(collection, "collection not found");

    if (!collection.sharing) {
      throw AuthorizationError();
    }

    // If we're attempting to load a document that isn't the document originally
    // shared then includeChildDocuments must be enabled and the document must
    // still be active and nested within the shared document
    if (share.documentId !== document.id) {
      if (!share.includeChildDocuments) {
        throw AuthorizationError();
      }

      // If the document is not a direct child of the shared document then we
      // need to check if it is nested within the shared document somewhere.
      if (document.parentDocumentId !== share.documentId) {
        const childDocumentIds =
          (await share.document?.findAllChildDocumentIds({
            archivedAt: {
              [Op.is]: null,
            },
          })) ?? [];

        if (!childDocumentIds.includes(document.id)) {
          throw AuthorizationError();
        }
      }
    }

    // It is possible to disable sharing at the team level so we must check
    const team = await Team.findByPk(document.teamId, { rejectOnEmpty: true });

    if (team.suspendedAt) {
      throw NotFoundError();
    }
    if (!team.sharing) {
      throw AuthorizationError();
    }
  } else {
    document = await Document.findByPk(id as string, {
      userId: user ? user.id : undefined,
      paranoid: false,
      includeState,
      // Ensure team is included when loading by ID directly
      include: [
        {
          model: Team,
          as: "team",
          required: true,
        },
      ],
    });

    if (!document) {
      throw NotFoundError();
    }

    if (document.deletedAt) {
      // don't send data if user cannot restore deleted doc
      user && authorize(user, "restore", document);
    } else {
      // If not deleted, authorize read access (already done above when loading)
      user && authorize(user, "read", document);
    }

    // Collection is already loaded via the include statement in findByPk
    collection = document.collection;
  }

  return {
    document,
    share,
    collection,
  };
}
