/** An environment an app passes in (`process.env`): packages never read it themselves. */
export type Environment = Readonly<Record<string, string | undefined>>;
