# Sibling git worktrees

When the root is in a git repo, the other worktrees of that repo (`git worktree list`) are inside
the workspace too, so a session in the main checkout can work on an issue's worktree. A root in a
sub-folder reaches the same sub-folder of each worktree. Worktrees are listed once per call, only
when a path falls outside the root, and never kept between calls, so one added or removed
mid-session applies at once.
Symlinks and `..` are resolved first, so a path that leads out of every worktree is still refused.
Without git, or outside a repo, the workspace keeps its single root. `run_command` takes a `cwd`
that goes through the same check.

Only apps turn this on: `Workspace.open(root, { env })` takes the app's environment, and without
it the root is the only one. Git's list is not trusted on its own, because a repo's contents can
forge it: a worktree counts only when its `.git` file and the repo's `.git/worktrees/<id>/gitdir`
point at each other. That shows the two files agree, not that they are authentic; forging both
takes write access inside `.git`, which the file tools refuse, or a command the user approved.
Known limits: a submodule or bare repo has no siblings (it fails closed), and an approved
`git worktree add <path>` makes `<path>` reachable for the rest of the session, which is why the
approval for it says so. A path `resolveRead` accepted is in the root, in scratch (`inScratch`) or
in a verified sibling, so `run_command` treats a verified sibling like the root: the shared mode
and allow list apply, including grants given for the root. Those grants then cover a checkout that
may come from another branch, which is the cost of sharing one list. A command that runs in the
scratch folder always asks, naming the folder, and the answer is never kept as a grant (`allow_all`
asks nothing, as everywhere). `.git` of a sibling worktree can't be read or written either.

`findMainRoot({ root, env })` gives the folder `root` has in the repo's main worktree, so per-folder
settings (the backend's command permissions) are shared by every worktree of a repo. It uses the
same verification, and returns `root` itself when it is in no repo, its link does not verify, the
folder is missing from the main worktree, or the main worktree holds it as a symlink to another
folder.
