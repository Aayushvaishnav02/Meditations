import { describe, expect, it } from "vitest"
import { parseQuickAdd } from "./parsing"

describe("parseQuickAdd", () => {
  it("extracts title, due, priority, list, tag and estimate (plan §6.1 example)", () => {
    const p = parseQuickAdd("Review Q3 budget tomorrow 3pm !1 #finance @urgent ~45m")
    expect(p.title).toBe("Review Q3 budget")
    expect(p.due_date).not.toBeNull()
    expect(p.priority).toBe(3) // !1 -> High
    expect(p.list_name).toBe("finance")
    expect(p.tags).toEqual(["urgent"])
    expect(p.estimated_minutes).toBe(45)
    expect(p.recurrence_rule).toBeNull()
  })

  it("maps !2 to medium and !3 to low", () => {
    expect(parseQuickAdd("task !2").priority).toBe(2)
    expect(parseQuickAdd("task !3").priority).toBe(1)
    expect(parseQuickAdd("task").priority).toBe(0)
  })

  it("parses hour-based durations", () => {
    expect(parseQuickAdd("deep work ~1h30m").estimated_minutes).toBe(90)
    expect(parseQuickAdd("deep work ~2h").estimated_minutes).toBe(120)
    expect(parseQuickAdd("quick call ~10m").estimated_minutes).toBe(10)
  })

  it("maps every <weekdays> to an RRULE", () => {
    expect(parseQuickAdd("gym every mon, wed").recurrence_rule).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,WE")
    expect(parseQuickAdd("standup every weekday").recurrence_rule).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
    expect(parseQuickAdd("sleep in every weekend").recurrence_rule).toBe("RRULE:FREQ=WEEKLY;BYDAY=SA,SU")
  })

  it("leaves 'every …' text alone when it is not a recurrence", () => {
    const p = parseQuickAdd("water every plant on the balcony")
    expect(p.recurrence_rule).toBeNull()
    expect(p.title).toContain("every plant")
  })

  it("collects multiple tags", () => {
    const p = parseQuickAdd("email Alex @work @deep")
    expect(p.tags).toEqual(["work", "deep"])
    expect(p.title).toBe("email Alex")
  })

  it("keeps plain text untouched", () => {
    const p = parseQuickAdd("read a chapter of Dune")
    expect(p.title).toBe("read a chapter of Dune")
    expect(p.due_date).toBeNull()
    expect(p.tags).toEqual([])
  })

  it("rolls a bare past time forward to tomorrow", () => {
    const p = parseQuickAdd("gym 9am")
    expect(p.due_date).not.toBeNull()
    const due = new Date(p.due_date!)
    // an implicit time reference must never land in the past
    expect(due.getTime()).toBeGreaterThan(Date.now() - 1000)
  })

  it("rolls a past weekday to next week", () => {
    // pick a weekday that has certainly passed this week
    const now = new Date()
    const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const p = parseQuickAdd(`meet alex ${names[yesterday.getDay()]} 3pm`)
    const due = new Date(p.due_date!)
    expect(due.getTime()).toBeGreaterThan(now.getTime())
  })
})
