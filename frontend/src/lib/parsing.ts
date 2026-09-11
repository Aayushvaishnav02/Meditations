import { en } from "chrono-node"
import type { Priority } from "@/api/types"

export interface ParsedQuickAdd {
  title: string
  due_date: string | null // ISO with offset
  priority: Priority
  tags: string[]
  list_name: string | null
  estimated_minutes: number | null
  recurrence_rule: string | null
}

const PRIORITY_MAP: Record<string, Priority> = { "1": 3, "2": 2, "3": 1, "0": 0 }

const WEEKDAY_CODES: Record<string, string> = {
  mon: "MO",
  tue: "TU",
  wed: "WE",
  thu: "TH",
  fri: "FR",
  sat: "SA",
  sun: "SU",
}

const DURATION_RE = /~\s*(\d+\s*(?:h|hr|hrs|hours?))?\s*(\d+\s*(?:m|min|mins|minutes?))?(?=\s|$)/i
const PRIORITY_RE = /!([0-3])(?!\d)/
const LIST_RE = /#([\w][\w-]*)/g
const TAG_RE = /@([\w][\w-]*)/g
const RECURRENCE_RE = /\bevery\s+([a-z][a-z,\s]*)/i

function parseDuration(text: string): { minutes: number | null; rest: string } {
  const match = DURATION_RE.exec(text)
  if (!match || (!match[1] && !match[2])) return { minutes: null, rest: text }
  const hours = match[1] ? Number.parseInt(match[1], 10) : 0
  const mins = match[2] ? Number.parseInt(match[2], 10) : 0
  const minutes = hours * 60 + mins
  return { minutes: minutes > 0 ? minutes : null, rest: text.slice(0, match.index) + text.slice(match.index + match[0].length) }
}

function parseRecurrence(text: string): { rule: string | null; rest: string } {
  const match = RECURRENCE_RE.exec(text)
  if (!match) return { rule: null, rest: text }
  const raw = match[1].trim().replace(/\s*,\s*/g, ",").toLowerCase()

  if (/^day(days)?$|^daily$/.test(raw)) return { rule: "RRULE:FREQ=DAILY", rest: drop(text, match) }
  if (/^weekdays?$/.test(raw))
    return { rule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", rest: drop(text, match) }
  if (/^weekends?$/.test(raw)) return { rule: "RRULE:FREQ=WEEKLY;BYDAY=SA,SU", rest: drop(text, match) }

  const days = raw
    .split(",")
    .map((d) => d.trim())
    .map((d) => WEEKDAY_CODES[d.slice(0, 3)])
    .filter(Boolean)
  if (days.length === 0) return { rule: null, rest: text }
  const unique = [...new Set(days)]
  // only full day-name sequences count; partial trailing text ("every monkey") is left alone
  const consumed = raw
    .split(",")
    .every((d) => WEEKDAY_CODES[d.trim().slice(0, 3)] !== undefined)
  if (!consumed) return { rule: null, rest: text }
  return { rule: `RRULE:FREQ=WEEKLY;BYDAY=${unique.join(",")}`, rest: drop(text, match) }
}

function drop(text: string, match: RegExpExecArray): string {
  return text.slice(0, match.index) + text.slice(match.index + match[0].length)
}

function parseDue(text: string): { due: string | null; rest: string } {
  const matches = en.parse(text, new Date(), { forwardDate: true })
  if (matches.length === 0) return { due: null, rest: text }
  const result = matches[0]
  const date = new Date(result.date()) // chrono 2.x: date is a method
  if (!result.start.isCertain("hour")) date.setHours(9, 0, 0, 0)

  // chrono keeps past bare-times and past weekdays even with forwardDate;
  // roll forward unless the user anchored an explicit calendar date.
  const anchored = result.start.isCertain("day") || result.start.isCertain("month")
  if (!anchored && date.getTime() < Date.now()) {
    date.setDate(date.getDate() + (result.start.isCertain("weekday") ? 7 : 1))
  }

  const rest = text.slice(0, result.index) + text.slice(result.index + result.text.length)
  return { due: date.toISOString(), rest }
}

/**
 * Quick-add shorthand (plan §6.1):
 *   `Review Q3 budget tomorrow 3pm !1 #finance @urgent ~45m every mon,wed`
 *   title | chrono-node dates | !priority | #list | @tags | ~estimate | every recurrence
 */
export function parseQuickAdd(input: string): ParsedQuickAdd {
  let rest = input

  const { minutes, rest: r1 } = parseDuration(rest)
  rest = r1

  let priority: Priority = 0
  const prioMatch = PRIORITY_RE.exec(rest)
  if (prioMatch) {
    priority = PRIORITY_MAP[prioMatch[1]]
    rest = drop(rest, prioMatch)
  }

  let list_name: string | null = null
  const listMatches = [...rest.matchAll(LIST_RE)]
  listMatches.forEach((m, i) => {
    if (i === 0) list_name = m[1]
    else return // extra # tokens fall through as tags below
  })
  // remove only the first # token
  if (list_name) {
    const first = new RegExp(`#${list_name}`).exec(rest)
    if (first) rest = drop(rest, first)
  }

  const tags = [...rest.matchAll(TAG_RE)].map((m) => m[1])
  if (tags.length > 0) {
    rest = rest.replace(TAG_RE, "")
  }

  const { rule, rest: r2 } = parseRecurrence(rest)
  rest = r2

  const { due, rest: r3 } = parseDue(rest)
  rest = r3

  const title = rest.replace(/\s{2,}/g, " ").trim()

  return {
    title: title || input.trim(),
    due_date: due,
    priority,
    tags,
    list_name,
    estimated_minutes: minutes,
    recurrence_rule: rule,
  }
}
