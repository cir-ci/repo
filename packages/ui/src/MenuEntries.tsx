import { Menu as BaseMenu } from '@base-ui/react/menu'

import { CheckIcon } from './icons.ts'
import type { Menu } from './Menu.tsx'

import styles from './Menu.module.css'

function entryKeys(items: ReadonlyArray<Menu.Entry>) {
  return items.map((entry, index) => ({
    entry,
    key:
      entry.type === 'separator'
        ? `separator-${items.slice(0, index).filter((e) => e.type === 'separator').length}`
        : entry.type === 'content'
          ? `content-${entry.name}`
          : entry.type === 'radio-group' || entry.type === 'icon-row'
            ? `${entry.type}-${entry.name}`
            : `item-${entry.label}`,
  }))
}

/**
 * The entries of a menu popup, shared by `Menu` and `ContextMenu` so both look and behave the
 * same (Base UI's context menu parts are the menu's own).
 */
export function MenuEntries({ items }: { items: ReadonlyArray<Menu.Entry> }) {
  return entryKeys(items).map(({ entry, key }) =>
    entry.type === 'separator' ? (
      <BaseMenu.Separator key={key} className={styles.separator} />
    ) : entry.type === 'icon-row' ? (
      <div key={key} role="group" aria-label={entry.name} className={styles.iconRow}>
        {entry.items.map((item) => (
          <BaseMenu.Item
            key={item.label}
            className={styles.iconItem}
            aria-label={item.label}
            title={item.label}
            onClick={item.onSelect}
          >
            {item.icon}
          </BaseMenu.Item>
        ))}
      </div>
    ) : entry.type === 'content' ? (
      <div
        key={key}
        className={styles.content}
        // The control keeps its own arrow keys instead of the menu moving between items.
        onKeyDown={(event) => {
          if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End')
            event.stopPropagation()
        }}
      >
        {entry.node}
      </div>
    ) : entry.type === 'radio-group' ? (
      <BaseMenu.RadioGroup
        key={key}
        aria-label={entry.name}
        value={entry.value}
        onValueChange={(value) => entry.onValueChange(String(value))}
      >
        {entry.options.map((option) => (
          <BaseMenu.RadioItem
            key={option.value}
            value={option.value}
            closeOnClick={entry.closeOnClick}
            className={styles.item}
          >
            <span className={styles.label}>{option.label}</span>
            <BaseMenu.RadioItemIndicator className={styles.check}>
              <CheckIcon size={14} />
            </BaseMenu.RadioItemIndicator>
          </BaseMenu.RadioItem>
        ))}
      </BaseMenu.RadioGroup>
    ) : (
      <BaseMenu.Item
        key={key}
        className={styles.item}
        data-tone={entry.tone}
        disabled={entry.disabled}
        aria-keyshortcuts={entry.shortcut}
        aria-current={entry.current ? 'true' : undefined}
        onClick={entry.onSelect}
      >
        {entry.icon ? (
          <span className={styles.icon} aria-hidden="true">
            {entry.icon}
          </span>
        ) : null}
        <span className={styles.label}>{entry.label}</span>
        {entry.trailing ? (
          <span className={styles.trailing} aria-hidden="true">
            {entry.trailing}
          </span>
        ) : null}
        {entry.shortcut ? (
          <kbd className={styles.shortcut} aria-hidden="true">
            {entry.shortcut}
          </kbd>
        ) : null}
      </BaseMenu.Item>
    ),
  )
}
