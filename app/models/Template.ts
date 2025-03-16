import type { ProsemirrorData } from "@shared/types";
import { isRTL } from "@shared/utils/rtl";
import slugify from "@shared/utils/slugify";
import { addDays } from "date-fns";
import i18n from "i18next";
import { computed, observable } from "mobx";
import TemplatesStore from "~/stores/TemplatesStore";
import User from "~/models/User";
import Collection from "./Collection";
import ParanoidModel from "./base/ParanoidModel";
import Field from "./decorators/Field";
import Relation from "./decorators/Relation";
import { Searchable } from "./interfaces/Searchable";

export default class Template extends ParanoidModel implements Searchable {
  static modelName = "Template";

  store: TemplatesStore;

  @observable.shallow
  data: ProsemirrorData;

  @computed
  get searchContent(): string {
    return this.title;
  }

  /**
   * The id of the collection that this document belongs to, if any.
   */
  @Field
  @observable
  collectionId?: string | null;

  /**
   * The collection that this document belongs to.
   */
  @Relation(() => Collection, { onDelete: "cascade" })
  collection?: Collection;

  /**
   * The title of the document.
   */
  @Field
  @observable
  title: string;

  /**
   * An icon (or) emoji to use as the document icon.
   */
  @Field
  @observable
  icon?: string | null;

  /**
   * The color to use for the document icon.
   */
  @Field
  @observable
  color?: string | null;

  /**
   * Whether the document layout is displayed full page width.
   */
  @Field
  @observable
  fullWidth: boolean;

  @Relation(() => User)
  createdBy: User | undefined;

  @Relation(() => User)
  @observable
  updatedBy: User | undefined;

  @observable
  publishedAt: string | undefined;

  @observable
  urlId: string;

  /**
   * Returns the direction of the template text, either "rtl" or "ltr"
   */
  @computed
  get dir(): "rtl" | "ltr" {
    return this.rtl ? "rtl" : "ltr";
  }

  /**
   * Returns true if the template text is right-to-left
   */
  @computed
  get rtl() {
    return isRTL(this.title);
  }

  @computed
  get path(): string {
    if (!this.title) {
      return `/settings/templates/untitled-${this.urlId}`;
    }

    const slugifiedTitle = slugify(this.title);
    return `/settings/templates/${slugifiedTitle}-${this.urlId}`;
  }

  @computed
  get isDeleted(): boolean {
    return !!this.deletedAt;
  }

  @computed
  get isDraft(): boolean {
    return !this.publishedAt;
  }

  @computed
  get hasEmptyTitle(): boolean {
    return this.title === "";
  }

  @computed
  get isWorkspaceTemplate(): boolean {
    return !this.collectionId;
  }

  @computed
  get permanentlyDeletedAt(): string | undefined {
    if (!this.deletedAt) {
      return undefined;
    }

    return addDays(new Date(this.deletedAt), 30).toString();
  }

  get titleWithDefault(): string {
    return this.title || i18n.t("Untitled");
  }

  @computed
  get isActive(): boolean {
    return !this.isDeleted;
  }
}
