// Lint says what is wrong; the skills say why and what to do instead. A skill lists the
// `harness/*` rules it explains in its `harness.json` (`lintRules`, and `ruleFiles` to name the
// guide inside it), and this appends that pointer to every message of those rules. The rules'
// behaviour is untouched: only the text a violation carries changes, so the pointer reaches an
// agent through the post-edit hook and a person through CI output alike.
import path from 'node:path';
import { listSkills } from './skills.js';
import { SkillMetadataError } from './skills.errors.js';

const RULE_PREFIX = 'harness/';

function guideOf(params) {
  const { skill, ruleId } = params;
  const guide = skill.ruleFiles[ruleId];

  if (!guide) return `\`${skill.skillFile}\``;

  return `\`${path.posix.join(skill.dir, guide)}\` (routed from \`${skill.skillFile}\`)`;
}

function pointerFor(params) {
  const { skills, ruleId } = params;
  const guides = skills.map((skill) => guideOf({ skill, ruleId })).join(' and ');

  return `The judgement around this rule is in ${guides}; read it before deciding how to fix this.`;
}

function withPointer(params) {
  const { rule, pointer } = params;
  const messages = Object.fromEntries(
    Object.entries(rule.meta.messages).map(([id, message]) => [id, `${message} ${pointer}`]),
  );

  return { ...rule, meta: { ...rule.meta, messages } };
}

/** The skills that name each rule, by the rule's name without its `harness/` prefix. */
function skillsByRule(params) {
  const { rules, root } = params;
  const byRule = new Map();

  for (const skill of listSkills(root)) {
    for (const ruleId of skill.lintRules) {
      const name = ruleId.startsWith(RULE_PREFIX) ? ruleId.slice(RULE_PREFIX.length) : undefined;

      if (!name || !rules[name]?.meta?.messages) {
        throw new SkillMetadataError({
          file: `${skill.dir}/harness.json`,
          problem: `\`lintRules\` names \`${ruleId}\`, which is no \`harness/*\` rule with messages`,
        });
      }

      byRule.set(name, [...(byRule.get(name) ?? []), skill]);
    }
  }

  return byRule;
}

/**
 * `rules` with the guide of each rule a skill names in `lintRules` appended to its messages. New
 * rule objects, so a rule imported on its own keeps its own text. Throws `SkillMetadataError` for a
 * `lintRules` entry no rule answers to, so a stale mapping fails instead of going quiet.
 */
export function pointRulesToSkills(params) {
  const { rules, root } = params;
  const byRule = skillsByRule({ rules, root });

  return Object.fromEntries(
    Object.entries(rules).map(([name, rule]) => {
      const skills = byRule.get(name);

      if (!skills) return [name, rule];

      return [
        name,
        withPointer({ rule, pointer: pointerFor({ skills, ruleId: `${RULE_PREFIX}${name}` }) }),
      ];
    }),
  );
}
