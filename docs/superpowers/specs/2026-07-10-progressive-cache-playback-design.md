# Progressive Cache Playback Design

## Goal

Keep an uncached track on the same progressive lossless playback path for its
entire playback session, while retaining the completed file for a later
session. Fix FLAC WebCodecs initialization so large metadata blocks do not
leave progressive playback silent.

## Playback Session Policy

A playback surface is identified by track, source identity, and media epoch.
Pause, resume, seek, and loop operations remain on the existing surface and
must not change the selected source. A track change, stop followed by a new
play command, or a new media epoch creates a new surface.

The source is selected once when the surface begins:

- If a complete local file already exists, use `full-local`.
- Otherwise use `lossless-local`/`progressive-local` for the whole surface.
- Completing the cache during that surface only updates the cache library. It
  does not reinitialize playback or warm a handoff to `full-local`.

## FLAC Decoder Configuration

The FLAC parser must not pass artwork, comments, or a partial metadata chain to
`AudioDecoder.configure()`. It will build a canonical decoder description from
the 34-byte STREAMINFO payload: `fLaC`, a final STREAMINFO metadata header, and
the STREAMINFO bytes. Packet scanning begins only after the complete metadata
chain is available, so embedded artwork cannot be mistaken for audio frames.

`AudioDecoder.flush()` remains the readiness barrier that makes queued decoder
output observable before playback starts. If it rejects, diagnostics preserve
the concrete WebCodecs error rather than replacing it with only
`decoder-flush-failed`.

## Verification

Regression tests cover source-key stability when cache completion occurs on an
active surface, source reinitialization on the next surface, partial metadata,
large complete metadata, canonical decoder description, and detailed flush
errors. The Web test suite, typecheck, lint, and production build must pass.
