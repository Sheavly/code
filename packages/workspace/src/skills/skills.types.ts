import type { PromptPart } from '@sheavly/protocol/message/message.types';
import type { SkillScope } from '@sheavly/protocol/skill/skill.types';

/** A skill that was found: what it is called, what it is for, and where its files are. */
export type Skill = {
  name: string;
  description: string;
  /** Only the user runs it (`disable-model-invocation`); the model isn't offered it. */
  manualOnly: boolean;
  /** Its folder (absolute): `SKILL.md` and the files it links to. */
  dir: string;
  /** The project's skill, one from the user's home, or one the harness ships. */
  scope: SkillScope;
};

/** A skill that didn't load: where it is and why. The other skills still load. */
export type SkillProblem = {
  path: string;
  reason: string;
};

/** A skill that loaded but another with its name won (`findSkills`'s order): it never runs. */
export type HiddenSkill = { skill: Skill; by: Skill };

/** Every skill that loaded, after precedence, every one that didn't, and every one that lost. */
export type FoundSkills = {
  skills: Skill[];
  problems: SkillProblem[];
  hidden: HiddenSkill[];
};

/** A file read from a skill's folder: the skill, the file's real path, and its text. */
export type SkillFile = {
  skill: Skill;
  path: string;
  text: string;
};

/** Where to look: the project root and the user's home (each with `.sheavly/` and `.agents/`). */
export type SkillRoots = {
  root: string;
  /** The user's home folder, for user-level skills; omit to read only the project's. */
  home?: string | undefined;
};

/** What a user's message sends, with its skills run (`skillRequest`). */
export type SkillRequest = {
  /** The message to send: the skills' instructions, then the text; or the text unchanged. */
  text: string;
  /** What the user typed, when skills ran: kept on the message for a UI (`Message.parts`). */
  parts?: PromptPart[];
  /** The skills it ran, in the order the text mentions them. */
  skills: string[];
  /** Mentions (`/<name>`) in `text` that no skill has; `parts` with one throws instead. */
  unknown: string[];
};

/** A `/<name>` in a user's message: the name, and where it is (`start` at the `/`, `end` after). */
export type SkillMention = { name: string; start: number; end: number };

/**
 * What a UI offers while the user types `/<partial>`: what to replace, and the skills that fit (of
 * whatever kind it listed: the workspace's `Skill`s, or a server's `SkillInfo`).
 */
export type SkillCompletion<S extends Pick<Skill, 'name'> = Skill> = {
  /** What was typed after the `/`; empty for a bare `/`. */
  query: string;
  /** The text a picked name replaces: from the `/` to the cursor. */
  start: number;
  end: number;
  /** The skills that fit, best first. */
  matches: S[];
};
