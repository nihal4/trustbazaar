# Cleaning the AI trailers out of the history (P0-11)

On 2026-11-25, 451 commits on `main` (820 of 1,667 across all branches) carried `Co-Authored-By: Claude ...` and `Claude-Session: https://claude.ai/...` lines in their messages. New ones are stopped by `.claude/settings.json` (turns Claude Code's attribution off for anyone working in this repo) and by `scripts/check_commit_trailers.py` (a CI check on pull requests). This runbook cleans the old ones. **It rewrites every commit hash and needs a force-push to `main`: do it only when all three authors agree.**

Tested on a throwaway mirror clone: after the rewrite no commit mentions Claude or Anthropic, all branches and tags are kept, other trailers are untouched.

## Before

1. All three authors agree, and no pull request is being merged. Say so in the group chat; merge or park open pull requests first.
2. A repo admin is available (the branch rule on `main` forbids force-pushes and applies to admins).
3. `brew install git-filter-repo` (or `pip install git-filter-repo`).

## Steps (one person, in a new empty folder, never in a working copy)

```sh
git clone --mirror https://github.com/nihal4/trustbazaar.git trustbazaar-clean.git
cp -R trustbazaar-clean.git trustbazaar-backup.git          # keep this until everyone has re-cloned
cd trustbazaar-clean.git
git filter-repo --force --message-callback "$(cat /path/to/scripts/strip-ai-trailers.py)"
# drop GitHub's read-only pull request refs (they cannot be pushed)
git for-each-ref --format='delete %(refname)' refs/pull | git update-ref --stdin
git log --all --format=%B | grep -ciE 'claude|anthropic'    # must print 0
```

Allow the push (admin), push, and put the rule back:

```sh
gh api -X PUT repos/nihal4/trustbazaar/branches/main/protection ...   # or: Settings > Branches > main: allow force pushes, turn off "include administrators"
git push --force --all origin
git push --force --tags origin
# put the branch rule back exactly as it was (1 approving review, CODEOWNERS, status checks, no force-pushes, include administrators)
```

## After (everyone)

```sh
cd trustbazaar && cd .. && mv trustbazaar trustbazaar-old
git clone https://github.com/nihal4/trustbazaar.git
```

Work that exists only in the old folder (an unpushed branch): `git format-patch origin/main..mybranch` in the old folder, then `git am` in the new clone.

Pull requests: merged ones stay as they are (their links and text are kept, the commit hashes in them change). Open pull requests and Dependabot branches must be recreated from the new `main`. Check `git log origin/main | grep -ci claude` prints 0.

## Limits

- GitHub keeps the old commits reachable through its own pull request refs for a while; to have them purged, ask GitHub support to run a garbage collection and to clear cached views.
- The `Claude-Session:` lines are links to private session pages; they are removed too.
- Signed commits (GitHub's own merge commits) lose their signature when rewritten.
