# JASIM reference source

`original-jisim-source.zip` is the canonical, byte-for-byte source import supplied for this project.

The expanded files beside it are a working reference copy of the application and its general runtime layers. The source archive includes a historical path collision between a file and a directory named `.github`, and another named `mobile`; those two impossible-to-represent pairs are preserved safely in the original archive rather than being rewritten.

The implementation built in this workspace must treat the archive and the extracted `api/core` and `contracts` modules as reference material. It must not collapse the runtime into hard-coded vertical scenarios.