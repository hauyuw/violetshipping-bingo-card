---
allowed-tools: AskUserQuestionTool
argument-hint: [file]
description: Helps to develop a specification through non-obvious questions
model: claude-opus-4-7
---

Read $ARGUMENTS and and interview me in detail using the AskUserQuestionTool about literally anything:
- Technical implementation
- UI & UX
- Concerns
- Tradeoffs, etc.

But make sure the questions are non-obvious

Be very in-depth and continue interviewing me continually until it's complete, then write the spec to the file.