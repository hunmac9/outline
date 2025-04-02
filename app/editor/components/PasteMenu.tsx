import { observer } from "mobx-react";
import { EmailIcon, LinkIcon } from "outline-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { v4 } from "uuid";
import { EmbedDescriptor } from "@shared/editor/embeds";
import { MenuItem } from "@shared/editor/types";
import Integration from "~/models/Integration";
import useCurrentUser from "~/hooks/useCurrentUser";
import useStores from "~/hooks/useStores";
import SuggestionsMenu, {
  Props as SuggestionsMenuProps,
} from "./SuggestionsMenu";
import SuggestionsMenuItem from "./SuggestionsMenuItem";

type Props = Omit<
  SuggestionsMenuProps,
  "renderMenuItem" | "items" | "embeds" | "trigger"
> & {
  pastedText: string;
  embeds: EmbedDescriptor[];
};

export const PasteMenu = observer(({ pastedText, embeds, ...props }: Props) => {
  const { t } = useTranslation();
  const { integrations } = useStores();
  const user = useCurrentUser();

  const url = pastedText ? new URL(pastedText) : undefined;

  const mentionType = url
    ? integrations
        .find((integration: Integration) => integration.isMentionable(url))
        ?.getMentionType(url)
    : undefined;

  const embed = React.useMemo(() => {
    for (const e of embeds) {
      const matches = e.matcher(pastedText);
      if (matches) {
        return e;
      }
    }
    return;
  }, [embeds, pastedText]);

  const items = React.useMemo(() => {
    const menuItems: MenuItem[] = [
      {
        name: "noop",
        title: t("Keep as link"),
        icon: <LinkIcon />,
      },
      {
        name: "embed",
        title: t("Embed"),
        icon: embed?.icon,
        keywords: embed?.keywords,
      },
    ];

    if (mentionType) {
      menuItems.push({
        name: "mention",
        title: t("Mention"),
        icon: <EmailIcon />,
        attrs: {
          id: v4(),
          type: mentionType,
          label: pastedText,
          href: pastedText,
          modelId: v4(),
          actorId: user.id,
        },
        appendSpace: true,
      });
    }

    return menuItems;
  }, [t, embed, mentionType, pastedText, user]);

  return (
    <SuggestionsMenu
      {...props}
      trigger=""
      filterable={false}
      renderMenuItem={(item, _index, options) => (
        <SuggestionsMenuItem
          onClick={options.onClick}
          selected={options.selected}
          title={item.title}
          icon={item.icon}
        />
      )}
      items={items}
    />
  );
});
