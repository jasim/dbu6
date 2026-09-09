# Coding Principles

## Every abstraction must reduce total complexity

Code is read through its names. Every new type, function, stage, plan, interpreter, and module gives the reader another concept to remember. That cost is justified when the name compresses several details into one idea, enforces a guarantee, or hides a decision that may change. An abstraction that only forwards a call, renames a value, or moves a few obvious lines makes the system harder to see.

The following coding principles therefore have a threshold. Make important structure explicit, but leave simple code direct. Judge the result by total cognitive load, not by the number of types, purity boundaries, or seams.

## Each rule must have one authoritative source

Give every convention, policy, mapping, parsing rule, and constraint one explicit definition. This is a rule about knowledge, not repeated characters: similar-looking code may express different facts and should remain separate, while differently written code that encodes the same fact should converge on one source.

Use the smallest form that expresses and enforces the knowledge. A structural convention may be a schema or builder, a naming rule may be a generator, a policy may be a function, and a domain constraint may be a type whose constructor enforces it. Every consumer must call, import, or derive from that definition. A central declaration that consumers still reimplement is documentation, not consolidation.

Test the authoritative definition rather than every scattered instance. One source should make a change local and let its types, consumers, or focused tests reveal the consequences. A rule needs a home, not an abstraction layer of its own.

## Types must encode new guarantees

Parse external data once, fail explicitly, and represent validated facts and emerging invariants as domain types. Build vocabulary from precise primitives, and name a composition when it recurs as a domain concept.

A type is valuable when it can rule out invalid states, record evidence that need not be relitigated downstream, or when it gives related operations a natural home. However, if it is just a wrapper that changes neither the legal values nor the available operations, then it adds vocabulary without adding knowledge, and should be avoided.

## Organize modules around domain concepts

Give each significant domain concept a module centered on its type. Colocate the type with its construction, parsing, validation, queries, and transformations. Let these concepts determine module boundaries instead of process steps or collections of verbs. When an operation spans several types, place it with the type that drives the operation or introduce a module for the compound concept.

Make these modules deep. A module should gather enough related knowledge to provide an interface simpler than its implementation, hide a changeable decision, or contain a concept's rules in one place. A pass-through wrapper, a mirrored parameter list, or a set of single-use helpers creates a shallow boundary; merge it with the concept it serves until the boundary absorbs complexity from its callers.

## Preserve meaning; split only at real boundaries

Keep a concept whole when the relationship between its parts carries domain meaning. At its point of origin, retain the complete value and let each consumer project the smaller shape it needs. Splitting earlier is a lossy transformation when downstream code must recover the original context through auxiliary queries, extra joins, branch-heavy inference, or heuristics. Move that projection to the consumption boundary, widen the projected value, or preserve an explicit reference to the whole.

The opposite mistake is bundling distinct concepts because they happen to travel together. Split parts that have different lifetimes, readers, or rates of change. Casts and placeholders during construction, correlated optional fields, consumers that read disjoint slices, and unrelated test churn are evidence that one type contains several concepts. Give each concept an honestly constructible type, use a discriminated union for distinct phases, and re-bundle parts only at the seam where they genuinely co-travel.

Choose the factoring that preserves information and keeps the set of representable values close to the set of valid values. Neither fewer types nor more types is the goal. The goal is a boundary that matches the domain.

## Event paths must expose meaningful transitions

Keep each event path readable from trigger to outcome. Introduce a typed, named stage when it establishes a new invariant, makes a domain decision, or compresses a multi-step transformation. Pass its result forward instead of mutating ambient state. Use early returns, separate passes, explicit state, and centralized branching when they make the path easier to follow.

Keep substantive domain decisions independent of database, network, filesystem, and UI I/O. When a decision produces alternative effects or requires ordering, retries, partial-failure handling, auditing, preview, or multiple executors, return an inspectable effect plan and execute it at the I/O boundary.

Leave direct operations direct. A stage that only forwards a call or renames a value adds navigation without clarifying the path. A plan with one obvious effect and no policy does the same. Introduce either boundary only when it hides real detail, encodes a guarantee, or makes a meaningful decision visible.
