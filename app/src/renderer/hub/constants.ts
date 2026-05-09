export const INPUT_PLACEHOLDER = 'What should the agent do?' as const;

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  running: 'Running',
  stuck: 'Stuck',
  paused: 'Paused',
  stopped: 'Stopped',
  idle: 'Idle',
};
