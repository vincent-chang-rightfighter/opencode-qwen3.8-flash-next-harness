# opencode-qwen3.8-flash-next-harness

[English](README.md) | **繁體中文**

[![tests](https://github.com/vincent-chang-rightfighter/opencode-qwen3.8-flash-next-harness/actions/workflows/tests.yml/badge.svg)](https://github.com/vincent-chang-rightfighter/opencode-qwen3.8-flash-next-harness/actions/workflows/tests.yml)

在 [opencode](https://opencode.ai) 中，為本地或自架 Qwen3.8 Flash Next 模型提供
每次請求自動調整 reasoning effort 與 temperature 的能力。只要 model id 包含
`qwen3.8-flash-next`，且 provider 是已知的本地 id，或其設定的 base URL 是本地
位址，就會套用這個 harness。

外掛會用快速啟發式規則分類每次模型請求，並依 provider profile 設定該後端支援的
reasoning 欄位：

- 工具結果回合 -> low effort
- 程式碼提示、檔案路徑、stack trace -> high effort、較低 temperature
- `ultrathink` / `think harder` -> xhigh
- 簡短問候與瑣碎修改 -> low
- 其他 -> medium
- 可選擇對目標模型停用 `task`/subagent；本地 Qwen3.8 Flash Next 的子代理較弱也較慢
- 可選擇要求模型為需要規劃的工作建立依優先級排序的 todo 清單
- 追蹤修改過的檔案，並提醒模型用 test/lint/build 驗證

它不會更換模型，也不會重啟 server；只會加入每次請求的參數，因此可直接套用在
opencode 已設定好的模型上。

## Harness 分層

完整的本地 harness 分成三層：

- `~/.config/opencode/AGENTS.md` 與專案內的 `AGENTS.md` 定義工作契約：
  檢查、規劃、修改、驗證、回報。
- `opencode.jsonc` 管理 context 與安全：`tool_output`、自動 compaction、
  snapshot，以及破壞性指令的核准規則。
- 此外掛提供模型專屬行為：reasoning effort、todo 規劃、驗證追蹤、
  compaction 狀態，以及 `task` 封鎖。

## 需求

- 支援外掛的 opencode（`@opencode-ai/plugin` >= 1.14.24；本專案以
  opencode 1.19.4 開發）。
- 一個提供 `qwen3.8-flash-next` 的本地或自架 OpenAI-compatible endpoint。
- 不需要 provider id 一定是 `strata`。預設會接受已知的本地 provider id
  （`strata`、`ollama`、`llamacpp`、`vllm`、`lmstudio` 等），以及
  `baseURL` 指向 localhost、私有網路或 Tailscale 的 provider。
- 雲端 provider 預設不會被選中，因為它們不在本地 allowlist；`excludeProviders`
  只是可選的明確排除名單。
- Reasoning routing 取決於 provider profile：Strata 使用
  `chat_template_kwargs`；Ollama、llama.cpp、vLLM 使用頂層
  `reasoning_effort`；未知的本地 provider 預設不送 reasoning 欄位，除非在
  `providerProfiles` 設定。

## 安裝指南

### 1. 取得專案

```bash
git clone https://github.com/vincent-chang-rightfighter/opencode-qwen3.8-flash-next-harness.git
cd opencode-qwen3.8-flash-next-harness
```

下一步要使用這個 checkout 的絕對路徑。Windows 會像
`C:/path/to/opencode-qwen3.8-flash-next-harness/index.js`；Linux/macOS 使用對應的
絕對路徑。

### 2. 加入外掛

把此外掛加入 `~/.config/opencode/opencode.jsonc` 或
`.opencode/opencode.json` 的 `plugin` 陣列：

```json
{
  "plugin": [
    [
      "file:///C:/path/to/opencode-qwen3.8-flash-next-harness/index.js",
      {
        "providers": [],
        "modelIncludes": ["qwen3.8-flash-next"],
        "defaultEffort": "medium",
        "codeEffort": "high",
        "toolEffort": "low",
        "disableSubagents": true,
        "autoTodo": true,
        "autoVerify": true,
        "verificationGate": true,
        "debug": true
      }
    ]
  ]
}
```

opencode 1.19.x 使用單數 `plugin` key；複數 `plugins` 是 V2 設定，1.19.x 會警告
無法表示並忽略。除非使用 V2 build，否則請用 `plugin`。`debug` 只在排查問題時
設為 `true`。

### 3. 設定本地 provider

如果 provider 已經設定好，可以跳過。以下是最小 Strata 範例；請替換 base URL、
key 與 model id：

```json
{
  "provider": {
    "strata": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Local Strata",
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1",
        "apiKey": "replace-with-your-key"
      },
      "models": {
        "qwen3.8-flash-next-iq3_s": {
          "name": "Qwen3.8 Flash Next (IQ3_S)",
          "attachment": false,
          "reasoning": true,
          "tool_call": true,
          "limit": { "context": 131072, "output": 32768 }
        }
      }
    }
  },
  "model": "strata/qwen3.8-flash-next-iq3_s",
  "small_model": "strata/qwen3.8-flash-next-iq3_s"
}
```

provider 也可以是 `ollama`、`llamacpp`、`vllm`、其他已知本地 id，或任何
`baseURL` 是本地的 provider；外掛會依 profile 自動選擇 reasoning 欄位。

### 4. 重新啟動 opencode

離開並重新啟動 opencode；外掛與設定不會 hot reload。

### 5. 驗證

```bash
opencode models
npm run smoke:opencode
```

`opencode models` 應列出設定的模型。`smoke:opencode` 會啟動 headless opencode
server 與 mock provider，需要外掛已在 active config 中；設定
`SMOKE_PROVIDER=ollama`、`llamacpp` 或 `vllm` 可驗證其他 profile。

### 6. 移除

從 `plugin` 陣列移除 tuple，或設 `"enabled": false`，然後重新啟動 opencode。

## 選項

| 選項 | 預設值 | 說明 |
|---|---|---|
| `enabled` | `true` | 關閉外掛但不用移除它。 |
| `providers` | `[]` | 可選的明確 provider-id allowlist。空陣列 = 使用本地 provider 規則。 |
| `localProviders` | `LOCAL_PROVIDERS` | 已知的本地 provider id；偵測到的本地 `baseURL` 會自動加入。 |
| `excludeProviders` | `[]` | 可選的明確排除名單，用來排除不想套用的本地 id。 |
| `providerProfiles` | `{}` | 以 provider id 為 key 的 reasoning adapter 覆寫。 |
| `modelIncludes` | `[]` | 用來比對 model id 的子字串。空陣列 = 全部。 |
| `defaultEffort` | `"medium"` | 一般提示的 effort。 |
| `codeEffort` | `"high"` | 實作／程式碼提示。 |
| `debugEffort` | `"high"` | 除錯、錯誤、stack trace、root cause。 |
| `designEffort` | `"high"` | 架構、設計、review、取捨。 |
| `searchEffort` | `"medium"` | 尋找、定位、說明、摘要。 |
| `mechanicalEffort` | `"low"` | 重新命名、錯字、格式化、lint、單行修改。 |
| `toolEffort` | `"low"` | 成功的工具結果回合。設為 `"none"` 可停用 thinking。 |
| `toolFailureEffort` | `"high"` | 第一次工具失敗。 |
| `toolFailureEscalatedEffort` | `"xhigh"` | 同一任務中兩次以上的工具失敗。 |
| `highEffort` | `"high"` | `highKeywords` 的最低 effort。 |
| `ultraEffort` | `"xhigh"` | `ultrathink` 與類似關鍵字。 |
| `simpleEffort` | `"low"` | 問候與瑣碎問題。 |
| `riskMinimumEffort` | `"high"` | 出現風險關鍵字時的最低 effort。 |
| `riskBumpSteps` | `1` | production/security/destructive 工作的額外 effort 級數。 |
| `multiFileBump` | `1` | 多檔案提示在低於 high 時的提升級數。 |
| `longPromptThreshold` | `4000` | 視為長提示的字元數。 |
| `longPromptBump` | `1` | 長提示在低於 high 時的提升級數。 |
| `defaultTemperature` | `1.0` | 一般提示的 temperature。 |
| `codeTemperature` | `0.6` | 程式碼／除錯提示的 temperature。 |
| `toolTemperature` | `0.6` | 工具結果回合的 temperature。 |
| `highTemperature` | `1.0` | 設計／高關鍵字提示的 temperature。 |
| `ultraTemperature` | `1.0` | ultra 關鍵字的 temperature。 |
| `simpleTemperature` | `1.0` | 簡單／機械式提示的 temperature。 |
| `nonThinkingTemperature` | `0.7` | effort 為 `none` 時的 temperature。 |
| `thinkingTopP` | `0.95` | thinking 請求的 `top_p`。 |
| `thinkingTopK` | `20` | thinking 請求的 `top_k`。 |
| `thinkingMinP` | `0` | thinking 請求的 `min_p`。 |
| `thinkingPresencePenalty` | `0` | thinking 請求的 `presence_penalty`。 |
| `thinkingRepetitionPenalty` | `1` | thinking 請求的 `repetition_penalty`。 |
| `nonThinkingTopP` | `0.8` | effort 為 `none` 時的 `top_p`。 |
| `nonThinkingTopK` | `20` | effort 為 `none` 時的 `top_k`。 |
| `nonThinkingMinP` | `0` | effort 為 `none` 時的 `min_p`。 |
| `nonThinkingPresencePenalty` | `1.5` | effort 為 `none` 時的 `presence_penalty`。 |
| `nonThinkingRepetitionPenalty` | `1` | effort 為 `none` 時的 `repetition_penalty`。 |
| `overrideSampling` | `true` | 套用上述 sampling 值。 |
| `codeAgents` | `["code","coder","engineer","debug"]` | 視為程式碼工作的 agent 名稱。 |
| `planAgents` | `["plan","architect","design"]` | 視為設計工作的 agent 名稱。 |
| `searchAgents` | `["explore","search","recon"]` | 視為搜尋／偵察工作的 agent 名稱。 |
| `ignoreAgents` | `["title","summary","compaction"]` | 永不進行路由的輔助 agent。 |
| `disableSubagents` | `false` | 對所有本地／目標模型封鎖 `task` 工具，並加入停用子代理的 system instruction。 |
| `autoTodo` | `false` | 對多步驟／程式碼／設計／除錯／風險工作加入 `todowrite` 規劃指引與清單提醒。 |
| `autoVerify` | `false` | 追蹤修改檔案與 test/lint 指令、提醒驗證，並在 compaction 後保留狀態。 |
| `verificationGate` | `false` | 檢查通過前阻擋下一次程式碼檔案的 `edit`/`write`/`apply_patch`；純文件修改不受限制。 |
| `verificationCommands` | `[]` | 額外視為驗證指令的子字串。 |
| `respectExplicitEffort` | `true` | 不覆寫 model options 中已存在的 `reasoning_effort` 或 `enable_thinking`。 |
| `overrideTemperature` | `true` | 套用上表中的 temperature。 |
| `debug` | `false` | 將每次決策寫到 stderr 與 `client.app.log`，service 名稱為 `qwen-harness`。 |
| `ultraKeywords` | 見 `lib.js` | 不分大小寫的關鍵字清單。 |
| `highKeywords` | 見 `lib.js` | 不分大小寫的關鍵字清單。 |
| `debugKeywords` | 見 `lib.js` | 不分大小寫的關鍵字清單。 |
| `designKeywords` | 見 `lib.js` | 不分大小寫的關鍵字清單。 |
| `mechanicalKeywords` | 見 `lib.js` | 不分大小寫的關鍵字清單。 |
| `searchKeywords` | 見 `lib.js` | 不分大小寫的關鍵字清單。 |
| `implementKeywords` | 見 `lib.js` | 不分大小寫的關鍵字清單。 |
| `riskKeywords` | 見 `lib.js` | 不分大小寫的關鍵字清單。 |

Effort 值為 `none`、`low`、`medium`、`high`、`xhigh`。使用
`chat_template_kwargs` profile 時，`none` 會送 `enable_thinking: false`；使用
`reasoning_effort` profile 時，會送 `reasoning_effort: "none"`；`none`
profile 則完全不送 reasoning 欄位。

### Sampling 預設

除非 `overrideSampling` 設為 false，外掛會使用 Qwen3.8-Flash-Next 模型卡的 sampler 值：

| 模式 | temperature | top_p | top_k | min_p | presence | repetition |
|---|---:|---:|---:|---:|---:|---:|
| Thinking | 依分類 | 0.95 | 20 | 0 | 0 | 1.0 |
| Non-thinking（`effort: none`） | 0.7 | 0.80 | 20 | 0 | 1.5 | 1.0 |

各分類原本的 temperature 仍保留；例如 code 與 tool 使用 0.6，而不是模型卡
thinking 的 1.0。這是為了 coding/tool 穩定性的刻意選擇，應做 A/B 測試。

### Provider 選擇

只有同時通過以下兩個條件的請求才會由 harness 處理：

1. model id 包含 `qwen3.8-flash-next`。
2. Provider 是本地：
   - provider id 在 `localProviders` 中（預設包含 `strata`、`ollama`、
     `llamacpp`、`vllm`、`lmstudio` 等），或
   - provider 設定的 `baseURL` 是本地位址；會自動偵測 localhost、私有 IPv4、
     Tailscale/CGNAT、`*.local` 與 Docker host 名稱。

接著會套用 `excludeProviders` 這個可選的明確排除名單。若 `providers` 非空，它就是
精確 allowlist，會取代上面的本地 provider 規則；否則由本地規則決定。

範例：

| Provider | 處理方式 |
|---|---|
| `strata` @ `http://100.64.0.10:8080/v1` | 選中：已知 id + Tailscale 位址 |
| `ollama` @ `http://localhost:11434/v1` | 選中：已知 id + localhost |
| `vllm` @ `http://192.168.1.20:8000/v1` | 選中：已知 id + 私有位址 |
| `my-server` @ `http://192.168.1.20:9000/v1` | 由 baseURL 選中；若無法偵測，加入 `localProviders` |
| `my-server` @ `https://llm.example.com/v1` | 除非 `my-server` 在 `localProviders`，否則不選中 |
| `opencode` @ `https://opencode.ai` | 不選中：不是本地 |
| `openai` @ `https://api.openai.com/v1` | 不選中：不是本地 |

Provider profile 只決定 reasoning 欄位，**不會**讓 provider 變成 local。若 provider
已被選中但 profile 是 `none`，todo、verification、subagent、compaction 仍會運作；
只有 reasoning routing 會被跳過。

### Reasoning profile

內建 profile：

| Provider id | Reasoning 欄位 |
|---|---|
| `strata` | `chat_template_kwargs`（`reasoning_effort` + `enable_thinking`） |
| `ollama` | 頂層 `reasoning_effort` |
| `llamacpp`、`llama-cpp`、`llama.cpp`、`llama-server` | 頂層 `reasoning_effort` |
| `vllm` | 頂層 `reasoning_effort`（vLLM 會映射到 `enable_thinking`） |
| `lmstudio`、`lm-studio` | 預設 none；其 OpenAI-compatible endpoint 目前無法可靠轉送 reasoning 控制 |
| 其他本地 provider | 預設 none |

不需改程式碼即可加入或覆寫 server：

```json
"localProviders": ["my-local-server", "my-strata-fork"],
"providerProfiles": {
  "my-local-server": "reasoning_effort",
  "my-strata-fork": { "reasoning": "chat_template_kwargs", "temperature": true }
}
```

有效的 reasoning 值為 `chat_template_kwargs`、`reasoning_effort`、`none`。若 server
不接受 temperature，profile 可設 `temperature: false`。自訂 provider id 也必須加入
`localProviders`，除非其 `baseURL` 已被偵測為本地；只有 profile 不會讓 provider
成為 target。

## 停用子代理

本專案針對本地或自架的 Qwen3.8 Flash Next（包含 IQ3_S），provider 可以是已知本地
id，或由本地 `baseURL` 偵測到的 provider。`modelIncludes` 是
`qwen3.8-flash-next`，因此涵蓋整個系列。此部署中，子代理比直接處理更弱也更慢，
所以設定 `disableSubagents: true`。

外掛會：

- 對每個目標請求的 system prompt 加入「Subagents are disabled for this model...」
  指令；
- 在 `chat.params` 將 session 標記為停用子代理；
- 在該 session 的 `task` 工具呼叫前丟出錯誤，提示模型改用直接工具。

`disableSubagents` 會套用到本地 provider 規則、`providers` 與 `modelIncludes`
選中的所有模型。若其他模型需要保留子代理，請收窄 `modelIncludes`。

這會阻止模型自行 spawn 子代理，但不會阻止使用者在 opencode 手動選擇 `explore` 或
`general` agent；那是 opencode 的 UI 操作，不是模型的 `task` 呼叫。外掛也會封鎖
在這類手動子代理 session 內發生的巢狀 `task` 呼叫。

## 使用 todo 規劃

啟用 `autoTodo: true` 後，外掛會對需要規劃的目標請求加入 system instruction：
3 個以上明確步驟或交付項目、實作、除錯、設計、ultra effort、風險工作、兩個以上
檔案，或長提示。它要求模型在第一次修改前，先在回覆中顯示詳細計畫：目標、依序
步驟與每步的一行理由、主要風險或取捨、要檢查的檔案或區域，以及驗證方式。之後才
呼叫 `todowrite`，建立精簡且依優先級排序的清單。模型必須讓同時只有一個項目處於
`in_progress`、完成後立即標記 `completed`，並在使用者沒有要求計畫時也主動加入
follow-up 或 blocker。簡單問題、搜尋、機械式修改與工具結果回合不會被要求規劃。

若 `todowrite` 已有 pending 或 `in_progress` 項目，後續請求會改用較短的
「保持清單最新」提醒，而不是重複完整建立指令。範圍或順序改變時，提醒也會要求
簡短說明原因。`tool.execute.after` hook 會依 session 追蹤這個狀態。

外掛本身不能呼叫 `todowrite`；這是 system-prompt 指引，因此模型仍可能跳過。用語
與狀態規則參考 opencode 自己的
[`todowrite` 指引](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/todowrite.txt)、
[v2 缺少指引的 issue](https://github.com/anomalyco/opencode/issues/59259)，以及
[opencode-todolist](https://www.opendock.net/plugins/opencode-todolist/) 與
[Subagent Todo](https://www.opendock.net/plugins/opencode-subagent-todo/) 使用的
active-list reminder 模式。

### 唯讀 plan 指令

可以在全域 opencode 設定加入 `/plan` 指令，路由到內建的唯讀 `plan` agent：

```json
"command": {
  "plan": {
    "description": "Create a detailed read-only plan for the current request",
    "agent": "plan",
    "template": "Create a detailed implementation plan for: $ARGUMENTS\n\nDo not edit files or run commands that change the workspace. Include the goal, ordered steps with a one-line reason for each, key risks or tradeoffs, files or areas to inspect, and the verification strategy. End with a concise todo-ready summary."
  }
}
```

遇到模糊或多檔案工作時先用 `/plan <需求>`，看完計畫再切回 build mode。這是
opencode 的 plan agent 路徑；plugin 的 todo 規劃仍用於實際 build 回合。

## 驗證與 compaction

啟用 `autoVerify: true` 後，外掛會監看 `edit`、`write`、`apply_patch`，加入簡短的
「上次檢查後又改了檔案」提醒。之後若 `bash` 指令看起來像 test、lint、typecheck 或
build，外掛會記錄成功或失敗。成功的檢查會清除提醒；失敗的檢查會保留更強烈的
「修正後重跑」提醒，直到後續檢查通過。

啟用 `verificationGate: true` 後，目前程式碼修改尚未檢查時，下一次 `edit`、
`write` 或 `apply_patch` 會被阻擋；純文件修改不受限制。檢查失敗後允許一次修正
修改，之後必須再跑檢查。這是刻意偏嚴格的設定；沒有可辨識 test/lint/build 指令的
專案應關閉 gate 或補上真正的檢查。可用 `verificationCommands: ["pnpm verify"]`
加入專案自訂指令。

`experimental.session.compacting` hook 會把 harness 狀態附加到 compaction context：
目前請求、規劃／todo 狀態、修改過的檔案、驗證狀態，以及最後一次失敗檢查的尾端。
這能在長 session 中把任務錨定住，參考 Cline 的 Focus Chain 與 auto-compact 模式、
OpenHands 的結構化 condenser，以及 Claude Code 的 plan/permission/compaction 模型。

指令偵測是啟發式的。自訂或冷門的驗證指令可能不會被辨識，因此提醒是建議性質，
不是強制封鎖。

## 分類訊號

分類器參考
[`opencode-model-router`](https://github.com/marco-jardim/opencode-model-router) 的
task-facts 方法（類別、風險、範圍）、
[`@reasoning-router`](https://github.com/robertn702/reasoning-router) 的 effort
描述，以及 Claude Code 的關鍵字分層。它仍是快速啟發式規則，不是模型呼叫。

- 工具結果回合，沒有失敗 -> `toolEffort`（`low`）。
- 工具結果回合，有錯誤 -> `toolFailureEffort`（`high`）。
- 同一任務兩次以上工具失敗 -> `toolFailureEscalatedEffort`（`xhigh`）。這是
  tiered router 用於重度除錯的「重複失敗後升級」規則。
- Debug/error/stack-trace/root-cause 訊號 -> `debugEffort`（`high`）。
- 架構／設計／review／取捨訊號 -> `designEffort`（`high`）。
- 程式碼、檔案路徑或實作動詞 -> `codeEffort`（`high`）。
- 重新命名／錯字／格式化／lint／單行 -> `mechanicalEffort`（`low`）。
- 尋找／定位／說明／摘要 -> `searchEffort`（`medium`）。
- 問候或瑣碎問題 -> `simpleEffort`（`low`）。
- 其他 -> `defaultEffort`（`medium`）。

風險關鍵字（production、deploy、migration、secrets、destructive changes）會強制套用
`riskMinimumEffort`，再依 `riskBumpSteps` 提升。多檔案與長提示只會提升仍低於
`high` 的 effort，因此一般兩檔案程式修改會維持 `high`，不會升到 `xhigh`。
`ultrathink` 與 `highKeywords` 最後套用。

工具結果訊號採用 TAB/Ares 類型 agent router 的 per-turn budget 概念：成功的工具
步驟成本低、失敗的需要更多思考、重複失敗需要最多思考。設計是受這些系統啟發，
不是直接複製。

## 運作方式

外掛註冊以下 hooks：

- `config` 掃描 provider 設定的 `baseURL`，把本地 endpoint 加入本地 provider 集合。
- `chat.message` 記錄每個 session 最新的使用者提示、判斷是否需要規劃，並重設
  工具失敗計數。
- `experimental.chat.messages.transform` 標記工具結果回合，包括 `tool` part 為
  completed/error 的 assistant 訊息，檢查工具錯誤並計算重複失敗次數。
- `chat.params` 分類提示、追蹤 session 使用的模型，把 harness 指令附加到目前訊息
  的 system 欄位，並寫入 provider 專屬的 reasoning 選項：

```json
{
  "chat_template_kwargs": {
    "reasoning_effort": "high",
    "enable_thinking": true
  }
}
```

- `experimental.chat.system.transform` 是給會呼叫它的 build 用的 fallback；它會加入
  停用子代理與 `todowrite` 指令。已測試的 opencode 1.19.4 路徑是 `chat.params`
  加上訊息 system 欄位。
- `tool.execute.before` 對標記為停用子代理的 session 中的 `task` 呼叫丟出錯誤。
- `tool.execute.after` 監看 `todowrite`、修改與驗證指令；後續規劃提示會改用簡短的
  active-list 提醒，並追蹤修改過的檔案是否仍需要檢查。
- `experimental.session.compacting` 把目前請求、todo／plan 狀態、修改檔案與驗證
  狀態注入 compaction context。

`@ai-sdk/openai-compatible` 會把未知的 provider options 展開到 request body，因此
本地 server 會收到該欄位。若 provider 會剝離未知 options，reasoning 部分就不會有
效果；請開 `debug: true` 並查看 opencode log。todo、subagent 與 verification 功能
仍會運作，因為它們在 opencode 內執行，而不是在 inference server。

## 限制

- 這是啟發式 router，不是訓練過的分類器。
- 工具結果偵測依賴 opencode 的 message parts 與 tool `state` 形狀，以及
  experimental `experimental.chat.messages.transform` hook；以 opencode 1.19.4
  測試，之後版本可能改變 part 形狀。
- 本地 server 必須支援其 provider profile 選用的 reasoning 欄位。Strata 必須接受
  每次請求的 `chat_template_kwargs`；Ollama、llama.cpp、vLLM 必須接受頂層
  `reasoning_effort`。LM Studio 的 OpenAI-compatible endpoint 目前無法可靠轉送
  reasoning 控制，因此預設 profile 是 `none`。
- 未知的本地 provider 在加入 profile 前不會送 reasoning 欄位；harness 功能仍會
  運作，只有 reasoning routing 被跳過。
- `disableSubagents` 封鎖內建 `task` 工具，不會封鎖手動選擇的 agent，並假設工具
  名稱仍是 `task`。
- `autoTodo` 是 prompt 層級指引；模型仍可能跳過 todo 清單。
- `autoVerify` 會偵測常見 test/lint/build 指令；自訂 script 可能不會被辨識。
  `verificationGate` 是硬性阻擋，請只在專案有可辨識檢查時開啟。
- 外掛不選擇模型；它只調整目標模型的 reasoning effort 與 temperature、可選擇封鎖
  其 `task` 工具、要求它以 todo 規劃，並追蹤驗證狀態。

## 開發

外掛是純 ESM JavaScript，沒有 build step。

```bash
node --test test/*.test.mjs
npm run smoke:opencode
```
`smoke:opencode` 需要已安裝 opencode，且 active config 已載入此外掛；它會啟動 headless server 與 mock 本地 provider。設定 `SMOKE_PROVIDER=ollama`、`llamacpp` 或 `vllm` 可驗證 top-level `reasoning_effort` profile。

## 品質評估

這只是**簡單驗證模型是否收到正確的 sampling 與 harness 設定**，不是完整的模型品質
benchmark；只跑一次 22 題也不構成統計證據。

真模型測試集包含 `eval/quality-cases.json` 的 18 題（精確答案、多步算術、邏輯、
指令遵循、可執行 JavaScript）與 `eval/long-cases.json` 的 4 題長 context
（needle、埋在文中的指令、multi-hop、事件摘要）。

```bash
$env:STRATA_UPSTREAM = "http://127.0.0.1:8080/v1"
$env:STRATA_API_KEY = "your-key"
npm run eval:quality
npm run eval:tools
```

`eval:quality` 比較 thinking 1.0、thinking 0.6、non-thinking 0.7；可用
`EVAL_IDS=id1,id2` 跑子集。`eval:tools` 使用真 opencode + 真 Strata provider，驗證
read、bash、todowrite 與 task blocking。

首次完整 22 題：thinking 1.0 與 0.6 都是 21/22（一個 code 輸出撞到 512 token 上限），
non-thinking 21/22（星期推理錯）。把 code 輸出上限提高到 2,048 後，7 個 code case
在三個 arm 全部通過；4 個 long-context case 也全部通過。已知品質失敗只剩
non-thinking 的星期題。Tool evaluation 4/4 通過。

這量的是答案品質，與 deterministic request contract tests、opencode smoke test
分開。

## 授權

MIT
