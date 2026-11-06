import { Box, Static, Text, useCursor } from 'ink';
import { Activity } from './activity.component.js';
import { liveLayout } from './layout.utils.js';
import type { ReactScreenProps } from './react-screen.types.js';

/** Native scrollback is append-only. Only the bounded footer participates in redraws. */
export function ReactScreen(props: ReactScreenProps) {
  const { lines, cursor } = liveLayout(props);
  const { setCursorPosition } = useCursor();

  // Ink reads this during its insertion effect; setting it later lags one frame behind typing.
  setCursorPosition(cursor);

  return (
    <>
      <Static items={props.history}>
        {(line) => (
          <Text key={line.id} wrap="truncate-end">
            {line.text || ' '}
          </Text>
        )}
      </Static>
      <Box flexDirection="column" width={props.columns}>
        <Activity {...props.status} />
        {lines.map((line, index) => (
          <Text key={index} wrap="truncate-end">
            {line || ' '}
          </Text>
        ))}
      </Box>
    </>
  );
}
