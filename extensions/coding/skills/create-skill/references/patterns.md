# Writing patterns

Patterns for a skill's body. Use the one the task needs, not all of them.

## Contents

- Template: a fixed output format
- Examples: when quality depends on seeing one
- Checklist workflow: many steps, in order
- Branching workflow: different paths for different cases
- Validation loop: work that must be checked
- Scripts: run or read
- Old patterns: what used to be true

## Template

When the output has a fixed shape, give the template itself:

````markdown
## Report structure

Use this template:

```markdown
# <Title>

## Summary

<One paragraph: what was found and what it means>

## Findings

- <Finding, with the evidence>
```
````

## Examples

When the result depends on style, show an input and the output you want, rather than describing
it:

````markdown
## Commit message format

Input: added login with JWT tokens
Output:

```text
feat(auth): add login with JWT tokens

Adds the login endpoint and the token check on every request.
```
````

Two or three examples that differ in something that matters teach more than one.

## Checklist workflow

For a long sequence where skipping a step is the usual mistake, give a checklist the agent copies
into its reply and ticks off:

````markdown
## Migrating a table

Copy this and check off each step:

```text
- [ ] 1. Back up the table
- [ ] 2. Write the migration
- [ ] 3. Run it against the copy
- [ ] 4. Compare row counts
- [ ] 5. Run it for real
```
````

## Branching workflow

When the steps depend on the case, decide first, then send the agent down one path:

```markdown
## Changing a document

1. Is it a new document or an existing one?
   - **New:** follow "Creating" below.
   - **Existing:** follow "Editing" below.
```

Put each path in its own reference file when they are long, so the agent reads only its own.

## Validation loop

When mistakes are easy to make and easy to detect, make checking part of the steps:

```markdown
1. Make the change.
2. Run `npm run check`.
3. If it fails, fix what it reports and run it again.
4. Go on only once it passes.
```

## Scripts: run or read

Say which one the agent should do. "Run `scripts/validate.sh <file>`: it prints OK or the
problems" is a script to run, whose code never needs to enter the context. "See
`scripts/deploy.sh` for the order of the steps" is a script to read. A script should handle its
own errors and say what to do next, rather than leaving that to the agent.

## Old patterns

Don't write instructions that go stale ("before August, use the old API"). Describe the current
way, and keep the old one, if still needed, in a section at the end:

```markdown
## Current method

Use the v2 endpoint.

## Old patterns

The v1 endpoint still serves projects created before v2. Only use it for those.
```
