# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a JavaScript parser for the Daedalus scripting language used in Gothic 2 modding. 

## Development Methodology

### Test-Driven Development (TDD)
All new feature development and bug fixes must follow a Test-Driven Development approach to ensure parser robustness and quality:

1. **Write a Failing Test**: Create a test case in that describes the desired feature or bug fix. The test should fail initially.

2. **Modify the Code**: Make minimal changes to make the test pass

3. **Run Tests**: Execute `npm test` to compile grammar and run tests

4. **Refactor**: Improve code structure while ensuring all tests pass

5. **Repeat**: Continue this cycle for all new functionality

This ensures every feature is tested and the test suite reflects the current parser state.

### Progress Documentation
Maintain a `PROGRESS.md` file to document implementation progress, decisions, and challenges. This should include:
- Implementation milestones and completed features
- Technical decisions and rationale
- Known issues and limitations
- Performance benchmarks and optimizations

### References

*   [Daedalus EBNF Documentation](https://wiki.worldofgothic.de/doku.php?id=daedalus:ebnf)
*   [Example File 1 (DIA_DEV_2130_Szmyk.d)](https://github.com/Szmyk/gmbt-example-mod/blob/master/G2NoTR/mod/Scripts/Content/Story/Dialoge/DIA_DEV_2130_Szmyk.d)
*   [Example File 2 (DEV_2130_Szmyk.d)](https://github.com/Szmyk/gmbt-example-mod/blob/master/G2NoTR/mod/Scripts/Content/Story/NPC/DEV_2130_Szmyk.d)
