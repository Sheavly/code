// The post-edit hook's skill hint. Which skills exist and which files each governs is read by the
// shared reader (`packages/eslint-config/src/skills.js`), the same one the lint plugin uses, so a
// new skill is wired in by its own `harness.json`, never by a list here.
import path from 'node:path';
import { findGoverningGuides } from '../../packages/eslint-config/src/skills.js';
import { keepShownInChat, shownInChat } from './chat-state.utils.mjs';
import { PROJECT_ROOT } from './hooks.utils.mjs';

// What a chat has been shown is keyed by the skill (`git`) or by one of its guides
// (`sheavly/loop.md`), so a broad router shown once never hides a narrower guide.
const shownKey = ({ skill, guide }) => (guide ? `${skill.name}/${guide}` : skill.name);

function hintLine(params) {
  const { relative, skill, guide } = params;

  if (!guide) {
    return `Skill: ${relative} is governed by the \`${skill.name}\` skill. If you haven't this chat, read ${skill.skillFile} before going further; lint checks the mechanics, the skill holds the judgement.`;
  }

  return `Guide: ${relative} is covered by \`${path.posix.join(skill.dir, guide)}\`, a guide of the \`${skill.name}\` skill. If you haven't this chat, read it before going further.`;
}

/**
 * One line per skill, and per guide of it, governing `relative` that this chat hasn't been shown
 * yet; records them.
 */
export function hintGoverningSkills(params) {
  const { conversationId, relative, root = PROJECT_ROOT } = params;
  const shown = shownInChat({ conversationId, field: 'skillHintsShown' });
  const entries = findGoverningGuides({ root, relative }).filter(
    (entry) => !shown.has(shownKey(entry)),
  );

  if (entries.length === 0) return [];

  keepShownInChat({ conversationId, field: 'skillHintsShown', values: entries.map(shownKey) });

  return entries.map(({ skill, guide }) => hintLine({ relative, skill, guide }));
}
