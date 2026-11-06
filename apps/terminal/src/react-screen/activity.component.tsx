import { Text, useAnimation } from 'ink';
import type { StatusInfo } from '../tui/tui.types.js';

/** Real state takes priority over motion; cancellation is always visible while working. */
export function Activity(props: StatusInfo) {
  const { state, model, modelMode, mode, tasks } = props;
  const { frame, time } = useAnimation({ interval: 100, isActive: state === 'working' });
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const working = state === 'working';
  const label = state === 'waiting' ? 'waiting for you' : state;
  const icon = working ? frames[frame % frames.length] : '●';

  return (
    <Text wrap="truncate-end">
      <Text color={state === 'ready' ? 'green' : 'yellow'}>
        {icon} {label}
      </Text>
      {working && <Text dimColor> · {Math.floor(time / 1000)}s · Ctrl+C to stop</Text>}
      <Text dimColor>
        {' '}
        · {model}
        {modelMode ? ` · ${modelMode}` : ''} · mode:{' '}
      </Text>
      <Text {...(mode === 'allow_all' ? { color: 'red' } : {})}>{mode}</Text>
      {tasks > 0 && <Text dimColor> · {tasks} background</Text>}
    </Text>
  );
}
