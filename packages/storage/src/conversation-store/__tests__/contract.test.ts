import { describeConversationStore } from '@sheavly/testing/store/store-contract.fake';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { FileConversationStore } from '../conversation-store.service.js';

const temp = useTempFolder('file-conversations-');

describeConversationStore({
  name: 'FileConversationStore',
  make: () => new FileConversationStore({ folder: temp.path(), onProblem: () => undefined }),
});
