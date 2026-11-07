/** App-owned hosting policy; model names and connection settings are separate choices. */
export type SetupHostingTemplate = {
  adapter: string;
  name: string;
  families: string[];
  modelField: 'model' | 'deployment';
  defaults: Record<string, unknown>;
};
