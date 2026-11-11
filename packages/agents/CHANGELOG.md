# @openokr/agents

## 0.8.1

### Patch Changes

- [#212](https://github.com/open-okr/open-okr/pull/212) [`63503f4`](https://github.com/open-okr/open-okr/commit/63503f410785091bd6a340d676a46aa74df8e545) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The copilot's answer now appears as it is written. On every deployment that runs background work, which is the usual setup, the answer was produced in the background and arrived in one piece at the end, so the panel stayed empty for several seconds. The words now come through as the model writes them. A streamed answer also records its token count and cost when the provider reports them, as a whole answer always did. If the provider stops partway, the words that arrived are kept and the panel says the answer stopped early.

- [#212](https://github.com/open-okr/open-okr/pull/212) [`c21a44a`](https://github.com/open-okr/open-okr/commit/c21a44af073efb4059bb316947db85742b5b40b1) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The copilot reads its answers more carefully on GPT-6 Luna, the default model on OpenRouter. It no longer reads somebody else's check-in or objective back to you as yours: when the passages do not show which is yours, it says so. When it has prepared a change card, its answer says so first instead of saying the information is missing. It no longer proposes work behind a different key result from the one you named. Answers may use bold, lists and inline code, and never headings, tables or links.

- [#212](https://github.com/open-okr/open-okr/pull/212) [`d73d263`](https://github.com/open-okr/open-okr/commit/d73d26331471fcfa42cca2617a91c70ddd28e7b0) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - When the copilot drops a proposal it could not use, the server log now says why. One line per drop names the reason (`not_offered`, `no_reason`, `fields_refused`, `build_refused` or `provider_error`), the action the model named, the provider and the model, and never the person's request, the fields or the model's reply. A request the model reads as a question writes nothing. `pnpm ai:evaluate` prints the same reason beside a fixture that expected a proposal and got none.

- [#212](https://github.com/open-okr/open-okr/pull/212) [`419cd46`](https://github.com/open-okr/open-okr/commit/419cd4685a9f0f0eed92fc9eec9bc30c05ab559d) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The copilot's answer now knows whether it made a change card. It used to write the answer while the card was still being prepared, so it could say "I cannot create objectives" right above a working card. The card is now prepared first and shown as soon as it exists, and the answer is told what it proposes, so it refers to the card instead of denying it. When no card was made for a request to change something, such as a check-in, the answer says plainly that the copilot cannot make that change yet and where you make it yourself. The first words of an answer arrive one to three seconds later than before, the time it takes to prepare the card. A run delivered twice no longer makes a second card.

- [#210](https://github.com/open-okr/open-okr/pull/210) [`05f9b36`](https://github.com/open-okr/open-okr/commit/05f9b36064811d4e5121dd1780e33efbbbc8ef08) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The copilot proposes changes again on OpenRouter and OpenAI. Asked to create an objective, a key result, an initiative or a task, it proposed nothing, and said nothing about why. Those providers fill a structured reply strictly, and the reply's fields were an object with nothing declared in it, so they came back empty and every proposal was dropped. The reply now names every field the offered actions take, and a proposal missing one the action needs is refused where it is read. `pnpm ai:evaluate --provider openrouter` runs the live smoke test against OpenRouter.

- [#210](https://github.com/open-okr/open-okr/pull/210) [`b30346d`](https://github.com/open-okr/open-okr/commit/b30346db74bdc5cd87d6d920224f915ce466023e) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - On OpenRouter, the fast and balanced AI tiers now default to GPT-6 Luna, and the deep tier stays on Claude Sonnet 4.5. Luna costs about a thirtieth of Sonnet 4.5 and, run live, passed every capability's evaluation set and filled every copilot proposal. This changes only a workspace or deployment that never chose a model: a model picked on the AI page, or in `ai.deployment.tierModels`, is kept. The recovery-title assist also gets more room to reply, because a reasoning model spends part of that budget thinking and ran out of it.
- Updated dependencies [[`7ddce9e`](https://github.com/open-okr/open-okr/commit/7ddce9e0b383bd781f36acf52f7543abf4b80edd), [`bc0333f`](https://github.com/open-okr/open-okr/commit/bc0333f3f1405fcb97e1775b331ced5191c3a484), [`63503f4`](https://github.com/open-okr/open-okr/commit/63503f410785091bd6a340d676a46aa74df8e545), [`3f45fd5`](https://github.com/open-okr/open-okr/commit/3f45fd5bfd167b4e975bb7bb6228b0f31668d8b6), [`98c1521`](https://github.com/open-okr/open-okr/commit/98c1521b97b43d52dab0b1b02ff5b250ccdc1c8b), [`a27b0ef`](https://github.com/open-okr/open-okr/commit/a27b0efe89dd76d213c7f97d1cb8742938e60002), [`d73d263`](https://github.com/open-okr/open-okr/commit/d73d26331471fcfa42cca2617a91c70ddd28e7b0), [`419cd46`](https://github.com/open-okr/open-okr/commit/419cd4685a9f0f0eed92fc9eec9bc30c05ab559d), [`d92761b`](https://github.com/open-okr/open-okr/commit/d92761b08e69372496d2efdedb197d29b40ce94c), [`b61a93a`](https://github.com/open-okr/open-okr/commit/b61a93aa81a899b6fbf506c5ca379e89602b7578), [`4e5d2e4`](https://github.com/open-okr/open-okr/commit/4e5d2e4002cc66f6a890fa5cdb0b96f3721c7578), [`2402aca`](https://github.com/open-okr/open-okr/commit/2402acae10d5434d7af6f4addf9e02ffc254b57d), [`bf4ae58`](https://github.com/open-okr/open-okr/commit/bf4ae5818f1d97dff8f1e42a10192e3d56d75593), [`6150a62`](https://github.com/open-okr/open-okr/commit/6150a626c35b4674e0413affba1441f4004b9bc7), [`b30346d`](https://github.com/open-okr/open-okr/commit/b30346db74bdc5cd87d6d920224f915ce466023e), [`964c39c`](https://github.com/open-okr/open-okr/commit/964c39cf144eb10b44cf0df6bedd52a9d4a958d9), [`ec29e46`](https://github.com/open-okr/open-okr/commit/ec29e468c70a516e2f119b48a5be2382f9f46596)]:
  - @openokr/core@0.8.1
  - @openokr/db@0.8.1
  - @openokr/adapters@0.8.1
  - @openokr/method@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [[`06a4ef3`](https://github.com/open-okr/open-okr/commit/06a4ef30127da7876cb40465d56de7beebf8be65), [`686cd08`](https://github.com/open-okr/open-okr/commit/686cd086ce8e82ed8ed7098a7b5b41cb22b7a71d), [`416eb66`](https://github.com/open-okr/open-okr/commit/416eb66c7ac7b544babd7517c04dd4237fc73484), [`b803f7e`](https://github.com/open-okr/open-okr/commit/b803f7e778fb99652a7a411df1de9a2627198933), [`508a4b6`](https://github.com/open-okr/open-okr/commit/508a4b62de015086f27f92572526cd836540151e), [`1021b7c`](https://github.com/open-okr/open-okr/commit/1021b7cfea9d42fb7f683b135e521612612f726c), [`3e37fd0`](https://github.com/open-okr/open-okr/commit/3e37fd0ed8f008a0a3dc992b64ed18ca38d7e6d1), [`0dd555d`](https://github.com/open-okr/open-okr/commit/0dd555d6663ffbb0048ae06ef55a159b22f0314a), [`cdad1fa`](https://github.com/open-okr/open-okr/commit/cdad1fa90e1f045a5907520c99f47de49f2748c9), [`fcd1c4e`](https://github.com/open-okr/open-okr/commit/fcd1c4ed08bebb64f3bd069d9196e3cd0fef34c0), [`cc5ba20`](https://github.com/open-okr/open-okr/commit/cc5ba206271a1aaea3dba26c621cb8678a2d2fb6)]:
  - @openokr/core@0.8.0
  - @openokr/db@0.8.0
  - @openokr/adapters@0.8.0
  - @openokr/method@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`25447b7`](https://github.com/open-okr/open-okr/commit/25447b75e076586eda4b0320689fc747b660fb2e), [`169a41b`](https://github.com/open-okr/open-okr/commit/169a41bb20b83f1c38d31161717903ebe2f34c37)]:
  - @openokr/adapters@0.7.0
  - @openokr/core@0.7.0
  - @openokr/db@0.7.0
  - @openokr/method@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @openokr/adapters@0.6.0
  - @openokr/core@0.6.0
  - @openokr/db@0.6.0
  - @openokr/method@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`6f01dbb`](https://github.com/open-okr/open-okr/commit/6f01dbb3e9c7029505643777d3d6aadfef6d8cd4), [`8f202fc`](https://github.com/open-okr/open-okr/commit/8f202fcdb168a9d05ac4b46812218c1f7e22350e), [`02e97c4`](https://github.com/open-okr/open-okr/commit/02e97c486934e38c5abd09108d9385aeed732f3e), [`8c20438`](https://github.com/open-okr/open-okr/commit/8c204380b6c21e1984a2a3de321bca7e238b74fd), [`28b8ee0`](https://github.com/open-okr/open-okr/commit/28b8ee02b6c0f6c63ae5a1927115dbc33f932a21), [`e73b7aa`](https://github.com/open-okr/open-okr/commit/e73b7aa0a1d54c84a2619f7337d18121bea3f685), [`0c03fdf`](https://github.com/open-okr/open-okr/commit/0c03fdfd59290e68f1f67349297858ce2ef08357), [`3dbba8c`](https://github.com/open-okr/open-okr/commit/3dbba8cabe4736ebe041dec8eb365a4f5ee0bfc9), [`570a0a2`](https://github.com/open-okr/open-okr/commit/570a0a2f6023efa1b5a613e63b68dbb42b1834b1), [`c426fe2`](https://github.com/open-okr/open-okr/commit/c426fe2115bfdd5ce7eab2edd526fa1b89d0585f), [`f016dd5`](https://github.com/open-okr/open-okr/commit/f016dd5caf2ec0a842d2365fad2a72dc73918660), [`91af1bf`](https://github.com/open-okr/open-okr/commit/91af1bfb6bcc8c82045a752e8e35dcd9cb5f8ab2), [`80354db`](https://github.com/open-okr/open-okr/commit/80354dbe05088a837c1bcef61fff31ac9d067f80), [`8c0fd5b`](https://github.com/open-okr/open-okr/commit/8c0fd5b19d111ce1facb70aa2674aa80b1366be8), [`df256ec`](https://github.com/open-okr/open-okr/commit/df256ec8665a698323d33d5af363e4131ce26905)]:
  - @openokr/core@0.5.0
  - @openokr/adapters@0.5.0
  - @openokr/method@0.5.0
  - @openokr/db@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`af6432b`](https://github.com/open-okr/open-okr/commit/af6432b60ff60d740859c9b23485d7ceb74dac0b), [`e717b8f`](https://github.com/open-okr/open-okr/commit/e717b8fb88600e9fb2930590e18be2ecb736eddc), [`99c5680`](https://github.com/open-okr/open-okr/commit/99c5680eb374659d932622dec2ff612e89fb7252), [`d0b5daa`](https://github.com/open-okr/open-okr/commit/d0b5daa2adf54c081c8944912b2cea5c832b6085), [`4406071`](https://github.com/open-okr/open-okr/commit/4406071352efa5819efa01d993f4f337dea6d5ac), [`76abcf5`](https://github.com/open-okr/open-okr/commit/76abcf55b67cf00df66bad50a28522c7b8f1e23b), [`6c5c2cc`](https://github.com/open-okr/open-okr/commit/6c5c2ccb9e57a82026f76b60b585a9d04c6dfc56), [`8625cc1`](https://github.com/open-okr/open-okr/commit/8625cc17565e17db2efb1e57d3b1e18e16760918), [`91034ec`](https://github.com/open-okr/open-okr/commit/91034ec53fea813ab7e7fe30e71e1aad0a4df40b), [`e3b31ca`](https://github.com/open-okr/open-okr/commit/e3b31ca014446750771547c0d5c60353244b5a23), [`a9d8948`](https://github.com/open-okr/open-okr/commit/a9d89484f370c2f545c5c9ff4d7ffa0e7e05e911), [`29ccd09`](https://github.com/open-okr/open-okr/commit/29ccd0956400b4068edcab0670d6f05ba6b81f79), [`214cbb3`](https://github.com/open-okr/open-okr/commit/214cbb381530b9d192970688b6555ba7d2a03b91), [`2afccd5`](https://github.com/open-okr/open-okr/commit/2afccd5d008c95a5f9fda4ad25614a2d2a67484d), [`fff412a`](https://github.com/open-okr/open-okr/commit/fff412a2103173b36f767e209627f479d029a320), [`add1f84`](https://github.com/open-okr/open-okr/commit/add1f84cae390fb8732e1efc9b64da29aff9efc6), [`33bcc4e`](https://github.com/open-okr/open-okr/commit/33bcc4e5c581330b801852876d2678cdc9d114b9), [`0467a32`](https://github.com/open-okr/open-okr/commit/0467a32baf6f63ab1814cf4b48d820863d99386e), [`51574a1`](https://github.com/open-okr/open-okr/commit/51574a10989ad73d4d03d5bbf253675842092db3), [`7db1b13`](https://github.com/open-okr/open-okr/commit/7db1b13070ad24c90b0e3aeb444af73af2933046), [`7360842`](https://github.com/open-okr/open-okr/commit/7360842e146885d20e5e26fa9f98f2825efecbb9), [`73845cc`](https://github.com/open-okr/open-okr/commit/73845ccf4f0d53312158d1aa30b3643205e935c2), [`de0dfb1`](https://github.com/open-okr/open-okr/commit/de0dfb1707c8e118cc94e4106731c9118819d452), [`35acd7e`](https://github.com/open-okr/open-okr/commit/35acd7e1959a9d758075c67828b42e13627cba6d), [`b7e71aa`](https://github.com/open-okr/open-okr/commit/b7e71aa1f72beba2cc2bbdf2b376eb691c3970d3), [`2182e30`](https://github.com/open-okr/open-okr/commit/2182e303e5bd2190734c43560f9c9e0c44c8c3a4), [`37ba2a5`](https://github.com/open-okr/open-okr/commit/37ba2a56fc26177edccad4e8e1aba259534b9492), [`6111207`](https://github.com/open-okr/open-okr/commit/611120788bb00e3fa1916b61acc93e236d7eb76f), [`81676aa`](https://github.com/open-okr/open-okr/commit/81676aaf950d5b45db102005539015c04af9ec4a), [`e95244a`](https://github.com/open-okr/open-okr/commit/e95244a9dd0ec9e312513abd73067c06dbce119d), [`cffc1a1`](https://github.com/open-okr/open-okr/commit/cffc1a1275914e0ac8565ca98688aff9993911d9), [`60050f8`](https://github.com/open-okr/open-okr/commit/60050f811f2fd4ecf3a1c462c6374c670fc734d0), [`9b5bcda`](https://github.com/open-okr/open-okr/commit/9b5bcda887c0400cc98d831c59d6fab929214ac9), [`05c0ff4`](https://github.com/open-okr/open-okr/commit/05c0ff4d68ca5cc2d92fad07535c8a634495e8c7), [`4ca1493`](https://github.com/open-okr/open-okr/commit/4ca149365c299bed77d4357b261138d766d5fa7f), [`0c45023`](https://github.com/open-okr/open-okr/commit/0c45023e010fdeaac1564d8ffbe7418825aac5ef)]:
  - @openokr/core@0.4.0
  - @openokr/method@0.4.0
  - @openokr/db@0.4.0
  - @openokr/adapters@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @openokr/adapters@0.3.1
  - @openokr/core@0.3.1
  - @openokr/db@0.3.1
  - @openokr/method@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [[`13d99be`](https://github.com/open-okr/open-okr/commit/13d99be2b275b8b46f320551e41b3515d252c6d1), [`ad8a192`](https://github.com/open-okr/open-okr/commit/ad8a1929697ff892f88d2b85568f152064e5a3cc), [`ddbdb29`](https://github.com/open-okr/open-okr/commit/ddbdb294dc95416d9e1f9c15ef7dd1569e84cc45), [`89a8ef7`](https://github.com/open-okr/open-okr/commit/89a8ef7d66ed717b2fb72d9edde62f8423897e47), [`ad52c4d`](https://github.com/open-okr/open-okr/commit/ad52c4d98758caf45cea2e3540d850433c858f3f), [`7eaa3a9`](https://github.com/open-okr/open-okr/commit/7eaa3a95e1652c13c4008b4aebac79f190f870e2), [`6b1d4a8`](https://github.com/open-okr/open-okr/commit/6b1d4a8673551d518dff5c3f4908a8b2fcabed79), [`1a89c72`](https://github.com/open-okr/open-okr/commit/1a89c72bedafc2793d70cd11b24e1853f213706b), [`4c56446`](https://github.com/open-okr/open-okr/commit/4c56446682dd38d2001f8472c275c1cbc39965ca), [`ad1f083`](https://github.com/open-okr/open-okr/commit/ad1f083d07829f761422dafbae254ddce81c55e2), [`3e6780e`](https://github.com/open-okr/open-okr/commit/3e6780e6538e32ea9c37e439f75a369623eb249f), [`8286bd1`](https://github.com/open-okr/open-okr/commit/8286bd1afe19f4d39ef6f31bf891b5c5d722f1d7), [`f016bdb`](https://github.com/open-okr/open-okr/commit/f016bdb9bb7a078b80f9d43c57354ea363bed5ea), [`c4505e0`](https://github.com/open-okr/open-okr/commit/c4505e06aa128f848173cf6c431388426683934f), [`553c840`](https://github.com/open-okr/open-okr/commit/553c840c2ab7fcae6bf08b11d9fe1ec7f0ede131), [`21c5a00`](https://github.com/open-okr/open-okr/commit/21c5a004c4f32901beda610a771705d8bd218ff2), [`e43d670`](https://github.com/open-okr/open-okr/commit/e43d6700f63c9cca65fa15f0b9fe0679eff8b228), [`2edd845`](https://github.com/open-okr/open-okr/commit/2edd845d18662a0647efbb0e97696239764d09bb), [`37a1fdc`](https://github.com/open-okr/open-okr/commit/37a1fdc1cbb3369deefc3985cc31e82ec40f5276), [`58dda46`](https://github.com/open-okr/open-okr/commit/58dda46ac532e1c57dc60f87676c8509f03e7b9a), [`f1ef43b`](https://github.com/open-okr/open-okr/commit/f1ef43b8d9d92fec98a794dcd482eb57e90805e3), [`d7d812d`](https://github.com/open-okr/open-okr/commit/d7d812dfac7a928908ee5e1eda969fa80f0ca93f), [`760b0a7`](https://github.com/open-okr/open-okr/commit/760b0a7d5cd65266688d9770afaf87394894bd0b), [`149f16e`](https://github.com/open-okr/open-okr/commit/149f16ea69d791c1e6d4b6abcd84c14f13cc9dc7), [`9229546`](https://github.com/open-okr/open-okr/commit/9229546ea329e52152c9bc18ddc3072ca22b026a), [`e00d918`](https://github.com/open-okr/open-okr/commit/e00d9185b2fda42956f56911e019724816e430a9), [`cb18797`](https://github.com/open-okr/open-okr/commit/cb18797ad48ff0715a051e57821f51e38ea186a3), [`dd0db12`](https://github.com/open-okr/open-okr/commit/dd0db12b8c7f3b6ddca31997d5c5713c231d33cf), [`ba0488e`](https://github.com/open-okr/open-okr/commit/ba0488e4787f05b21570d30f9e30d39bdfa962da), [`4cf905e`](https://github.com/open-okr/open-okr/commit/4cf905e430ce611d630c1d2601aa6228a8339291), [`04bddd1`](https://github.com/open-okr/open-okr/commit/04bddd137037b8427c32c6af5248c6114f7eda9c), [`0020453`](https://github.com/open-okr/open-okr/commit/0020453719e5ac8bf330e4d185f9f7e46322be81), [`376b799`](https://github.com/open-okr/open-okr/commit/376b799a9ff7223868645d8050cc9fc233b60d7c), [`832595b`](https://github.com/open-okr/open-okr/commit/832595bf39d5f4996567a3bb7d1813a4fec34a32), [`f43618d`](https://github.com/open-okr/open-okr/commit/f43618de2c5a5e5d86dd312c9be48b4a4e0e5e46), [`4e214f3`](https://github.com/open-okr/open-okr/commit/4e214f35761330cb722a995c3a9af70db2f95c33), [`f96cfd4`](https://github.com/open-okr/open-okr/commit/f96cfd40c5561aead7f2d256b0321f09005e164f), [`dd08538`](https://github.com/open-okr/open-okr/commit/dd08538ffd39a6313b88bb2a646f9128a520aca1), [`da23cfd`](https://github.com/open-okr/open-okr/commit/da23cfd3f6f65ba2dbc2f0c0690684b12d7e9701), [`32249ab`](https://github.com/open-okr/open-okr/commit/32249ab9c1dedc24cce58dabc8071a5e9100e9d0), [`ca715ae`](https://github.com/open-okr/open-okr/commit/ca715aee40d0595062eb1f87afe8f0d77ba8f11c)]:
  - @openokr/core@0.3.0
  - @openokr/db@0.3.0
  - @openokr/method@0.3.0
  - @openokr/adapters@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`fecd1c1`](https://github.com/open-okr/open-okr/commit/fecd1c18556e938627c4f5094b22a751297aedca), [`bf256ef`](https://github.com/open-okr/open-okr/commit/bf256eff36f8e8b601559bc381c624b2fa2ad9eb), [`fa5b9d2`](https://github.com/open-okr/open-okr/commit/fa5b9d2d03e12d93b22014facd8adb3d5de4d1d7), [`214ffc7`](https://github.com/open-okr/open-okr/commit/214ffc717c27e4b123c2090a7ff0015f838caa36), [`a3bf087`](https://github.com/open-okr/open-okr/commit/a3bf0873f72572a82a51b3caf73977f21b3729d0), [`1aaf715`](https://github.com/open-okr/open-okr/commit/1aaf715b768d646ce6a0c3fce52ad0f763651dab), [`1766c7c`](https://github.com/open-okr/open-okr/commit/1766c7c2eb98858dface92e91495522949dcd27f), [`43b8b6d`](https://github.com/open-okr/open-okr/commit/43b8b6db386387a900195c21f146e5b3547b4944), [`8ff439e`](https://github.com/open-okr/open-okr/commit/8ff439e5cf01c77503d89f387f6218e02d3e758c), [`a0319a9`](https://github.com/open-okr/open-okr/commit/a0319a96071d699ca29ddd304de190f69b867806), [`330dac8`](https://github.com/open-okr/open-okr/commit/330dac8c9f5cbbc51c42d5e2a88ce99db9a2dd03), [`2299409`](https://github.com/open-okr/open-okr/commit/229940932ba8624e2e81a45cd273370084c8f717), [`86ea55e`](https://github.com/open-okr/open-okr/commit/86ea55e61c0df2126f18bdf23a1203accc02c8b7), [`2df3862`](https://github.com/open-okr/open-okr/commit/2df386225b3c25704dffe531e743eca74cdc0d72), [`fe540d2`](https://github.com/open-okr/open-okr/commit/fe540d2beede8d9ea51d61faa2fb5e8865488bca)]:
  - @openokr/core@0.2.0
  - @openokr/db@0.2.0
  - @openokr/method@0.2.0
  - @openokr/adapters@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @openokr/adapters@0.1.2
  - @openokr/core@0.1.2
  - @openokr/db@0.1.2
  - @openokr/method@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @openokr/adapters@0.1.1
  - @openokr/core@0.1.1
  - @openokr/db@0.1.1
  - @openokr/method@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies []:
  - @openokr/adapters@0.1.0
  - @openokr/core@0.1.0
  - @openokr/db@0.1.0
  - @openokr/method@0.1.0
