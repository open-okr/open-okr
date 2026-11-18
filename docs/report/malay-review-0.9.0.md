# Malay wording review, 0.9.0 (plan §7, F-08)

## Who and when

| Item | Value |
|---|---|
| Reviewer | Claude (an AI). **Not a native Malay speaker.** |
| Date | 18 November 2026 |
| File | `packages/ui/src/i18n/messages/ms.json` |
| Scope | Keys added or changed since tag v0.8.0: 291 (286 new, 5 changed). Each was compared with `en.json`. |
| Aim | Remove clear errors so a native speaker's pass is short. This is not a sign-off. |

Checks run on every key: Indonesian words where Malay differs, meaning against the English, placeholders (`{name}`, `{count}`) and plural pairs, untranslated English, consistency with the rest of the file, straight quotes, no em dashes. No placeholder mismatches were found. No Indonesian-only words from the usual list (berhasil, sandi, pengaturan, unduh, unggah, tautan, bisa, fitur and the like) were found in scope.

## Glossary used (the file's majority choice)

| English | Malay in ms.json | Uses |
|---|---|---|
| workspace | ruang kerja | 271 |
| objective / goal | objektif / matlamat | 112 / 82 |
| key result | keputusan utama | 111 (hasil utama: 4) |
| check-in | kemas kini (also "daftar masuk" in older keys) | 90 / 28 |
| task | tugasan | 65 |
| initiative | inisiatif | 68 |
| member | ahli | 69 |
| administrator | pentadbir | 78 |
| provider | penyedia (pembekal: 10) | 85 |
| agent | ejen | 61 |
| escalation | eskalasi (peningkatan: 3) | 13 |
| gate | get | 18 |
| sign in | log masuk | 88 |
| status | status / keadaan | 14 / 13 |
| on / off | hidup / mati | |
| viewer | pemerhati | |
| password | kata laluan | 46 |
| copilot | Copilot (kept in English) | 23 |

## Changes made (13)

| Key | Before | After | Reason |
|---|---|---|---|
| `admin.practice.groupDescription.checks` | ...menolak: seperti kata kaedah, menyekat, ... | ...menolak, mengikut kaedah: menyekat, ... | "seperti kata kaedah" reads oddly. English: "as the method says". |
| `admin.practice.groupDescription.rhythm` | ...diambil oleh peningkatan semakan dan keyakinan. | ...diambil oleh eskalasi kemas kini dan keyakinan. | "peningkatan" means increase. Glossary: eskalasi, and check-in is kemas kini. |
| `admin.practice.groupDescription.model` | ...dan hasil utama yang digunakan... | ...dan keputusan utama yang digunakan... | Glossary: keputusan utama (111 uses). |
| `admin.rhythm.groupDescription.cadence` | ...tangga peningkatan... | ...tangga eskalasi... | Same as above. |
| `account.security.password.hint` | Menukarnya mengekalkan token API dan aplikasi bersambung berfungsi. | Menukarnya tidak menjejaskan token API dan aplikasi yang bersambung. | Ungrammatical. Same meaning as the English. |
| `copilot.copilotPanel.history.confirmDelete` | Padam “{title}”? Ia tidak boleh dikembalikan. | Padam "{title}"? Ia tidak boleh dipulihkan. | Curly quotes to straight. "dipulihkan" is the verb the file uses for restore. |
| `copilot.copilotPanel.suggestion.feedback` | ...tentang proses onboarding? | ...tentang onboarding? | "proses" was not in the English. |
| `copilot.copilotPanel.step.summaryNone` | Mencari dalam ruang kerja anda, ... | Telah mencari dalam ruang kerja anda, ... | English is past tense ("Searched"). The old text was the same as the in-progress step. |
| `copilot.copilotPanel.step.summaryOne` | Mencari ... {count} petikan ditemui | Telah mencari ... {count} petikan ditemui | Same. |
| `copilot.copilotPanel.step.summaryOther` | Mencari ... {count} petikan ditemui | Telah mencari ... {count} petikan ditemui | Same. |
| `copilot.copilotPanel.step.summarySearched` | Mencari dalam ruang kerja anda | Telah mencari dalam ruang kerja anda | Same. |
| `copilot.copilotPanel.step.summaryReadOne` | Mencari ... {count} bacaan dibuat | Telah mencari ... {count} bacaan dibuat | Same. |
| `copilot.copilotPanel.step.summaryReadOther` | Mencari ... {count} bacaan dibuat | Telah mencari ... {count} bacaan dibuat | Same. |

`SAME_IN_MALAY` in `packages/ui/test/catalogue.test.tsx` needed no change.

## Doubtful items left for the native speaker

| Key | Current | Question |
|---|---|---|
| `term.keyResult.*` (and all uses) | Keputusan utama | "keputusan" means decision. Is "hasil utama" the better Malay for key result? Four older keys already use "hasil utama". Out of scope, but it affects the whole file. |
| `admin.ai.provider`, `admin.ai.providers` and 85 uses | Penyedia | Is "penyedia" natural in Malay, or "pembekal"? Ten keys already use "pembekal". |
| `operator.workspaces.adoptNow`, `adoptedOne`, `adoptedOther`, `adoptedNone`, `waitingOne`, `waitingOther` | Terima sekarang / diterima / penerimaan | "Adopt" means giving an existing workspace a tenant record. Does "terima" (accept) carry that? |
| `copilot.copilotPanel.step.proposing` | Menyemak sama ada ini perubahan yang boleh saya buat | Is "buat" the right register for "make" here? |
| `copilot.copilotPanel.preview.remark` | Catatan | Right word for "Remark"? |
| `copilot.copilotPanel.history.title`, `admin.agents.groupHistory` | Sejarah | "Sejarah" is history as a subject. Is "Riwayat" or "Log" closer to an activity history? |
| `copilot.copilotPanel.step.reading.goalsRead` and the other "Membaca satu ..." steps | Membaca satu objektif | "satu" for "a": natural, or drop it? |
| `admin.rhythm.groupDescription.sessions` | denyut bilik | Is "room pulse" understood? (Check older keys for the same term.) |
| `copilot.reason.aiOff.creditsUsed.*` | ...sehingga hari pertama bulan depan | The English says "the 1st". Is "hari pertama bulan depan" clear? |
| `admin.ai.agentCalls.outcome.*` | dibaca, ditolak, ... | These fill a sentence after `{time} {member},`. Read the finished line in the UI. |
| `account.security.securitySettings.statusOn`, `statusOff` | Hidup / Mati | Consistent with the file, but "Aktif / Tidak aktif" may suit a security setting better. |
| Older keys (out of scope) | `okrDrawer.checkIns` "Daftar masuk", `admin.webhooks.event.key_result.checked_in` "didaftar masuk" | "daftar masuk" looks Indonesian for check-in and disagrees with `term.checkIn` "Kemas kini". |
| Older keys (out of scope) | `admin.rhythm.rhythmForm.groupCadence` "Irama dan peningkatan" | Escalation is "eskalasi" elsewhere. |

## Read first (copilot strings)

1. `copilot.reason.aiOff.*` and `copilot.reason.*`: the messages a member sees when AI is off, capped or failing. Long, with several clauses.
2. `copilot.copilotPanel.step.*`: the live step lines and their summaries. Read them as they appear in the panel.
3. `copilot.copilotPanel.rating.*`: the rating form and the privacy sentence in `shareHint`.
4. `copilot.copilotPanel.history.*`, `actions.*`, `open.*`, `askAbout.*`, `about.*`.
5. `admin.ai.agentCalls.*` and `admin.ai.ratings.*`: the administrator side of the same feature.
