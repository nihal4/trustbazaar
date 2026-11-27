// The form of a commit message (U11-01): Conventional Commits (type(scope): subject), as the history already has: `feat(U10-25): ...`, `fix(U10-27): ...`, `docs(...)`.
// The scope is a task id and may name several (`U10-26, U10-27`), so its case is free; a long body is welcome.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-case': [0],
    'subject-case': [0],
    'header-max-length': [1, 'always', 140],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
