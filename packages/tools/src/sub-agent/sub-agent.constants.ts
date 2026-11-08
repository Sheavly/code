/** The child role follows injected shared guidance and precedes child-specific extras. */
export const SUB_AGENT_INSTRUCTIONS = `# Sub-agent role
Work only on the assigned task. Use report_status before starting and when changing steps. Incorporate parent messages without losing valid requirements. Return a concise handoff with findings or changes, checks and blockers.`;
