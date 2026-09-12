import { Extension, type Editor, type Range } from "@tiptap/core"
import { PluginKey } from "@tiptap/pm/state"
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion"

export interface SlashItem {
  label: string
  hint: string
  keywords?: string
  command: (editor: Editor, range: Range) => void
}

export type AssistAction = "improve" | "continue" | "summarize"

function items(onActivity: (editor: Editor) => void, onAI: (editor: Editor, action: AssistAction) => void): SlashItem[] {
  return [
    {
      label: "Heading 1",
      hint: "Big section",
      command: (editor, range) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
    },
    {
      label: "Heading 2",
      hint: "Medium section",
      command: (editor, range) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
    },
    {
      label: "Heading 3",
      hint: "Small section",
      command: (editor, range) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
    },
    {
      label: "Bullet list",
      hint: "Simple list",
      command: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      label: "To-do list",
      hint: "Checkable items",
      keywords: "task checkbox",
      command: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      label: "Quote",
      hint: "Callout / highlight",
      command: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      label: "Code block",
      hint: "Monospace block",
      command: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      label: "Divider",
      hint: "Horizontal rule",
      command: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
    {
      label: "Day activity",
      hint: "Tasks done, focus time, habits",
      keywords: "embed rollup stats",
      command: (editor) => onActivity(editor),
    },
    {
      label: "AI: Improve entry",
      hint: "Rewrite clearer, keep your voice",
      keywords: "ai rewrite polish",
      command: (editor, range) => {
        editor.chain().focus().deleteRange(range).run()
        onAI(editor, "improve")
      },
    },
    {
      label: "AI: Continue writing",
      hint: "Pick up where you stopped",
      keywords: "ai continue",
      command: (editor, range) => {
        editor.chain().focus().deleteRange(range).run()
        onAI(editor, "continue")
      },
    },
    {
      label: "AI: Summarize entry",
      hint: "Short summary of the whole entry",
      keywords: "ai tldr summary",
      command: (editor, range) => {
        editor.chain().focus().deleteRange(range).run()
        onAI(editor, "summarize")
      },
    },
  ]
}

class SlashPopup {
  readonly el: HTMLDivElement
  private props: SuggestionProps<SlashItem> | null = null
  private selectedIndex = 0

  constructor() {
    this.el = document.createElement("div")
    this.el.className = "slash-menu"
    document.body.appendChild(this.el)
  }

  get filtered(): SlashItem[] {
    return this.props?.items ?? []
  }

  update(props: SuggestionProps<SlashItem>) {
    this.props = props
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, props.items.length - 1))
    this.render()
  }

  private render() {
    const items = this.filtered
    this.el.innerHTML = ""
    if (items.length === 0) {
      const empty = document.createElement("div")
      empty.className = "slash-menu-empty"
      empty.textContent = "No blocks match"
      this.el.appendChild(empty)
    }
    items.forEach((item, i) => {
      const row = document.createElement("button")
      row.type = "button"
      row.className = `slash-menu-item${i === this.selectedIndex ? " selected" : ""}`
      const label = document.createElement("span")
      label.textContent = item.label
      const hint = document.createElement("span")
      hint.className = "slash-menu-hint"
      hint.textContent = item.hint
      row.appendChild(label)
      row.appendChild(hint)
      row.onmousedown = (e) => {
        e.preventDefault()
        this.select(i)
      }
      this.el.appendChild(row)
    })
    this.position()
  }

  private position() {
    const rect = this.props?.clientRect?.()
    if (!rect) return
    const flip = rect.bottom + this.el.offsetHeight > window.innerHeight
    this.el.style.left = `${Math.min(rect.left, window.innerWidth - this.el.offsetWidth - 12)}px`
    if (flip) {
      this.el.style.top = `${rect.top - this.el.offsetHeight - 6}px`
    } else {
      this.el.style.top = `${rect.bottom + 6}px`
    }
  }

  onKeyDown({ event }: SuggestionKeyDownProps): boolean {
    if (event.key === "ArrowDown") {
      this.selectedIndex = (this.selectedIndex + 1) % Math.max(1, this.filtered.length)
      this.render()
      return true
    }
    if (event.key === "ArrowUp") {
      this.selectedIndex = (this.selectedIndex - 1 + Math.max(1, this.filtered.length)) % Math.max(1, this.filtered.length)
      this.render()
      return true
    }
    if (event.key === "Enter") {
      this.select(this.selectedIndex)
      return true
    }
    if (event.key === "Escape") {
      const props = this.props
      this.props = null
      this.el.innerHTML = ""
      if (props) props.editor.chain().focus().deleteRange(props.range).run()
      return true
    }
    return false
  }

  private select(index: number) {
    const props = this.props
    const item = this.filtered[index]
    if (!props || !item) return
    this.props = null
    this.el.innerHTML = ""
    props.command(item)
  }

  destroy() {
    this.el.remove()
  }
}

export const SlashCommands = Extension.create<{
  onActivity: (editor: Editor) => void
  onAI: (editor: Editor, action: AssistAction) => void
}>({
  name: "slashCommands",

  addOptions() {
    return { onActivity: () => {}, onAI: () => {} }
  },

  addProseMirrorPlugins() {
    const onActivity = this.options.onActivity
    const onAI = this.options.onAI
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommands"),
        char: "/",
        startOfLine: false,
        items: ({ query }) =>
          items(onActivity, onAI).filter((item) =>
            (item.label + " " + (item.keywords ?? "")).toLowerCase().includes(query.toLowerCase()),
          ),
        command: ({ editor, range, props }) => props.command(editor, range),
        render: () => {
          let popup: SlashPopup | null = null
          return {
            onStart: (props) => {
              popup = new SlashPopup()
              popup.update(props)
            },
            onUpdate: (props) => {
              popup?.update(props)
            },
            onKeyDown: (props) => popup?.onKeyDown(props) ?? false,
            onExit: () => {
              popup?.destroy()
              popup = null
            },
          }
        },
      }),
    ]
  },
})
