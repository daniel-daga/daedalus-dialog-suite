# Review of self-write-echo.md

2026-09-25. Request changes before implementing issue #282. Static review of
the plan against FileService, FileWatcherService, SaveFileFlow, useFileWatcher,
fileStore and the existing real-Electron external-change spec; no tests run.

## P1: Capture identity from the write, not a later path lookup

Plan lines 51-53 and 64-69 assume the post-rename stat describes our write.
An external process can replace or modify the target after the rename and
before that asynchronous stat completes. The returned signature then belongs
to the external edit, and retaining it suppresses that edit indefinitely,
even on a filesystem with precise mtimes. Bind the signature to the staged
file we wrote, or compare disk bytes with the encoded buffer we actually
wrote. Add a deterministic test for an external replacement between rename
and post-write stat. Also remove the claim at lines 89-90 that mtime/size is
exact content identity.

## P1: Cover events before suppression registration

Plan lines 54-61 keep registration in callers after writeFile resolves.
FileService awaits a post-rename stat before returning, while the watcher
can already emit the rename's event. If that stat is slow, the event can pass
through before notifySelfWrite installs the new signature. This preserves
the self-echo reload/conflict failure on the slow paths motivating the fix.
Define an in-flight write protocol that defers classification until the
write result is known, without dropping genuine external changes, and test
an event delivered while post-write work is still pending. Preserve correct
behavior on failed writes as well.

## P2: Make the regression trigger deterministic

Plan lines 110-117 type, wait for an auto-save and watcher settlement, then
type again. With one event delivered within two seconds, master already
passes; the later typing also does not overlap a reload. Explicitly arrange
a delayed event, duplicate event or overlapping saves and synchronize a
pending edit with delivery. Keep real-Electron coverage of the real field,
but use controlled fault injection or a focused integration test to prove
the original failure and the fix; elapsed wall time alone is not a trigger.
