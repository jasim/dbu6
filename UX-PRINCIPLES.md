# Designing User-Facing Flows

## Purpose

A discipline for designing and reviewing any user-facing flow — onboarding, setup, wizards, multi-step forms, importers, settings, checkout — so the interface is organized around the user's jobs and outcomes, not the system's internal structure.

## Core idea

Every screen exists for a user trying to accomplish something. The interface is a means to an outcome, not a window onto the implementation. When a flow feels hard, it is usually because the user is being asked to reconstruct a concept the system already understands, or to work in an order that serves the system rather than their goal.

## How to operate

Given a flow (screens, steps, copy, or a plan), work in this order:

1. **Frame the user.** What job are they doing? What outcome do they want? What do they already know or believe? In what order do they think about it? What is the smallest *complete* unit of value? What internal concepts are they being made to learn? Where do they enter from?
2. **Diagnose.** Walk the principles below. Cite concrete evidence for each one that fires (screen, step, copy, field, route).
3. **Prescribe.** State where, which principle, and the remedy drawn from the principle's standard.
4. **Redesign end-to-end.** Propose the ideal flow: entry points, unit of work, order of stages, wording, and the end state. Use what exists as a base, then elevate it.

Do not produce a generic checklist. If nothing fires, say so. Apply the principles to plans too — flag what the plan would bake in if implemented as written.

---

## A. Framing: what the interface is about

### A1. Design around the user's job, not the system's structure
**You have this problem if:** step names, headings, grouping, field order, or vocabulary mirror the implementation (tables, modules, pipeline stages, entity attributes). A single real-world thing must be reassembled by the user from pieces scattered by where they happen to be stored.

**Standard:** Name and group by the user's object and goal. One real-world thing gets one place. If the system persists it across five tables, the interface still presents it as one concept. The interface vocabulary may differ from the code vocabulary; that is a feature.

### A2. Hide the plumbing
**You have this problem if:** the copy explains how the system works, exposes options that only an implementer cares about, or expects the user to reason about downstream implications of a choice. The user must understand the architecture to proceed.

**Standard:** Present only concepts the user brings from the real world. Suppress internal abstractions and design decisions. The user should never need to know how the system is built to use it.

### A3. Never conflate distinct jobs
**You have this problem if:** two different user goals share one screen or wizard because they touch the same data. First-time setup (establish a minimum foundation, urgent, once) and adding one more item (a routine operation, repeatable, low urgency) are different jobs.

**Standard:** Separate the containers. Share reusable sub-flows between them, not the frame. If two goals have different urgency, scope, or frequency, they are different flows.

### A4. Keep each unit within one or two cohesive concepts
**You have this problem if:** a screen, popup, step, section, card, or form asks the user to hold several unrelated ideas at once — mixing, say, identity, connectivity, and money in a single pane, or presenting settings, data entry, and explanation as one undifferentiated block. The user has to keep the whole thing in mind to act on any part of it.

**Standard:** Limit each unit to one or two major ideas, plus whatever closely related detail belongs to them. Related things may share a unit; unrelated things must not. A form, a settings pane, a workflow step, a card, and a popup are all the same kind of unit and obey the same limit. Humans hold only about five or six things in mind at once and actively process fewer, so the number of *distinct concepts* in view — not the number of controls — is what must stay small. Each unit should have a clear label that names the one or two concepts it is for, so the user can tell at a glance what belongs together and what does not.

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

---

## E. Presentation: the product interface

### E1. Product interface, not prose
**You have this problem if:** the page is a wall of paragraphs, or meaning is carried by sentences where a label, row, or value would do.

**Standard:** Minimal, precise text. Carry structure with layout, headings, captions, tables, and key-value pairs instead of prose. If a sentence can become a label or a row, make it one. Aim for the disciplined density of tools like Notion: few words, each earning its place.

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
| "Designed as a product interface, like Notion; little text but precise; use layout, captions, tabular structure, key-value pairs" | Product interface, not prose (E1) |
| "Beginner doesn't have to think; they just do" | Lead the user; don't ask them to think (D3) |
| *Added:* humans hold only ~5–6 things in mind and process fewer; a unit should carry one or two cohesive ideas | Keep each unit within one or two cohesive concepts (A4) |
| "Use teams of agents; ask questions before going autonomous" | (Process meta-rule for large jobs — see below) |

### Process meta-rule
For a large redesign, review the current flow first, state the ideal scenario from a new user's perspective, and get agreement on the principles before implementing. Then implement in one pass, delegating independent work to parallel agents where context allows.
