# Body of a `git filter-repo --message-callback` (P0-11 runbook): removes AI co-author, session and "generated with" lines from commit messages.
#   git filter-repo --force --message-callback "$(cat scripts/strip-ai-trailers.py)"
import re
drop = re.compile(rb"^\s*(co-authored-by:.*(claude|anthropic)|claude-session:|generated with \[?claude code)", re.I)
kept = [l for l in message.split(b"\n") if not drop.match(l)]
return b"\n".join(kept).rstrip(b"\n") + b"\n"
