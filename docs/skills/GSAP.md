# GSAP Animation Skills

Three built-in Claude Code skills are available for animations. Invoke via the `Skill` tool.

| Skill | Use when |
|-------|----------|
| **gsap-core** | `gsap.to()`, `from()`, `fromTo()`, timeline, easing, stagger |
| **gsap-scrolltrigger** | Scroll-linked animations, pinning, scrub, parallax |
| **gsap-performance** | Reducing jank, `will-change`, avoiding layout thrashing |

**Framework:** GSAP is framework-agnostic – works in React, Vue, Svelte, vanilla JS.

**MUI caveat:** Avoid `overflow: hidden` on wrapper boxes – causes a second scrollbar with ScrollTrigger. Use `overflowY: auto` instead. See memory: `feedback_gsap_scrolltrigger_layout.md`.
