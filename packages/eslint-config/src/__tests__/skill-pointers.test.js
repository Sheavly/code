// A skill names the rules it explains; their messages then carry the guide. Only the text changes:
// what a rule accepts and rejects is the rule's own, so these tests hold both halves.
import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { pointRulesToSkills } from '../skill-pointers.js';
import { SkillMetadataError } from '../skills.errors.js';
import { listSkills, SKILLS_DIR } from '../skills.js';
import { useSkillRepos } from '../testing/skill-repo.fake.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const DIR = `${SKILLS_DIR}/zz-skill`;
const repoWithSkill = useSkillRepos();

const rawErrors = {
  meta: { type: 'problem', schema: [], messages: { raw: 'No raw Error.' } },
  create: (context) => ({
    ThrowStatement: (node) => context.report({ node, messageId: 'raw' }),
  }),
};
const rules = { 'no-throw': rawErrors, other: { ...rawErrors } };

/** A throwaway repo with one skill holding `metadata` and the `guides` beside its SKILL.md. */
function repo(params) {
  const { metadata, guides = [] } = params;

  return repoWithSkill({
    metadata,
    extra: Object.fromEntries(guides.map((guide) => [`${DIR}/${guide}`, ''])),
  });
}

describe('pointRulesToSkills', () => {
  it('appends the skill to every message of a rule it names, and only that rule', () => {
    const root = repo({ metadata: { governs: ['a'], lintRules: ['harness/no-throw'] } });
    const pointed = pointRulesToSkills({ rules, root });

    expect(pointed['no-throw'].meta.messages.raw).toBe(
      `No raw Error. The judgement around this rule is in \`${DIR}/SKILL.md\`; read it before deciding how to fix this.`,
    );
    expect(pointed.other).toBe(rules.other);
  });

  it('names the guide a router skill routes the rule to', () => {
    const root = repo({
      metadata: {
        governs: ['a'],
        lintRules: ['harness/no-throw'],
        ruleFiles: { 'harness/no-throw': 'errors.md' },
      },
      guides: ['errors.md'],
    });

    expect(pointRulesToSkills({ rules, root })['no-throw'].meta.messages.raw).toContain(
      `\`${DIR}/errors.md\` (routed from \`${DIR}/SKILL.md\`)`,
    );
  });

  it('leaves the original rule object and its text alone', () => {
    const root = repo({ metadata: { governs: ['a'], lintRules: ['harness/no-throw'] } });

    pointRulesToSkills({ rules, root });

    expect(rules['no-throw'].meta.messages.raw).toBe('No raw Error.');
  });

  it('fails on a lintRules entry that is no rule, saying which', () => {
    const root = repo({ metadata: { governs: ['a'], lintRules: ['harness/gone'] } });

    expect(() => pointRulesToSkills({ rules, root })).toThrow(SkillMetadataError);
    expect(() => pointRulesToSkills({ rules, root })).toThrow(/names `harness\/gone`, which is no/);
  });

  it('fails on a rule id from another plugin, so it cannot go quiet', () => {
    const root = repo({ metadata: { governs: ['a'], lintRules: ['max-lines'] } });

    expect(() => pointRulesToSkills({ rules, root })).toThrow(/names `max-lines`/);
  });
});

describe('a pointed rule still judges the same code', () => {
  const root = repo({ metadata: { governs: ['a'], lintRules: ['harness/no-throw'] } });
  const pointed = pointRulesToSkills({ rules, root })['no-throw'];
  const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

  tester.run('no-throw (pointed)', pointed, {
    valid: ['const a = 1;'],
    invalid: [{ code: "throw new Error('x');", errors: [{ messageId: 'raw' }] }],
  });
});

describe('the harness plugin', () => {
  const POINTER = 'The judgement around this rule is in';
  const mapped = new Set(
    listSkills(ROOT).flatMap(({ lintRules }) => lintRules.map((id) => id.replace('harness/', ''))),
  );
  const carries = (rule) => Object.values(rule.meta.messages).every((m) => m.includes(POINTER));

  it('points every rule a skill maps to its guide, on every message', () => {
    for (const name of mapped) expect(carries(harnessPlugin.rules[name]), name).toBe(true);
  });

  it("keeps every other rule's own message", () => {
    const others = Object.entries(harnessPlugin.rules).filter(([name]) => !mapped.has(name));

    for (const [name, rule] of others) {
      for (const message of Object.values(rule.meta.messages)) {
        expect(message, name).not.toContain(POINTER);
      }
    }
  });
});
