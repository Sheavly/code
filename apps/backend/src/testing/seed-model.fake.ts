import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import type { testBackend } from './backend.fake.js';

/**
 * Test-only: gives `backend` one profile with one fake OpenAI model and its key, as the default,
 * so a conversation can start and its model calls reach the backend's `fetch`.
 */
export async function seedFakeModel(backend: ReturnType<typeof testBackend>): Promise<void> {
  const profile = profileIdSchema.parse('00000000-0000-4000-8000-000000000001');
  const model = modelIdSchema.parse('00000000-0000-4000-8000-000000000002');

  await backend.setup.putProfile({ id: profile, name: 'Test' });
  await backend.setup.putModel({
    profile,
    id: model,
    model: { name: 'Fake', adapter: 'openai', definition: { model: 'test' } },
  });
  await backend.setup.putCredential({ profile, model, secrets: { apiKey: 'fake-test-key' } });
  await backend.setup.setDefaultProfile(profile);
}
