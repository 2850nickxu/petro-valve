# DevOps pipeline — isolated branches, auto-ship to production

This repo ships itself. Agents (and you) do work in **isolated git worktrees**,
commit, and a background pipeline carries each commit through **GitHub → CI →
Vercel production** without blocking the terminal. This doc is the runbook.

```
 agent A ─┐   commit on            .githooks/post-commit           ┌─ prod deploy
 agent B ─┼─▶ agent/<slug>  ─────▶  launches scripts/ship.sh  ────▶ │  (Vercel, on
 agent C ─┘   (own worktree)        detached, in background         └─  merge to main)
                                          │
                                          ├─ push branch → Vercel PREVIEW deploy
                                          ├─ open/refresh PR
                                          ├─ wait for CI + preview to go GREEN
                                          ├─ auto-merge (squash) to main
                                          └─ watch the PRODUCTION deploy
```

## 1. Isolation — agents never clobber each other

Every agent works on its **own branch** in its **own worktree**, so two agents
physically cannot edit the same files or index at once. Never work directly on
`main`, and never commit onto a branch another agent is using.

```bash
scripts/new-agent-worktree.sh <slug>
#   → branch  agent/<slug>
#   → dir     ../offline-po-app-worktrees/<slug>   (clean checkout of origin/main)
```

Point the agent at the printed directory. In Claude Code you can also spawn a
subagent with `isolation: "worktree"` (the Agent tool) for the same effect.
When a branch has merged, reclaim its worktree:

```bash
git worktree remove ../offline-po-app-worktrees/<slug>
git worktree list          # inspect what's active
```

Integration happens through PRs onto `main`, never by pushing over each other —
so concurrent branches merge cleanly (or surface an honest conflict on the PR).

## 2. Commit → automatic hand-off

The hook is enabled per clone with:

```bash
git config core.hooksPath .githooks    # done automatically by `npm install` (prepare script)
```

After that, **every commit on a feature branch** auto-launches `scripts/ship.sh`
in the background and frees the terminal immediately. The pipeline:

1. pushes the branch (Vercel builds a **preview**),
2. opens or refreshes a PR into `main`,
3. waits for **CI** (`type-check · lint · test · build`) **and** the Vercel
   preview to finish,
4. on all-green, **squash-merges to `main`** → Vercel deploys **production**,
5. watches the production deploy and records the result.

Progress streams to `.devops/ship-<branch>.log`; a failure writes
`.devops/FAILED-<branch>.md`. (`.devops/` is git-ignored — logs never get
committed.)

## 3. The `devops` subagent

`.claude/agents/devops.md` is an LLM agent that wraps the pipeline and **triages
failures**. Hand off to it — ideally in the background — when you want judgment,
not just the script:

- It runs `scripts/ship.sh`, and on a red check reads the CI/Vercel logs,
  diagnoses the cause, and either applies a *trivial* mechanical fix and
  re-ships, or reports back so the author can fix it.
- It never merges anything that isn't fully green, and never touches product
  logic.

Typical use from the terminal agent: finish a unit of work, commit (the hook
fires), and if you want active monitoring/triage, spawn the `devops` agent in
the background and carry on.

## 4. Autonomy & escape hatches

Full-auto-to-production is the default. Controls:

| Want to…                              | Do this                                             |
|---------------------------------------|-----------------------------------------------------|
| Commit without shipping (one commit)  | put `[skip ship]` in the commit message             |
| Disable auto-ship entirely            | `export DEVOPS_AUTOSHIP=0`                           |
| Stop at a green PR (merge by hand)    | `export SHIP_AUTOMERGE=0` (then `gh pr merge …`)     |
| Ship a branch manually                | `bash scripts/ship.sh`                              |
| Re-enable the hook                    | `git config core.hooksPath .githooks`               |

## 5. The gate (and a caveat)

CI (`.github/workflows/ci.yml`) runs `type-check · lint · test · build` on every
PR into `main`, credential-free (the offline-first invariant). The pipeline will
**not** merge unless CI and the Vercel preview are green.

Caveat: this repo is **private on a free GitHub plan**, so server-side *branch
protection* / required-status-checks aren't available. The green-before-merge
gate is therefore enforced by `scripts/ship.sh` and the `devops` agent, not by
GitHub. If the repo goes public or onto a paid plan, add branch protection on
`main` (require the `verify` check + the Vercel check) to enforce it server-side
too.

## 6. Deploy model

Vercel is connected to the GitHub repo:

- push any branch → **preview** deployment (its URL shows as a PR check),
  sign into its `/staff` with a code from production Settings → Store → Preview access,
- merge to `main` → **production** deployment (`https://offline-po-app.vercel.app`).

The pipeline never calls `vercel deploy`; it just moves git refs and lets
Vercel's Git integration build. Production env vars live in the Vercel project
(`offline-po-app`), never in the repo. Full env/secrets layout (Preview vs
Production, and the in-app encrypted Settings): `docs/ENVIRONMENT.md`.

### 6.1 Vercel team / local link

The project lives in the **`silkcommerce`** Vercel team (it was moved there from
`waynestratbucker-projects`; the project id was preserved, the org id was not).
The GitHub↔Vercel integration and all environment variables survived the move —
only *local* `.vercel/project.json` files went stale.

If a `vercel` command fails with *"Your Project was either deleted, transferred
to a new Team, or you don't have access to it anymore"*, your local link is
pointing at the old team. Relink:

```bash
npx vercel link --yes --scope silkcommerce --project offline-po-app
```

`.vercel/` is git-ignored, so this is per-clone (and per-worktree) — each agent
worktree needs it once. Note `vercel link` appends a `VERCEL_OIDC_TOKEN` to
`.env.local`; it leaves existing values alone.

Caveat: an integration authenticated only against `waynestratbucker-projects`
(e.g. a Vercel MCP connection) returns **403** for this project. Use the CLI with
`--scope silkcommerce` for deployment/log inspection until that connection is
re-authorized for the new team.
