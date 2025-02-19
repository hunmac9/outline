export class EventHelper {
  public static ACTIVITY_EVENTS = [
    "collections.create",
    "collections.delete",
    "collections.move",
    "collections.permission_changed",
    "collections.add_user",
    "collections.remove_user",
    "documents.publish",
    "documents.unpublish",
    "documents.archive",
    "documents.unarchive",
    "documents.move",
    "documents.delete",
    "documents.permanent_delete",
    "documents.restore",
    "documents.add_user",
    "documents.remove_user",
    "revisions.create",
    "users.create",
    "users.demote",
    "userMemberships.update",
  ] as const;

  public static AUDIT_EVENTS = [
    "api_keys.create",
    "api_keys.delete",
    "authenticationProviders.update",
    "collections.create",
    "collections.update",
    "collections.permission_changed",
    "collections.move",
    "collections.add_user",
    "collections.remove_user",
    "collections.add_group",
    "collections.remove_group",
    "collections.delete",
    "documents.create",
    "documents.publish",
    "documents.update",
    "documents.archive",
    "documents.unarchive",
    "documents.move",
    "documents.delete",
    "documents.permanent_delete",
    "documents.restore",
    "documents.add_user",
    "documents.remove_user",
    "documents.add_group",
    "documents.remove_group",
    "groups.create",
    "groups.update",
    "groups.delete",
    "pins.create",
    "pins.update",
    "pins.delete",
    "revisions.create",
    "shares.create",
    "shares.update",
    "shares.revoke",
    "teams.update",
    "users.create",
    "users.update",
    "users.signin",
    "users.signout",
    "users.promote",
    "users.demote",
    "users.invite",
    "users.suspend",
    "users.activate",
    "users.delete",
    "fileOperations.create",
    "fileOperations.delete",
    "webhookSubscriptions.create",
    "webhookSubscriptions.delete",
  ] as const;
}
