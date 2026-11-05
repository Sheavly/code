// The shell guard's test cases, run from the project root. The guard test runs both lists, and
// the stop hook reads DENIED_CASES: a workaround the chat used must be in it, and no case at HEAD
// may leave it. Plain data with no imports, so the stop hook can load HEAD's copy too.

// Commands that edit project files past the edit tools' hooks.
export const DENIED_CASES = [
  "python3 - <<'PY'\nimport subprocess\nchanged=subprocess.check_output(['git','diff','--name-only'],text=True).splitlines()\nnew=subprocess.check_output(['git','ls-files','--others','--exclude-standard'],text=True).splitlines()\nallowed=['apps/backend/src/harness/','apps/backend/src/profiles/','apps/backend/src/api/handlers.helper.ts','apps/terminal/src/chat/','apps/terminal/src/setup/','apps/terminal/src/client/conversation.service.ts','apps/terminal/src/tui/','packages/protocol/src/','packages/core/src/provider/','packages/providers/src/','packages/runtime/src/sessions/','packages/storage/src/profile','packages/host/src/conversations/','packages/tools/src/sub-agent/']\nfiles=[p for p in dict.fromkeys(changed+new) if p.endswith('.ts') and any(p.startswith(prefix) for prefix in allowed)]\nsubprocess.run(['npx','prettier','--write',*files],check=True)\nPY",
  // Inline scripts cannot hide project edits behind a formatter or another in-place writer.
  `python3 -c "import subprocess; subprocess.run(['npx', 'prettier', '--write', 'README.md'])"`,
  "python3 - <<'PY'\nimport subprocess\nsubprocess.check_call(['npx', 'eslint', '--fix', *files])\nPY",
  `python3 -c "import subprocess; subprocess.run('npx prettier --write README.md', shell=True)"`,
  `node -e "require('node:child_process').spawnSync('npx', ['prettier', '--write', 'README.md'])"`,
  `node -e "require('node:child_process').execFileSync('npx', ['eslint', '--fix', ...files])"`,
  `python3 -c "import subprocess; subprocess.run(['sed', '-i', 's/a/b/', 'README.md'])"`,
  "sed -i 's/a/b/' packages/core/src/tool/tool.utils.ts",
  "sed -i.bak 's/a/b/' README.md",
  "sed -ni 's/a/b/p' README.md",
  "sed -Ei -e 's/a/b/' README.md",
  "sed --in-place 's/a/b/' README.md",
  "sed --in-place=.bak -e 's/a/b/' README.md",
  "sed -e 's/a/b/' -i README.md",
  "cd packages/core && sed -i 's/a/b/' src/tool/tool.utils.ts",
  "perl -i -pe 's/a/b/' README.md",
  "perl -pi -e 's/a/b/' README.md",
  "perl -lpi -e 's/a/b/' README.md",
  "perl -i.bak -pe 's/a/b/' README.md",
  "ruby -i -pe 'gsub(/a/, %q(b))' README.md",
  "ruby -pi.bak -e 'x' README.md",
  "awk -i inplace '{print}' README.md",
  "gawk -i inplace '{print}' README.md",
  "gawk -iinplace '{print}' README.md",
  "gawk --include=inplace '{print}' README.md",
  "vim -c '%s/a/b/g' -c wq README.md",
  'vim -es +%s/a/b/g +wq README.md',
  "nvim --cmd 'set x' -c wq README.md",
  "ex -sc '%s/a/b/|x' README.md",
  'ed -s README.md',
  "rg -l a | xargs sed -i 's/a/b/'",
  "find . -name '*.md' -exec sed -i 's/a/b/' {} ;",
  "timeout 5 sed -i 's/a/b/' README.md",
  `bash -c "sed -i 's/a/b/' README.md"`,
  // No file it can place outside the project: it may edit whatever it was handed.
  "sed -i 's/a/b/'",
  "sed -i 's/a/b/' /tmp/x README.md",
  // A newline ends a command: an edit on a later line runs whatever the first one was.
  "echo hi\nsed -i 's/a/b/' README.md",
  "cd packages/core\nsed -i 's/a/b/' src/tool/tool.utils.ts",
  // A loop's body runs its command: `do` doesn't hide the edit after it.
  "for f in README.md; do sed -i 's/a/b/' $f; done",
  // Nor does any other keyword that opens a command, on one line or several.
  'for f in a; do cp /tmp/x packages/core/src/x.ts; done',
  'if true; then cp /tmp/x packages/core/src/x.ts; fi',
  "if sed -i 's/a/b/' README.md; then echo ok; fi",
  "while sed -i 's/a/b/' README.md; do break; done",
  "until sed -i 's/a/b/' README.md; do break; done",
  '! cp /tmp/x packages/core/src/x.ts',
  'time cp /tmp/x packages/core/src/x.ts',
  // Inline programs (a heredoc, `-c`, `-e`) that write files.
  "python3 - <<'EOF'\nopen('packages/core/src/x.ts','w').write('x')\nEOF",
  "python3 <<'EOF'\nfrom pathlib import Path\nPath('README.md').write_text('x')\nEOF",
  `python3 -c "open('README.md', 'a').write('x')"`,
  `node -e "require('fs').writeFileSync('packages/core/src/x.ts', 'x')"`,
  `node --eval "fs.appendFileSync('README.md', 'x')"`,
  "cd packages/core && python3 - <<'EOF'\nopen('src/x.ts','w').write('x')\nEOF",
  // A write with no path it can place: built from a variable.
  "python3 - <<'EOF'\np = base + name\nopen(p,'w').write(s)\nEOF",
  // The command that taught the guard the technique (a test edit through a python heredoc).
  "python3 - <<'EOF'\np='packages/runtime/src/approvals/__tests__/approvals.service.test.ts'\ns=open(p).read()\ns=s.replace(\"\"\"  it('rejects at once when no one is listening', async () => {\n    await expect(ask(new ApprovalRegistry())).rejects.toThrow('No one is listening');\n  });\"\"\",\"\"\"  it('rejects at once when no one is listening', async () => {\n    await expect(ask(new ApprovalRegistry())).rejects.toThrow('No one is listening');\n  });\n\n  it('tells observers every update first, but an observer alone can’t answer', async () => {\n    const approvals = new ApprovalRegistry();\n    const order: string[] = [];\n\n    approvals.observe((update) => order.push(`observer:${update.type}`));\n    await expect(ask(approvals)).rejects.toThrow('No one is listening');\n    expect(approvals.listening).toBe(false);\n\n    approvals.subscribe((update) => order.push(`listener:${update.type}`));\n    void ask(approvals);\n\n    expect(order).toEqual(['observer:approval_requested', 'listener:approval_requested']);\n  });\"\"\")\nopen(p,'w').write(s)\n\np='packages/runtime/src/sessions/__tests__/combined-stream.test.ts'\ns=open(p).read()\ns=s.replace(\"\"\"  it('stops telling a listener once it unsubscribes', () => {\"\"\",\"\"\"  it('files each approval and its answer under the session whose tool asked', () => {\n    const sessions = new SessionRegistry();\n    const main = sessions.startMain({ title: 'Main' });\n    const child = sessions.startChild({ parentId: main.id, title: 'Child' });\n    const entries: StreamEntry[] = [];\n    const request = (id: string, sessionId?: SessionId) => ({\n      type: 'approval_requested' as const,\n      request: {\n        id: approvalIdSchema.parse(id),\n        callId: callIdSchema.parse('c'),\n        ...(sessionId && { sessionId }),\n        tool: 'run_command',\n        command: 'rm -rf build',\n        concerns: [],\n        options: ['approve', 'skip', 'skip_with_message'] as const,\n      },\n    });\n\n    sessions.subscribeEntries((entry) => entries.push(entry), { sessionId: child.id });\n    sessions.publishApproval(request('a1', child.id));\n    sessions.publishApproval({\n      type: 'approval_resolved',\n      id: approvalIdSchema.parse('a1'),\n      response: { decision: 'approve' },\n    });\n    // A call outside the loop names no session: it goes under the main one, not the child.\n    sessions.publishApproval(request('a2'));\n\n    expect(entries.map((entry) => `${entry.kind}:${entry.kind === 'approval' ? entry.update.type : ''}`)).toEqual([\n      'approval:approval_requested',\n      'approval:approval_resolved',\n    ]);\n\n    const all: StreamEntry[] = [];\n\n    sessions.subscribeEntries((entry) => all.push(entry), { replay: true });\n    expect(all.at(-1)).toMatchObject({ kind: 'approval', sessionId: main.id });\n  });\n\n  it('stops telling a listener once it unsubscribes', () => {\"\"\")\ns=s.replace(\"\"\"import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';\"\"\",\"\"\"import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';\nimport { approvalIdSchema } from '@sheavly/protocol/approval/approval.validator';\nimport { callIdSchema } from '@sheavly/protocol/message/message.validator';\"\"\")\nopen(p,'w').write(s)\nEOF\nnpx prettier --write packages/runtime/src >/dev/null 2>&1; npx tsc --noEmit -p packages/runtime 2>&1 | rg -v \"npm notice\"; npm test -w @sheavly/runtime 2>&1 | rg -v \"npm notice\" | rg \"Tests |FAIL|AssertionError|Expected|Received\" | head -8",
  // Copying or moving a file into the project.
  'cp /tmp/x.ts packages/core/src/x.ts',
  'mv /tmp/x.ts packages/core/src/',
  'cp -t packages/core/src /tmp/x.ts',
  'install -m 644 /tmp/x.ts README.md',
  'rsync /tmp/x.ts packages/core/src/x.ts',
  'cd packages/core && cp /tmp/x.ts src/x.ts',
  // `git mv` is a move like `mv`: write the file at its new path and delete the old one instead.
  'git mv packages/core/src/a.ts packages/core/src/b.ts',
  'git mv apps/terminal/src/harness apps/backend/src/harness 2>&1 || (mkdir -p apps/backend/src && git mv apps/terminal/src/harness apps/backend/src/harness) && git mv apps/terminal/src/serve.ts apps/backend/src/serve.ts && ls apps/backend/src apps/backend/src/harness && git status --short | head -30',
  // No destination it can place: it may write anywhere it was handed.
  'cp /tmp/x.ts',
  // Redirecting output into a project file is a write past the edit tools.
  "printf '  }\\n}\\n' >> apps/backend/src/api/handlers.helper.ts; tail -5 apps/backend/src/api/handlers.helper.ts",
  'echo x > README.md',
  'echo x >README.md',
  'cat /tmp/x.ts >> packages/core/src/x.ts',
  "cat > packages/core/src/x.ts <<'EOF'\nexport const x = 1;\nEOF",
  'npm run build 2> build.log',
  'echo x &> README.md',
  'cd packages/core && echo x > src/x.ts',
  // A target it can't place (quoted, so a variable or a path with spaces) fails closed.
  'echo x > "$FILE"',
  // Inline code in one line with a writer: the line's writes can't be put on the writer alone.
  `npm pkg set -w @sheavly/x 'exports[./a]=./b' && node -e "console.log(1)"`,
  `npm pkg set -w @sheavly/server 'exports[./testing/*][@sheavly/source]=./src/testing/*.ts' && node -e "console.log(JSON.stringify(require('./packages/server/package.json').exports['./testing/*']))" && npm install -D -w @sheavly/terminal @sheavly/host@0.0.0 2>&1 | tail -1`,
  // A deletion in one line with a writer: what each changed can't be told apart.
  'npm uninstall -D -w @sheavly/server @hey-api/openapi-ts 2>&1 | tail -1; git status --short; rm -rf /tmp/heyapi-probe',
  'npm install -D -w @sheavly/x zod && rm -rf node_modules/.cache',
  'git checkout main; rm -rf /tmp/probe',
  // The command that taught the guard the technique (a test file copied in from /tmp).
  "cat > /tmp/order.test.ts <<'EOF'\nimport { it } from 'vitest';\nimport { readEntries, reply, testServer } from '/home/gustaf/projects/coding-harness/packages/server/src/testing/server.fake.js';\nit('prints the order', async () => {\n  const { request } = testServer({ hi: [reply('hello'), reply('again')] });\n  const { id } = (await (await request('/conversations', { method: 'POST', body: {} })).json()) as { id: string };\n  for (const text of ['hi', 'again?']) {\n    const r = await request(`/conversations/${id}/prompts`, { method: 'POST', body: { text } });\n    for await (const { entry } of readEntries(r.body)) console.log(text, entry.seq, entry.kind, entry.kind === 'event' ? entry.event.type : entry.update.type);\n  }\n  const s = await request(`/conversations/${id}/stream`, { method: 'QUERY', body: { replay: true } });\n  let n = 0;\n  for await (const { entry } of readEntries(s.body)) { console.log('replay', entry.seq, entry.kind === 'event' ? entry.event.type : entry.update.type); if (++n > 12) break; }\n});\nEOF\ncp /tmp/order.test.ts packages/server/src/server/__tests__/zz-order.test.ts && timeout 60 npx vitest run --config vitest.config.ts packages/server/src/server/__tests__/zz-order.test.ts --root packages/server 2>&1 | rg \"^(hi|again|replay) \" | head -40",
];

// Read-only uses and edits outside the project, which must stay allowed.
export const ALLOWED_CASES = [
  'npx prettier --write README.md',
  'npx eslint README.md --fix',
  `python3 -c "import subprocess; subprocess.run(['git', 'diff', '--name-only'])"`,
  `python3 -c "import subprocess; subprocess.run(['npx', 'prettier', '--check', 'README.md'])"`,
  `node -e "require('node:child_process').execFileSync('git', ['status', '--short'])"`,
  `python3 -c "import subprocess; subprocess.run(['npx', 'prettier', '--write', '/tmp/out.ts'])"`,
  `node -e "require('node:child_process').spawnSync('npx', ['prettier', '--write', '/tmp/out.ts'])"`,
  `python3 -c "import subprocess; print('prettier --write README.md'); subprocess.run(['git', 'status'])"`,
  "sed -n '1,20p' README.md",
  "sed 's/a/b/' README.md",
  "sed -e 's/a/b/' README.md > /tmp/x",
  'git show HEAD:README.md | sed -n 1,5p',
  "perl -ne 'print if /a/' README.md",
  "perl -pe 's/a/b/' README.md",
  "awk '{print $1}' README.md",
  "awk -i ./lib.awk '{print}' README.md",
  "sed -i 's/a/b/' /tmp/x",
  "cd /tmp && sed -i 's/a/b/' x",
  "perl -pi -e 's/a/b/' /tmp/x",
  'vim -R README.md',
  "rg 'sed -i' docs",
  'echo sed -i README.md',
  'git log --oneline --grep "sed -i"',
  `git commit -m "fix(core): stop sed -i README.md from slipping past the hooks"`,
  // Inline programs that only read or print, or write outside the project.
  "python3 - <<'EOF'\nprint(open('README.md').read()[:100])\nEOF",
  `python3 -c "import json; print(json.load(open('package.json'))['name'])"`,
  `node -e "console.log(require('./package.json').version)"`,
  "python3 - <<'EOF'\nopen('/tmp/out.txt','w').write('x')\nEOF",
  `node -e "require('fs').writeFileSync('/tmp/x.json', '{}')"`,
  // The project's own scripts are its writers; a writer and a read in separate commands.
  'node scripts/check-layout.mjs',
  'npm run schema -w @sheavly/protocol',
  `npm pkg get exports -w @sheavly/server`,
  // Copies out of the project, or between places outside it; a copier named only in data.
  'cp packages/core/src/x.ts /tmp/x.ts',
  'cp -r docs /tmp/docs-backup',
  'mv /tmp/a /tmp/b',
  // Moving a file out of the project edits nothing in it.
  'git mv packages/core/src/a.ts /tmp/a.ts',
  `rg -n "\\bcp |\\bmv |rsync|install " .cursor/hooks/shell-guard-cases.utils.mjs`,
  'echo cp a b',
  // A deletion alone on its line, or a writer beside commands that delete nothing.
  'rm -rf /tmp/heyapi-probe',
  'npm uninstall -D -w @sheavly/x zod 2>&1 | tail -1; git status --short',
  'rg "rm -rf" docs && npm run check',
  // Redirects that write nothing in the project: outside it, to /dev/null, a descriptor copy, or
  // a `>` that is quoted data.
  'echo x > /tmp/x.txt',
  'echo x >> /tmp/x.txt',
  'npm test > /dev/null 2>&1',
  'npm test 2>/dev/null | tail -5',
  'npm run check 2>&1 | rg "Tasks:"',
  'echo error >&2',
  "rg '=>' packages/core/src",
  `rg "a > b" README.md`,
  'cat packages/core/src/x.ts > /tmp/x.ts',
  'cd /tmp && echo x > x.txt',
];
