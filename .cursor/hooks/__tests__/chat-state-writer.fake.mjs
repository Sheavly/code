// Run as a child process by the chat-state tests: writes one field of chat `c1` again and again,
// the way a hook does, so several of them race on the same state file.
import { keepShownInChat, updateChatState } from '../chat-state.utils.mjs';

const [field, value, times] = process.argv.slice(2);

for (let round = 0; round < Number(times); round += 1) {
  // A list field is appended to, as the hooks do, so the writers add to one list together.
  if (field === 'skillHintsShown') {
    keepShownInChat({ conversationId: 'c1', field, values: [JSON.parse(value)] });
  } else {
    updateChatState({ conversationId: 'c1', [field]: JSON.parse(value) });
  }
}
