# Designing User-Facing Flows

How we design and review any user-facing flow or page: onboarding, importers,
settings, and pages of rules or data.

**The interface shows the user's world, not the system's.** A newcomer glances
at a page for five seconds and knows what it is for, how it works in outline,
and what to do next — without reading, and without learning how the system is
built.

When a page feels hard, the user is usually being made to reconstruct something 
the system already knows, or to work in the system's order instead of their own.

## Core principles

1. **The user's job, not the system's structure.** Name, group, and order by
   the user's goals and real-world objects, never by tables, modules, or
   pipeline stages. One real-world thing gets one place. Hiding the internals
   is the designer's job: find the arrangement that conveys what the system
   does for the user and what it needs from them. Explain a process only when
   the goal needs it, and then only its domain-level essence ("it sorts your
   transactions; you can teach it"), never the mechanics ("applies after the
   executable mappings"). Decide for the user whatever isn't genuinely theirs
   to decide; they should mostly do, not decide about the system.

2. **Show, don't tell.** Structure carries the meaning — order, size,
   grouping, nesting, what sits beside what — using patterns people already
   read without effort: grouped lists, master–detail, key–value rows, cards,
   tabs, progressive disclosure. Items grouped under what they lead to read as
   "these go there"; a section placed first reads as "this comes first". Words
   come last: few, precise, at the point of use. No diagrams, charts, or
   animations to explain the product; icons and colour only reinforce what the
   structure says. If the user must read to understand, the design isn't done.

3. **Little in mind at once.** Each unit — screen, step, section, card, popup —
   holds one or two cohesive concepts. Before laying out a page, list the two
   to four things a newcomer must come away understanding, in order, and give
   each a region, top to bottom; that list, not the data model, decides the
   layout. When there are several kinds of thing, show the kinds side by side
   (name, what it does, count; nesting and precedence visible) before any
   contents. Volume never decides layout: the overview fits one screen, and a
   large collection is summarized and opens on demand.

4. **A familiar surface with depth underneath.** Open on something the user
   already understands — their data as a list, a statement, a document — and
   reach power on demand: a selection, "more", a detail panel. Frame an
   unfamiliar artifact (AI instructions, a rule engine) in the arrangement the
   domain's software already uses; where that isn't enough, one real example
   beats a description. Simplicity should compress capability, but not remove it.

5. **One of each.** One job, one flow, from every entry point, surfaced by a
   button where the intent arises — no shortcut around required stages. One
   object, one presentation and one set of verbs wherever it appears; a parent
   behaves like its children. One source, many views: "needs review" and
   "failed" are filters and properties on the object, never separate pages or
   copies. One word per thing across UI, CLI, docs, and server messages. One
   navigation spine; things stay where they are. Test: having learned an
   object in one place, can the user predict it everywhere?

6. **Always lead to the next action.** Every screen says what to do next — the
   single next useful step, or nothing when done — with at most a one-line
   why. Offer an option only where it applies. Defaults and suggestions over
   open questions. Success is a working outcome, not comprehension.

## Flows

- **Separate jobs, separate flows.** Different urgency, scope, or frequency
  (first-time setup vs. adding one more account) means different containers;
  share sub-flows, not the frame.
- **One instance end to end.** Take one item through every stage, confirm it
  works, then offer "add another" — never one attribute across all items.
  Nobody sets up fifteen in one sitting.
- **The user's order.** Stages follow how a person reasons (pick it → name it
  → connect its source → check the numbers → review → commit), not how
  records are created.
- **Fast first value.** The fewest steps to one narrow, complete, working
  result; depth before breadth.
- **Works with no configuration.** Every setting has a working default and
  lives on the object it affects. The everyday action is never gated behind
  setup or a settings page.

## Interaction

- **Edit in place.** No edit modes, Save buttons, or property forms; a new
  object is created at once, cursor in its name. Keep a deliberate commit only
  where the domain has one (posting to the ledger, sending a payment).
- **Forgive, don't ask.** Reversible actions happen at once, with Undo.
  Confirm only what costs money or time or can't be undone, and the button
  states verb, count, and cost ("Categorize 40 transactions · ~1 min"), never
  "OK".
- **Status lives on the object.** Long work runs in the background; the object
  shows its state; completion is a brief notice with at most one action;
  failures land on the object and in the one place that lists what needs the
  user. Loading shows content-shaped placeholders. Out of date is a quiet fact
  with its fix, not an error.
- **Supervise the machine from leverage.** The user sets direction (rules,
  examples) and reviews by exception, each result beside its input — no
  item-by-item approval, no copy-paste between tools.
- **Keep the map visible.** Clickable things look clickable. Detail opens
  beside the list; siblings and the general case stay one click away; Back or
  Esc closes it. A detail view carries a compact header: what this is, what it
  applies to, what editing it changes.

## Visuals and copy

- **Content first.** At rest, show the user's content and only what is wrong.
  Per-item controls appear on hover, focus, or selection; primary actions and
  navigation stay visible. A page header shows the two to four facts used
  most, each stated once, the rest behind "N more".
- **Colour means something.** A neutral interface; colour for the user's
  content and a few fixed meanings, defined in one place — one for "a person
  must act", red for failed, the accent for the primary action, selection, and
  work in progress. Done is quiet. "One click fixes this" is neutral, not a
  warning. One indicator per item, with a count. If more than a handful of
  items on a screen carry the warning colour, the rule is wrong.
- **Few words, the user's words.** Sentence case. Labels one to three words,
  verb first; states one or two words; facts plus a time ("Imported 2 h
  ago"). No sentence under a control — fix the label or the concept instead.
  Placeholders hint by example. No trailing periods on labels. An empty state
  is one quiet line and its action ("No accounts yet · Add account").
  Discoverability comes from tooltips and a shortcuts sheet, not paragraphs.
  Keep the domain's names, and fix wrong wording at its source.

## How to work

1. **Picture the user arriving cold** — none of our vocabulary, no idea why
   the page exists. What job, what outcome, what order do they think in, where
   do they come from?
2. **Write the concept inventory** for each page (principle 3).
3. **Diagnose** against these principles with concrete evidence (screen,
   copy, field, route). If nothing fires, say so; no generic checklists. Apply
   this to plans too, flagging what a plan would bake in.
4. **Redesign end to end**: entry points, unit of work, order, wording, end
   state. Keep what works; where a page fails the glance test, reimagine it
   from the inventory rather than patching labels onto it.
5. **Check it in the running product** with real, long, messy data at several
   window sizes. Count what can be counted: warning colours on screen, the
   share of the idle screen that is the user's content, what falls below the
   fold. Blur a screenshot: does colour point where the user should look?

Think as a graphic designer, a UX expert, and a domain expert (personal
finance software) at once. For a large redesign, agree on the ideal flow and
the principles before implementing, then implement in one pass.
