import { describe, expect, it } from 'vitest';
import { SearchChains } from '../search-chains.service.js';

describe('SearchChains', () => {
  it('shares one chain, and so its cooldowns, between conversations asking for one order', () => {
    const chains = new SearchChains();

    expect(chains.chainFor(['tavily', 'exa'])).toBe(chains.chainFor(['tavily', 'exa']));
  });

  it('keeps different orders apart', () => {
    const chains = new SearchChains();

    expect(chains.chainFor(['tavily', 'exa'])).not.toBe(chains.chainFor(['exa', 'tavily']));
  });

  it('shares nothing between two registries', () => {
    expect(new SearchChains().chainFor(['tavily'])).not.toBe(
      new SearchChains().chainFor(['tavily']),
    );
  });
});
