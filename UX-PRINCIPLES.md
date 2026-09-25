# Designing User-Facing Flows

## Purpose

A discipline for designing and reviewing any user-facing flow or page — onboarding, setup, wizards, multi-step forms, importers, settings, checkout, and pages that present rules, configuration, or data — so the interface is organized around the user's jobs and outcomes, not the system's internal structure, and explains itself at a glance.

## Core idea

Every screen exists for a user trying to accomplish something. The interface is a means to an outcome, not a window onto the implementation. When a flow feels hard, it is usually because the user is being asked to reconstruct a concept the system already understands, or to work in an order that serves the system rather than their goal.

## How to operate

Given a flow (screens, steps, copy, or a plan), work in this order:

1. **Frame the user.** What job are they doing? What outcome do they want? What do they already know or believe? In what order do they think about it? What is the smallest *complete* unit of value? What internal concepts are they being made to learn? Where do they enter from? Picture them arriving cold: no knowledge of the system's internals, its vocabulary, or why the page exists.
2. **Inventory the concepts.** For each page, list the two to four things that newcomer must come away understanding without being told, in the order they must understand them (F1). This list, not the data model, decides the layout.
3. **Diagnose.** Walk the principles below. Cite concrete evidence for each one that fires (screen, step, copy, field, route).
4. **Prescribe.** State where, which principle, and the remedy drawn from the principle's standard.
5. **Redesign end-to-end.** Propose the ideal flow: entry points, unit of work, order of stages, wording, and the end state. Keep the parts that already work; where a page fails the glance test (F2), reimagine it from the concept inventory rather than patching labels onto the existing layout.
6. **Check it against reality.** Judge the design in the running product with real, long, messy data, at several window sizes — not in a mockup. Count what can be counted: warning colours on a screen (E5), how much of the idle screen is the user's content (E3), what falls below the fold (F5). Screenshots are for judgment; numbers catch regressions.

Do not produce a generic checklist. If nothing fires, say so. Apply the principles to plans too — flag what the plan would bake in if implemented as written.

---

## A. Framing: what the interface is about

### A1. Design around the user's job, not the system's structure
**You have this problem if:** step names, headings, grouping, field order, or vocabulary mirror the implementation (tables, modules, pipeline stages, entity attributes). A single real-world thing must be reassembled by the user from pieces scattered by where they happen to be stored.

**Standard:** Name and group by the user's object and goal. One real-world thing gets one place. If the system persists it across five tables, the interface still presents it as one concept. The interface vocabulary may differ from the code vocabulary; that is a feature.

### A2. Hide the plumbing
**You have this problem if:** the copy explains how the system works, exposes options that only an implementer cares about, or expects the user to reason about downstream implications of a choice. The user must understand the architecture to proceed.

**Standard:** Present only concepts the user brings from the real world. Suppress internal abstractions and design decisions. The user should never need to know how the system is built to use it. Finding a way to convey the essence of the system — what it does for the user and what it needs from them — without teaching its internals is the designer's job, not the user's. Put the power behind a surface the user already understands (a list, a document, a statement): the capability stays, reached through the familiar (E2).

### A3. Never conflate distinct jobs
**You have this problem if:** two different user goals share one screen or wizard because they touch the same data. First-time setup (establish a minimum foundation, urgent, once) and adding one more item (a routine operation, repeatable, low urgency) are different jobs.

**Standard:** Separate the containers. Share reusable sub-flows between them, not the frame. If two goals have different urgency, scope, or frequency, they are different flows.

### A4. Keep each unit within one or two cohesive concepts
**You have this problem if:** a screen, popup, step, section, card, or form asks the user to hold several unrelated ideas at once — mixing, say, identity, connectivity, and money in a single pane, or presenting settings, data entry, and explanation as one undifferentiated block. The user has to keep the whole thing in mind to act on any part of it.

**Standard:** Limit each unit to one or two major ideas, plus whatever closely related detail belongs to them. Related things may share a unit; unrelated things must not. A form, a settings pane, a workflow step, a card, and a popup are all the same kind of unit and obey the same limit. Humans hold only about five or six things in mind at once and actively process fewer, so the number of *distinct concepts* in view — not the number of controls — is what must stay small. Each unit should have a clear label that names the one or two concepts it is for, so the user can tell at a glance what belongs together and what does not.

### A5. When the goal needs a process understood, convey only its essence
*Subordinate to A2: first try to design the need away.*

**You have this problem if:** the user's goal genuinely depends on grasping a process at the level of the domain — they edit rules, instructions, or templates whose only purpose is to shape what the system does later — and the page gives them nothing to hold on to. Or it gives them the wrong thing: copy phrased in the system's terms ("applies after the executable mappings") that presumes knowledge of the internals.

**Standard:** Convey the smallest domain-level understanding the goal requires, and nothing of the implementation behind it: what the system does on the user's behalf, what the user's input changes about it, and — only if it affects what the user should do — which part acts first. Carry it mostly through the page's arrangement (the order of sections, what sits next to what, what the input is placed beside) and at most a caption of plain words. If the user could reach their goal without the explanation, remove the explanation.

---

## B. Sequencing: the order of work

### B1. Finish one instance before starting the next
**You have this problem if:** the flow advances one *attribute* across all items (names step, then settings step, then verification step), leaving a field of half-built items and deferring all validation and feedback.

**Standard:** When work varies on two axes — many instances and several stages per instance — iterate instances in the outer loop and stages in the inner loop. Take one item all the way through every stage, confirm it works, then offer to add the next. "One item in one go."

### B2. Order stages by the user's mental order, not the schema's
**You have this problem if:** the sequence follows the order in which records are created or modules execute, rather than the order a person reasons about the task.

**Standard:** Match the natural narrative: pick the thing → give it its identity → connect its source → confirm its numbers → review → commit. Each stage should produce a fact the next stage relies on, in the way a person would verify it.

### B3. Optimize time to first value
**You have this problem if:** onboarding asks for breadth (configure everything) before the user has seen the system do anything useful. Value arrives only at the end of a long setup.

**Standard:** Reach a complete, working outcome in the fewest steps, even if narrow. Prefer depth over breadth: one fully working item beats many partially configured ones. Ask only for the minimum that demonstrates value, then let the user repeat the flow. Nobody completes ten or fifteen instances in one sitting; design for one, then "add another."

---

## C. Consistency: the same job everywhere

### C1. One job, one flow, every entry point
**You have this problem if:** the same job can be done by a guided flow from one place and by a manual path from another; the manual path skips stages, so the user discovers the missing pieces later with no guidance. Or the obvious intent has no visible starting point.

**Standard:** Regardless of where intent arises — onboarding, a call-to-action, settings, a list page — the same job uses the same flow. Do not offer a shortcut around required stages. Surface the flow with a clear button at the point of intent.

### C2. One object, one set of verbs, wherever it appears
**You have this problem if:** the same real-world object (a transaction, an account, a document) looks and behaves differently on different pages — different actions, different names for them, different ways to open it — so what the user learned in one place doesn't carry to the next. States such as "done", "failed", or "needs review" are places the object moves between rather than facts about it.

**Standard:** Identify the product's few core objects: the things users handle most. Give each one presentation and one set of actions, used wherever it appears — list, detail, search result, report drill-down. A parent (a group, a section) behaves like its children one level up. States are properties shown on the object, not places it lives. Test: having learned one object's actions, can the user predict them everywhere else?

### C3. One source, many views
**You have this problem if:** separate screens redraw the same records, each with its own rules, so two screens can disagree about the same thing. "Needs attention", "failed", or "unreviewed" are pages rather than filters. Switching screens loses the user's place.

**Standard:** Different needs over the same records are views — each with its own layout, filter, sort, and grouping — never copies. Conditions like "waiting on X" or "needs review" are filters. An object opened from any view is the same object, and the current item survives switching views.

### C4. Stable places, one navigation spine
**You have this problem if:** navigation changes from area to area, things move around, or opening one item's details replaces the whole screen so the user loses the list they came from.

**Standard:** One navigation structure, the same in every area; things stay where they are. Views change only the main area. An item's detail opens beside the list where space allows, and Back or Esc closes it.

---

## D. Guidance: moving the user to action

### D1. Drive to the next action and outcome
**You have this problem if:** setup screens read as documentation. They explain, describe, and enumerate, and leave the user to infer what to do next.

**Standard:** Setup screens exist to move the user to a concrete action and a finished outcome. Each screen should tell the user exactly what to do next. Success is a working system at the end, not comprehension of the design.

### D2. Say what to do; keep the why to a caption
**You have this problem if:** the user must derive the next action from a paragraph of explanation, or a rationale is longer than the instruction it justifies.

**Standard:** Lead with the plain instruction. Add the shortest possible reason — a caption, never a paragraph. Never make the user reconstruct intent from context.

### D3. Lead the user; don't ask them to think
**You have this problem if:** the user is asked to make system-level decisions, choose among implementation-shaped options, or think through implications that the product should decide for them.

**Standard:** Defaults, suggestions, and guided choices over open questions. The user should mostly *do*, not *decide about the system*. Ask only for what is genuinely theirs to decide.

### D4. Offer the one next step
**You have this problem if:** an object or page shows every action it could ever take, all the time; or it shows none and the user must know what comes next. An empty page is a blank grid or an empty container.

**Standard:** Where the user is, offer the single next useful action for this object, in the workflow's order — or nothing when it is done. One level up, a short list of next steps, present only when there is something to do. An empty state is one quiet line and its one action ("No accounts yet · Add account"). Offer an option only in the context where it applies.

### D5. Works with no configuration; settings live on what they affect
**You have this problem if:** first use requires a trip to settings; settings are collected on a page far from the thing they change; the free, everyday action is gated behind setup.

**Standard:** Every setting has a working default, so first use needs no choices. A setting lives on the object it affects, shown and changed there. The everyday action is never gated. Test: can someone do productive work without opening a settings page?

### D6. Forgive rather than ask permission
**You have this problem if:** cheap, reversible actions (delete, move, rename, recategorize) sit behind confirmation dialogs; or an action that costs money, significant time, or can't be undone starts without its cost stated where it is started.

**Standard:** What can be undone happens at once, with a way back (Undo in the notice, a restore). Confirm only what spends money or time or can't be reversed, and let the confirm button restate the verb with its count and cost ("Categorize 40 transactions · ~1 min") — never "OK", never a bare "Are you sure?". A lesser cost goes in the button label, with no dialog. Out of date is a quiet fact with the one action that fixes it, not an error.

### D7. When the machine does the work, the user supervises from leverage
**You have this problem if:** automation's output must be stepped through or approved item by item; its results are shown apart from what produced them; the user carries data between tools by copy and paste.

**Standard:** The user sets direction — rules, examples, what good looks like — and reviews results; they don't carry each step. Show each result beside its input so review is quick and in place, and surface only what needs a person (review by exception). Keep any hand-off between tools to one obvious step.

---

## E. Presentation: the product interface

### E1. Product interface, not prose
**You have this problem if:** the page is a wall of paragraphs, or meaning is carried by sentences where a label, row, or value would do.

**Standard:** Minimal, precise text. Carry structure with layout, headings, captions, tables, and key-value pairs instead of prose. If a sentence can become a label or a row, make it one. Aim for the disciplined density of tools like Notion: few words, each earning its place.

### E2. A familiar surface with depth underneath
**You have this problem if:** the first screen shows everything the product can do; advanced or technical controls sit in the everyday path; or capability was removed to make the screen look simple.

**Standard:** Open on something the user already understands — their own data as a list, a document, a statement. Power is reached on demand: a selection, a "more" menu, "N more properties", a detail panel. Simplicity compresses complexity; it does not delete capability. Test: can a new user do the everyday task without seeing a single advanced control?

### E3. Content first; secondary controls appear where attention is
**You have this problem if:** the idle screen is crowded with per-row buttons, toolbars, and badges, so the user's own content is a minority of what they see.

**Standard:** At rest, show the user's content plus only what is wrong. Repeated per-item controls appear on hover, focus, or selection, beside what they act on and never covering it. This never hides the page's primary actions or navigation, which stay visible and look clickable (F6); only the repeated, per-item controls recede. Test: screenshot the idle screen — what fraction is the user's content?

### E4. Edit in place
**You have this problem if:** there is a separate edit mode, an Edit or Save button, or a modal form for properties that could be changed where they are shown.

**Standard:** Change a thing where it is shown, saved as the user types. Properties are rows edited in place, not forms. A new object is created at once, with the cursor in its name. Where the domain itself has a commit — posting entries to a ledger, sending a payment, submitting to someone else — keep that one deliberate step and make it visibly the point of commitment; add no Save steps anywhere else.

### E5. Colour means something
**You have this problem if:** colour decorates the chrome (tinted headers, brand colour on things that mean nothing), or a warning colour is applied to everything unfinished, so the one item that truly needs the user disappears among a dozen that don't.

**Standard:** The interface is neutral; colour is reserved for the user's content and a few fixed meanings, each used for nothing else — for example one colour for "a person must act", red for broken or failed, the accent for the primary action, selection, and work in progress. Done is quiet (grey with a check), not a green badge. Keep "needs a person" apart from "the product will fix this with one click"; the second is neutral. Aggregate to one indicator per item with a count, details on hover. Decide the tone in one place so every surface agrees. Test: blur a screenshot of real data — does the colour point where the user should look? If more than a handful of items on one screen carry the warning colour, the rule is wrong.

### E6. Copy: few words, the user's words
**You have this problem if:** labels are sentences, controls carry explanatory lines beneath them, the same thing has two names, or messages from the server reach the user in the system's words.

**Standard:**
- Sentence case. Labels are one to three words, verb first ("Add account", "Move to"). States are one or two words ("Not reviewed", "Out of date"). Facts are a fact plus a time ("Imported 2 h ago").
- No sentence under a control. If a control needs one, the label or the concept is wrong; the explanation goes in a tooltip or a better label. (A step's one-line why, D2, is the only caption.)
- Placeholders are hints by example, not instructions. An ellipsis means more input follows ("Move to…") or work is in progress ("Saving…").
- Destructive and costly labels restate the action and its cost; never "OK".
- No trailing periods on labels, states, or one-line empty states. Empty states are casual, not cute ("You're all caught up").
- One word per thing across the interface, the command line, the docs, and server messages. Keep the domain's own names; invent words only for interface things. Fix wrong wording at its source rather than rewriting it on the way to the screen.
- Once explanatory copy is cut, discoverability comes from tooltips, placeholders, and a help or shortcuts sheet — not paragraphs.

### E7. Feedback never blocks, and status lives on the object
**You have this problem if:** long work (an import, an AI run) blocks the page with a modal spinner; its results and failures appear somewhere disconnected from the objects they concern; loading shows a blank page.

**Standard:** Long work runs in the background with a quiet progress indicator. The object being worked on shows its state in place. Completion is a brief notice carrying at most one action ("12 transactions categorized · Review"). A failure lands on the object it concerns, and in the one place that lists what needs the user. Loading shows placeholders in the shape of the content.

---

## F. Comprehension: the page explains itself

### F1. Decide what the page must teach, then lay it out in that order
**You have this problem if:** the page opens straight into data or controls — a list, a table, an editor — and what the page *is* has to be inferred from its contents. The layout follows how the data is stored, not what a newcomer needs to grasp first.

**Standard:** Before arranging anything, write the concept inventory: the few ideas a first-time visitor must understand, in order (e.g. "the system sorts your transactions for you" → "it does so in two ways" → "you can teach it"). Give each idea a region of the page, top to bottom, in that order. The contents — rows, text, settings — sit inside the region whose idea they illustrate. Anything that serves none of the ideas goes deeper or goes away.

### F2. Show, don't tell — pass the glance test
**You have this problem if:** understanding the page requires reading it. Explanation lives in sentences; the layout itself says nothing; a newcomer who only glances cannot say what the page is for.

**Standard:** Convey concepts through the arrangement of the page before words: what comes first, what is large and what is small, what is grouped with what, what sits beside the thing it affects. Text comes in small pieces placed exactly where it labels something, not in a block at the top. The test: someone who has never seen the product glances at the page for five seconds; they can name what it is for, how it works in outline, and what they are expected to do here.

### F3. Carry meaning with standard patterns and hierarchy, not new visuals
**You have this problem if:** the page's meaning — the goal, the mechanism, the user's part in it — cannot be read from its structure, and the proposed fix is to add something on top: a diagram, a chart, arrows, an illustration, an animation. Or a relationship in the data (this maps to that, this belongs to that, this overrides that) is left for the user to deduce from columns.

**Standard:** Solve it with the established vocabulary of interface design, which users already read without effort: page and section order, visual hierarchy (size, weight, contrast, whitespace), content hierarchy (heading → summary → detail), grouping and nesting, alignment, master–detail, grouped lists, key–value rows, cards, tabs, and progressive disclosure. Pick the pattern whose meaning users already know and let it say the relationship: items grouped under the thing they lead to read as "these go there"; a section placed before another reads as "this comes first." A graphic is justified only when no arrangement of standard parts can carry the idea — which is rare.

### F4. The page's structure mirrors the kinds of thing it holds
**You have this problem if:** there are several kinds of item (two kinds of rule, three kinds of source) but they appear as one list, as tabs with no hint of how they differ, or with one kind dominating so the others are missed. Kinds nested within kinds are invisible. Their order of precedence is unstated.

**Standard:** Before any contents, show the kinds side by side, each with a name, a one-line "what it does", and a count. Nested kinds are visible as nesting. If the kinds apply in an order and that order matters to the user, the arrangement shows it (position, numbering). The user can see the whole taxonomy on one screen.

### F5. No part may bury the others
**You have this problem if:** one section's volume — hundreds of rows, a long text — pushes the rest of the page below the fold, so the user must scroll past one concept to discover the next exists.

**Standard:** The overview fits on one screen. Large collections are summarized (count, a few representative examples, search) and open on demand. Volume is detail; it never decides layout. The 237th row never pushes the second concept out of sight. The same holds for a page's own header: show the two to four facts used most, put the rest behind "N more", and state each fact in one place only.

### F6. Interactive things look interactive; the map stays visible
**You have this problem if:** a clickable item looks like a label or a heading; the user doesn't know they can navigate between sections; when inside one item they can't see the siblings or how to get back to the shared or general case.

**Standard:** Navigation, selectable items, and editable regions carry the look of what they are — button, tab, card with hover, list with selection. The current location is marked, and the siblings and the general case ("applies to every account") stay visible and one click away from any detail.

### F7. Context travels with the detail
**You have this problem if:** drilling into one item shows only its raw contents — a block of text, a form — with no indication of what kind of thing it is, where it sits in the process, or what changing it will do.

**Standard:** Every detail view carries a compact header of context: what this is, what it applies to, and what editing it changes. A detail view is never a dead end the user must interpret alone.

### F8. Frame the unfamiliar in something familiar
**You have this problem if:** the product asks users to work with an artifact they have no prior pattern for — free-text instructions to an AI, a rule engine, a matching language — and presents it bare.

**Standard:** Place it in an arrangement users already know from the domain's software, so the new thing borrows the meaning of the familiar one. Where that is not enough, one concrete, real example shown in the page's ordinary components (a real item and what happened to it) does more than any description.

### F9. Icons and color are supporting signals, not the message
**You have this problem if:** the page leans on decoration to explain itself — illustrations, charts, diagrams, animation added to make an idea "visual" — or icons and colors are used without a consistent meaning, so they add noise instead of recognition.

**Standard:** The structure carries the meaning (F3). Icons and color only reinforce it: an icon marks a kind of thing so it is recognized at a glance, a color marks a state or a category, each used the same way everywhere (E5). No charts, diagrams, or animations to explain the product; charts belong where the user's own data is the subject.

---

## Taste

The owner's standing preferences; apply them unasked.

- **Hide the internals; that is the designer's job.** Find the arrangement that conveys the essence of the system and what it needs from the user, so the user never learns how it is built. Explaining a process is a last resort, kept to its domain-level essence (A2, A5).
- **Show, don't tell — through structure.** Order, layout, visual and content hierarchy, grouping, placement; words last, few, and at the point of use.
- **Standard patterns over novel visuals.** Dig into the established UI/UX vocabulary and find the arrangement that makes the goal, the mechanism, and the user's part obvious. Don't fill pages with graphs, diagrams, and animations.
- **Glanceable.** A newcomer understands the page without reading it. If they must read, the design is not done.
- **Minimal but effective.** Every element — word, icon, color — earns its place by carrying meaning. Nothing decorative, nothing redundant.
- **Think in three hats at once:** graphic designer (composition, hierarchy, typography, whitespace), UX expert (jobs, flows, patterns, affordance), and domain expert (the conventions of the product's field — for dbu6, personal finance software).
- **Reimagine, don't patch.** When a page fails to communicate, rebuild it from the concept inventory. Keep what already works (a good title stays); don't bolt explanations onto a layout that says the wrong thing.
- **Follow the philosophy.** content first, one object behaving the same everywhere, power behind a familiar surface, colour with meaning, forgiveness over confirmation, few plain words — not its colours, fonts, or widgets.
- **Care about the user's mind.** Start from what a person without our vocabulary would see, assume, and want — not from what we know the page does.

---

## Review checklist

- Can I name the user's job for each screen?
- Is any real-world object presented in pieces across steps?
- Is work batched by stage rather than completed per instance?
- What is the time to first value?
- Is the same job offered the same way from every entry point?
- Does each screen end in a concrete action and a checkable state?
- How much of the text is explanation versus instruction?
- Which internal concepts have leaked into names or copy?
- Are two distinct jobs sharing one flow?
- How many unrelated concepts does each unit (screen, step, section, card, popup) demand at once?
- Could a beginner proceed by doing, without understanding the system?
- What must a newcomer understand from this page, in what order — and does the layout follow that order?
- Glance for five seconds without reading: is it clear what the page does and what I can do here?
- Is any internal concept being explained that a better arrangement would make unnecessary? Where a process must be understood, is only its domain-level essence conveyed?
- Can the goal, the mechanism, and the user's part be read from the structure alone — order, hierarchy, grouping, placement — using patterns users already know?
- Are all kinds of item, and their order of precedence, visible on one screen before any contents?
- Does any section's volume push another concept out of sight?
- Does everything clickable look clickable, and can I see where I am and where else I can go?
- When I open one item, does the view still tell me what it is and what editing it changes?
- Is anything decorative — a diagram, chart, or animation explaining the product — standing in for a structure that should carry the meaning? Do icons and colors mean the same thing everywhere?
- Having learned one object's actions, can I predict them wherever it appears? Could two screens ever disagree about the same record?
- Is any state ("needs review", "failed") a page instead of a filter or a property?
- For each object, is the one next step offered — or every possible action at once? Is each empty state one line and one action?
- Can the everyday task be done without seeing an advanced control or opening a settings page?
- Is there a confirmation on anything that can be undone? Does every costly action show its cost where it is started?
- Is there an Edit mode or Save button the domain doesn't require?
- Idle screenshot: how much of it is the user's content? Blurred: does the colour point where the user should look?
- Is there a sentence under any control? Is anything called by two names?
- Does long work block the page, or land its result away from the object it concerns?
- Has the design been checked in the running product with real, messy data?

---

## Appendix: original brief mapped from specific to general

| Original, specific instruction | General form |
|---|---|
| "Muddled two separate concepts: first-time system setup vs. setting up an account" | Separate jobs with different urgency/scope into different containers (A3) |
| "Each step asks for a partial piece of data about each account" | Don't slice one instance across stages; complete one instance end-to-end (B1) |
| "Invert it: set up one account in one go" | Iterate instances outer, stages inner (B1) |
| "Nobody does 10–15 accounts in one go" | Optimize for one complete unit, then repeat (B3) |
| "Show the value of the system as soon as possible" | Optimize time to first value (B3) |
| "Adding a new account should go through the same flow again" | One job, one flow, every entry point (C1) |
| "Give a button on the home page" | Surface the flow at the point of intent (C1) |
| "Don't make them go to accounts → import → parser → find opening balance" | No manual path that skips required stages (C1) |
| "Page and steps modeled on internal workings; exposing internal abstractions" | Design around jobs, not structure; hide plumbing (A1, A2) |
| "What goals would they have? What jobs? What order are they thinking in?" | Frame the user before designing (How to operate; diagnosis procedure) |
| "Setup screens guide the user to specific actions and outcomes" | Drive to the next action and outcome (D1) |
| "When complete, they have a completely working system" | Success is a working outcome, not comprehension (D1) |
| "Tell exactly what to do; small instruction on why" | Say what to do; why as caption (D2) |
| "Designed as a product interface, like tools like Notion; little text but precise; use layout, captions, tabular structure, key-value pairs" | Product interface, not prose (E1) |
| "Beginner doesn't have to think; they just do" | Lead the user; don't ask them to think (D3) |
| *Added:* humans hold only ~5–6 things in mind and process fewer; a unit should carry one or two cohesive ideas | Keep each unit within one or two cohesive concepts (A4) |
| "Use teams of agents; ask questions before going autonomous" | (Process meta-rule for large jobs — see below) |
| *Categorization rules page:* "Think through a user's mind; they come without preconceived notions of our internal system" | Picture the user arriving cold (How to operate, step 1) |
| "Identify the concepts a user should implicitly understand, then order things around them" | Concept inventory decides the layout (How to operate, step 2; F1) |
| "Title and subtitle are fine. After that, what should we show?" | Keep what works; reimagine the rest from the inventory (step 5; Taste) |
| "Understand without reading, just by glancing; show, don't tell" | Show, don't tell — the glance test (F2) |
| "Not clear that the narration maps to these accounts; it's just a table" | Let a standard pattern say the relationship, e.g. group items under what they lead to (F3) |
| "Two kinds of rules — exact matching and guidance — and two kinds of exact match" | Structure mirrors the kinds, with nesting and precedence (F4) |
| "237 whole-narration mappings; you scroll a lot to find the contains rules" | No part may bury the others (F5) |
| "Not clear that Common rules is a button I can click from inside an account's guidance" | Interactive things look interactive; the map stays visible (F6) |
| "Clicking a guidance shows just the text; I have no idea what is going on" | Context travels with the detail (F7) |
| "They don't know this is sent to an LLM with the transaction and the accounts, and returns a mapping; edit it to improve categorization" | When the goal needs a process understood, convey only its domain-level essence (A5, subordinate to A2) |
| "'Applies only after the executable transaction mappings' doesn't make sense to them" | Never phrase anything in the system's terms (A2, A5) |
| "People are not used to long text blocks that help map accounts" | Frame the unfamiliar in something familiar (F8) |
| "More iconography; charts, graphs, images, minimal but effective" | Icons and color support the structure; structure carries the meaning (F9, as corrected below) |
| "Think as a graphic designer, a UI/UX expert, and from personal finance software" | Three hats; domain conventions (Taste; F8) |
| *Correction:* "Showing the process conflicts with hiding internals; hide them as much as possible — conveying the essence is the designer's job. A domain process the user must understand is the exception, in service of that" | A2 is primary; A5 is its narrow exception (A2, A5; Taste) |
| *Correction:* "I don't want to fill our pages with graphs and animations; dig into standard UI/UX patterns, arrangements, layouts, ordering, visual and content hierarchy so the mechanism, the goal, and what we expect of the user are readily apparent" | Carry meaning with standard patterns and hierarchy, not new visuals (F3, F9; Taste) |

### From the Notion design reference

Only the philosophy and the UX principles were taken; Notion's colours, type, spacing, motion, and specific widgets were not.

| Notion idea | Where it lives here |
|---|---|
| Hide the machinery inside something people already understand | A2, E2 |
| Few, strong primitives; one unit with the same verbs everywhere | C2 |
| One source of data, many views; states are filters, not pages | C3 |
| A familiar surface with depth underneath | E2 |
| The chrome recedes; controls appear on intent | E3 (primary actions and navigation stay visible, F6) |
| Direct manipulation in place: no modes, no Save, no forms | E4 (keeping a commit step where the domain has one) |
| A neutral canvas; colour belongs to content and meaning; the "everything is orange" mistake | E5 |
| Forgiveness over permission; confirm only money, time, and the irreversible | D6 |
| Context decides what is offered; one next step; small empty states | D4 |
| Defaults that work with zero configuration; settings on the object | D5 |
| Stable places and one navigation spine; detail opens beside, not instead | C4 |
| Terse, sentence-case copy in the user's words; one vocabulary everywhere | E6 |
| Leverage over babysitting when machines do the work | D7 |
| Background work never blocks; status on the object | E7 |
| The page header must not dominate; each fact in one place | F5 |
| Meet reality early; measure, don't eyeball | How to operate, step 6 |

**Not adopted:** "the type is a lens" (in-place retyping of blocks), "structure is the content" (the outline as the data model), one command registry with full keyboard parity, and "capability as a layer, not a destination" — these belong to a block editor with a command layer, which this product is not, and its categorizer deliberately keeps its own place. The engineering and delivery process sections are outside this document's scope.

### Process meta-rule
For a large redesign, review the current flow first, state the ideal scenario from a new user's perspective, and get agreement on the principles before implementing. Then implement in one pass, delegating independent work to parallel agents where context allows.
