---
"@openokr/web": minor
---

An objective is now committed or aspirational (METHOD.md §2.8). A new one
starts aspirational, or committed where the workspace uses committed OKRs
only, and every existing objective reads as aspirational. The kind shows as a
chip in the OKR list, the drawer and the diagram, where a writer can change it
and is asked why; the change and its reason are kept in the objective's
activity. "+ New objective" and the cycle screen's drafting form offer the
kind, the list can be filtered by it, and `goals.setKind` is the new API
action. A workspace that uses one kind sees none of this.
