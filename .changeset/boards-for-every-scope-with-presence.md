---
"@openokr/web": minor
---

The board shows who else has it open, there is a board for each initiative
and each key result, and a card can be moved anywhere with the keyboard.

Each board now shows the faces of the other people looking at it, with their
names read out to a screen reader. Only people who can read that board are
shown, and somebody who loses access leaves everybody's board at once. When
live updates are unavailable the board works as before and shows nobody.

An initiative's page and each key result on a goal's page open their own
board. A key result's board holds the tasks that name it and the tasks of
every initiative serving it, the same work its "linked work" count adds up. A
task added on an initiative's board belongs to that initiative. Asking for the
board of a space, initiative or key result you cannot see now answers "not
found" rather than showing an empty board, in the app and in the `tasks.board`
API, which also says what the board is of.

Each card has a move handle. Press Space or Enter to pick the card up, the
arrow keys to carry it up and down its column or across to the next one, then
Space or Enter to put it down, or Escape to put it back. Each step is
announced. The card is saved once, when it is put down, exactly as a drag
saves it.
