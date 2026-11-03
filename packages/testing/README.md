# @sheavly/testing

Test fakes for every workspace: scripted providers, fake fetch, tool runners. Tests and fakes only.

Fakes by what they fake, imported by subpath (`@sheavly/testing/provider/scripted-provider.fake`):

- `provider/`: `scriptedProvider`, `callOnceProvider`, `routedProvider`, `createStepPicker`, the `Script` type
- `fetch/`: `fakeFetch`, `fakeFetchSequence`, `collect`, `requestSentBy`, the `RecordedRequest` type
- `tool/`: `toolRunner`, which runs tools the way the loop does
- `wait/`: `until`, which polls a condition

Test-only (`"sheavly": { "testOnly": true }`): depend on it as a dev dependency, and import it only
from tests and fakes; `harness/imports` fails it anywhere else. It depends on `@sheavly/core` and
`@sheavly/protocol`, so core's own tests can't use it.
