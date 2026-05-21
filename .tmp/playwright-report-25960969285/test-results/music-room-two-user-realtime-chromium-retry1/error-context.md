# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: music-room.spec.ts >> two-user-realtime
- Location: e2e/music-room.spec.ts:93:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('room-code-button')
Expected substring: "XNYPIO"
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 10000ms
  - waiting for getByTestId('room-code-button')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - main [ref=e12]:
    - tabpanel [ref=e13]:
      - generic [ref=e15]:
        - generic [ref=e18]:
          - generic [ref=e19]:
            - generic [ref=e20]:
              - button "XNYPIO" [ref=e21] [cursor=pointer]:
                - generic [ref=e22]:
                  - generic [ref=e24]: XNYPIO
                  - img [ref=e25]
              - generic [ref=e28]:
                - generic [ref=e29]:
                  - img [ref=e30]
                  - generic [ref=e35]: "0"
                  - text: 人在线
                - generic [ref=e36]: ·
                - generic [ref=e37]: 公开房间
                - generic [ref=e38]: ·
                - generic [ref=e39]: 房主 host-realtime-mp8a1gs2-yxm63n
                - generic [ref=e40]: ·
                - generic [ref=e41]: 未选择歌曲
            - button [ref=e43] [cursor=pointer]:
              - img [ref=e44]
          - paragraph [ref=e51]: 从曲库添加音乐，或导入本地音频，马上开始这场协作收听。
        - generic [ref=e52]:
          - generic [ref=e53]:
            - generic [ref=e54]:
              - generic [ref=e55]:
                - generic [ref=e56]: Audio
                - strong [ref=e57]: 未参与缓存播放
              - generic [ref=e58]:
                - generic [ref=e59]: Peers
                - strong [ref=e60]: Data 0 / Media 0
              - generic [ref=e61]:
                - generic [ref=e62]: ICE
                - strong [ref=e63]: stun-only
            - generic [ref=e64]:
              - button "队列" [ref=e65] [cursor=pointer]
              - button "曲库" [ref=e66] [cursor=pointer]
              - button "缓存" [ref=e67] [cursor=pointer]
              - button "成员" [ref=e68] [cursor=pointer]
          - generic [ref=e73]:
            - img [ref=e75]
            - paragraph [ref=e79]: 队列还是空的，先加入几首歌把房间转起来。
    - generic [ref=e83]:
      - generic [ref=e95]:
        - paragraph [ref=e96]: 已暂停
        - generic [ref=e97]:
          - heading "等待选择歌曲" [level=3] [ref=e98]
          - paragraph [ref=e99]: 从曲库或共享队列中选择一首歌
      - generic [ref=e100]:
        - button "上一首" [disabled]:
          - img
        - button "播放" [ref=e101] [cursor=pointer]:
          - img [ref=e102]
        - button "下一首" [disabled]:
          - img
      - generic [ref=e104]:
        - generic [ref=e105]:
          - generic [ref=e106]: 0:00
          - slider [disabled] [ref=e111]: "0"
          - generic [ref=e112]: 0:00
        - generic [ref=e113]:
          - img [ref=e115]
          - slider [ref=e121] [cursor=pointer]: "0.72"
```

# Test source

```ts
  4   |   return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  5   | }
  6   | 
  7   | async function register(page: Page, nicknamePrefix: string) {
  8   |   const id = uniqueId(nicknamePrefix);
  9   |   await page.goto("/auth?redirectTo=/app");
  10  |   await page.getByTestId("auth-mode-toggle").click();
  11  |   await page.getByTestId("auth-register-username").fill(id);
  12  |   await page.getByTestId("auth-register-password").fill("password-123");
  13  |   await page.getByTestId("auth-register-nickname").fill(id);
  14  |   await page.getByTestId("auth-register-submit").click();
  15  |   await expect(page.getByTestId("create-public-room")).toBeVisible();
  16  |   return id;
  17  | }
  18  | 
  19  | async function createRoom(page: Page) {
  20  |   await page.getByTestId("create-public-room").click();
  21  |   await expect(page).toHaveURL(/\/room\/room_/);
  22  |   const codeButton = page.getByTestId("room-code-button");
  23  |   await expect(codeButton).toContainText(/[A-Z0-9]{6}/);
  24  |   const code = (await codeButton.innerText()).match(/[A-Z0-9]{6}/)?.[0];
  25  |   if (!code) {
  26  |     throw new Error("Room join code was not rendered.");
  27  |   }
  28  |   return code;
  29  | }
  30  | 
  31  | async function joinRoom(page: Page, joinCode: string) {
  32  |   await page.getByTestId("join-code-input").fill(joinCode);
  33  |   await page.getByTestId("join-code-submit").click();
  34  |   await expect(page).toHaveURL(/\/room\/room_/);
  35  |   await expect(page.getByTestId("room-code-button")).toContainText(joinCode);
  36  | }
  37  | 
  38  | async function registerAndJoin(context: BrowserContext, joinCode: string, nicknamePrefix: string) {
  39  |   const page = await context.newPage();
  40  |   await register(page, nicknamePrefix);
  41  |   await joinRoom(page, joinCode);
  42  |   return page;
  43  | }
  44  | 
  45  | function wavFile(name: string, frequencyHz: number) {
  46  |   const sampleRate = 44_100;
  47  |   const durationSeconds = 0.5;
  48  |   const sampleCount = Math.floor(sampleRate * durationSeconds);
  49  |   const dataSize = sampleCount * 2;
  50  |   const buffer = Buffer.alloc(44 + dataSize);
  51  | 
  52  |   buffer.write("RIFF", 0);
  53  |   buffer.writeUInt32LE(36 + dataSize, 4);
  54  |   buffer.write("WAVE", 8);
  55  |   buffer.write("fmt ", 12);
  56  |   buffer.writeUInt32LE(16, 16);
  57  |   buffer.writeUInt16LE(1, 20);
  58  |   buffer.writeUInt16LE(1, 22);
  59  |   buffer.writeUInt32LE(sampleRate, 24);
  60  |   buffer.writeUInt32LE(sampleRate * 2, 28);
  61  |   buffer.writeUInt16LE(2, 32);
  62  |   buffer.writeUInt16LE(16, 34);
  63  |   buffer.write("data", 36);
  64  |   buffer.writeUInt32LE(dataSize, 40);
  65  | 
  66  |   for (let index = 0; index < sampleCount; index += 1) {
  67  |     const amplitude = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate) * 0.25;
  68  |     buffer.writeInt16LE(Math.round(amplitude * 32767), 44 + index * 2);
  69  |   }
  70  | 
  71  |   return {
  72  |     name,
  73  |     mimeType: "audio/wav",
  74  |     buffer
  75  |   };
  76  | }
  77  | 
  78  | async function uploadTwoTracks(page: Page) {
  79  |   await page.getByTestId("room-tab-library").click();
  80  |   await page.getByTestId("track-upload-input").setInputFiles([
  81  |     wavFile("e2e-tone-a.wav", 440),
  82  |     wavFile("e2e-tone-b.wav", 660)
  83  |   ]);
  84  |   await expect(page.getByTestId("track-card")).toHaveCount(2, { timeout: 20_000 });
  85  | }
  86  | 
  87  | test("auth-room-smoke", async ({ page }) => {
  88  |   await register(page, "host-smoke");
  89  |   await createRoom(page);
  90  |   await expect(page.getByTestId("online-member-count")).toHaveText("1");
  91  | });
  92  | 
  93  | test("two-user-realtime", async ({ browser, page }) => {
  94  |   await register(page, "host-realtime");
  95  |   const joinCode = await createRoom(page);
  96  | 
  97  |   const listenerContext = await browser.newContext();
  98  |   const listenerPage = await registerAndJoin(listenerContext, joinCode, "listener-realtime");
  99  | 
  100 |   await expect(page.getByTestId("online-member-count")).toHaveText("2", { timeout: 15_000 });
  101 |   await expect(listenerPage.getByTestId("online-member-count")).toHaveText("2", { timeout: 15_000 });
  102 | 
  103 |   await listenerPage.reload();
> 104 |   await expect(listenerPage.getByTestId("room-code-button")).toContainText(joinCode);
      |                                                              ^ Error: expect(locator).toContainText(expected) failed
  105 |   await expect(listenerPage.getByTestId("online-member-count")).toHaveText("2", { timeout: 15_000 });
  106 |   await listenerContext.close();
  107 | });
  108 | 
  109 | test("upload-queue-playback", async ({ browser, page }) => {
  110 |   await register(page, "host-playback");
  111 |   const joinCode = await createRoom(page);
  112 |   const listenerContext = await browser.newContext();
  113 |   const listenerPage = await registerAndJoin(listenerContext, joinCode, "listener-playback");
  114 | 
  115 |   await uploadTwoTracks(page);
  116 |   const addButtons = page.getByTestId("track-add-queue-button");
  117 |   await addButtons.nth(0).click();
  118 |   await addButtons.nth(1).click();
  119 |   await page.getByTestId("room-tab-queue").click();
  120 |   await expect(page.getByTestId("queue-item")).toHaveCount(2);
  121 | 
  122 |   await page.getByTestId("queue-item-play-button").first().click();
  123 |   await expect(page.getByText("正在播放").first()).toBeVisible({ timeout: 10_000 });
  124 |   await expect(listenerPage.getByText("正在播放").first()).toBeVisible({ timeout: 15_000 });
  125 | 
  126 |   await page.getByTestId("player-toggle-button").last().click();
  127 |   await expect(page.getByTestId("player-toggle-button").last()).toHaveAttribute("title", "播放", {
  128 |     timeout: 10_000
  129 |   });
  130 | 
  131 |   const seekSlider = page.getByTestId("player-seek-slider").last();
  132 |   await seekSlider.evaluate((input) => {
  133 |     const slider = input as HTMLInputElement;
  134 |     slider.value = "120";
  135 |     slider.dispatchEvent(new Event("input", { bubbles: true }));
  136 |     slider.dispatchEvent(new Event("change", { bubbles: true }));
  137 |     slider.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  138 |   });
  139 | 
  140 |   await page.getByTestId("player-next-button").last().click();
  141 |   await listenerContext.close();
  142 | });
  143 | 
  144 | test("delete-room", async ({ browser, page }) => {
  145 |   await register(page, "host-delete");
  146 |   const joinCode = await createRoom(page);
  147 |   const listenerContext = await browser.newContext();
  148 |   const listenerPage = await registerAndJoin(listenerContext, joinCode, "listener-delete");
  149 | 
  150 |   await page.getByTestId("room-settings-button").click();
  151 |   await page.getByTestId("delete-room-button").click();
  152 | 
  153 |   await expect(page).toHaveURL(/\/app/);
  154 |   await expect(listenerPage).toHaveURL(/\/app/, { timeout: 15_000 });
  155 |   await expect(listenerPage.getByTestId("create-public-room")).toBeVisible();
  156 |   await listenerContext.close();
  157 | });
  158 | 
  159 | test("metrics-smoke", async ({ request }) => {
  160 |   const response = await request.get("http://127.0.0.1:3001/metrics");
  161 |   expect(response.ok()).toBeTruthy();
  162 |   const body = await response.text();
  163 |   expect(body).toContain("music_room_ws_connections");
  164 |   expect(body).toContain("music_room_active_rooms");
  165 |   expect(body).toContain("music_room_realtime_failures_total");
  166 |   expect(body).toContain("music_room_playback_conflicts_total");
  167 | });
  168 | 
```