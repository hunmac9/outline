import { subMinutes } from "date-fns";
import { computed, action, observable } from "mobx";
import { now } from "mobx-utils";
import { UserPreferenceDefaults } from "@shared/constants";
import {
  NotificationEventDefaults,
  NotificationEventType,
  TeamPreference,
  UserPreference,
  UserPreferences,
  UserRole,
} from "@shared/types";
import type { NotificationSettings } from "@shared/types";
import { locales } from "@shared/utils/date";
import { client } from "~/utils/ApiClient";
import Document from "./Document";
import Group from "./Group";
import UserMembership from "./UserMembership";
import ParanoidModel from "./base/ParanoidModel";
import Field from "./decorators/Field";
import { Searchable } from "./interfaces/Searchable";

class User extends ParanoidModel implements Searchable {
  static modelName = "User";

  @Field
  @observable
  avatarUrl: string;

  @Field
  @observable
  name: string;

  @Field
  @observable
  color: string;

  @Field
  @observable
  language: keyof typeof locales;

  @Field
  @observable
  preferences: UserPreferences | null;

  @Field
  @observable
  notificationSettings: NotificationSettings;

  @Field
  @observable
  timezone?: string;

  @observable
  email: string;

  @observable
  role: UserRole;

  @observable
  lastActiveAt: string;

  @observable
  isSuspended: boolean;

  @computed
  get searchContent(): string[] {
    return [this.name, this.email].filter(Boolean);
  }

  @computed
  get initial(): string {
    return (this.name ? this.name[0] : "?").toUpperCase();
  }

  /**
   * Whether the user has been invited but not yet signed in.
   */
  get isInvited(): boolean {
    return !this.lastActiveAt;
  }

  /**
   * Whether the user is an admin.
   */
  get isAdmin(): boolean {
    return this.role === UserRole.Admin;
  }

  /**
   * Whether the user is a member (editor).
   */
  get isMember(): boolean {
    return this.role === UserRole.Member;
  }

  /**
   * Whether the user is a viewer.
   */
  get isViewer(): boolean {
    return this.role === UserRole.Viewer;
  }

  /**
   * Whether the user is a guest.
   */
  get isGuest(): boolean {
    return this.role === UserRole.Guest;
  }

  /**
   * Whether the user has been recently active. Recently is currently defined
   * as within the last 5 minutes.
   *
   * @returns true if the user has been active recently
   */
  @computed
  get isRecentlyActive(): boolean {
    return new Date(this.lastActiveAt) > subMinutes(now(10000), 5);
  }

  /**
   * Returns whether this user is using a separate editing mode behind an "Edit"
   * button rather than seamless always-editing.
   *
   * @returns True if editing mode is seamless (no button)
   */
  @computed
  get separateEditMode(): boolean {
    return !this.getPreference(
      UserPreference.SeamlessEdit,
      this.store.rootStore.auth?.team?.getPreference(
        TeamPreference.SeamlessEdit
      )
    );
  }

  /**
   * Returns the direct memberships that this user has to documents. Documents that the
   * user already has access to through a collection and trashed documents are not included.
   *
   * @returns A list of user memberships
   */
  @computed
  get documentMemberships(): UserMembership[] {
    const { userMemberships, documents, policies } = this.store.rootStore;
    return userMemberships.orderedData
      .filter(
        (m) => m.userId === this.id && m.sourceId === null && m.documentId
      )
      .filter((m) => {
        const document = documents.get(m.documentId!);
        const policy = document?.collectionId
          ? policies.get(document.collectionId)
          : undefined;
        return !policy?.abilities?.readDocument && !document?.isDeleted;
      });
  }

  @computed
  get groupsWithDocumentMemberships() {
    const { groups, groupUsers } = this.store.rootStore;

    return groupUsers.orderedData
      .filter((groupUser) => groupUser.userId === this.id)
      .map((groupUser) => groups.get(groupUser.groupId))
      .filter(Boolean)
      .filter((group) => group && group.documentMemberships.length > 0)
      .sort((a, b) => a!.name.localeCompare(b!.name)) as Group[];
  }

  /**
   * Returns the current preference for the given notification event type taking
   * into account the default system value.
   *
   * @param type The type of notification event
   * @returns The current preference
   */
  public subscribedToEventType = (type: NotificationEventType) =>
    this.notificationSettings[type] ?? NotificationEventDefaults[type] ?? false;

  /**
   * Sets a preference for the users notification settings on the model and
   * saves the change to the server.
   *
   * @param type The type of notification event
   * @param value Set the preference to true/false
   */
  @action
  setNotificationEventType = async (
    eventType: NotificationEventType,
    value: boolean
  ) => {
    this.notificationSettings = {
      ...this.notificationSettings,
      [eventType]: value,
    };

    if (value) {
      await client.post(`/users.notificationsSubscribe`, {
        eventType,
      });
    } else {
      await client.post(`/users.notificationsUnsubscribe`, {
        eventType,
      });
    }
  };

  /**
   * Get the value for a specific preference key, or return the fallback if
   * none is set.
   *
   * @param key The UserPreference key to retrieve
   * @returns The value
   */
  getPreference(key: UserPreference.BackgroundColor): string | null | undefined;

  getPreference(key: UserPreference, defaultValue?: boolean): boolean;
  getPreference(
    key: UserPreference,
    defaultValue?: boolean | string | null
  ): boolean | string | null | undefined {
    const value = this.preferences?.[key];

    if (key === UserPreference.BackgroundColor) {
      // Explicitly handle null/undefined for background color
      return value === undefined ? defaultValue : value;
    }

    // Handle boolean preferences
    return value ?? UserPreferenceDefaults[key] ?? defaultValue ?? false;
  }

  /**
   * Set the value for a specific preference key.
   *
   * Set the value for a specific preference key locally on the model.
   * Does not persist to the server, use savePreferences for that.
   *
   * @param key The UserPreference key to set
   * @param value The value to set
   */
  @action
  setPreference(key: UserPreference, value: boolean | string | null) {
    this.preferences = {
      ...this.preferences,
      [key]: value,
    };
  }

  /**
   * Saves one or more preferences to the server.
   *
   * @param prefs An object containing the preferences to update.
   */
  @action
  savePreferences = async (prefs: Partial<UserPreferences>) => {
    const previousPreferences = { ...this.preferences };

    // Update local state optimistically
    for (const key in prefs) {
      this.setPreference(
        key as UserPreference,
        prefs[key as UserPreference] as boolean | string | null
      );
    }

    try {
      await client.post("/users.update", {
        id: this.id,
        preferences: prefs,
      });
    } catch (error) {
      // Revert local state on error
      this.preferences = previousPreferences;
      throw error;
    }
  };

  getMembership(document: Document) {
    return this.store.rootStore.userMemberships.orderedData.find(
      (m) => m.documentId === document.id && m.userId === this.id
    );
  }
}

export default User;
