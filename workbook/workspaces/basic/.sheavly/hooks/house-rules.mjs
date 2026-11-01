// sessionStart (.mjs): one opening rule, visible as `context_added` in every run.
export default {
  name: 'house-rules',
  sessionStart: async ({ addContext }) =>
    addContext('House rule: end every final answer with the word "Sheavly".'),
};
