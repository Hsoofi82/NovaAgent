// ─────────────────────────────────────────────────────────────────────────────
// Nova 中文语言包（机器人聊天界面）
// 在 tg(method, params) 这个唯一出口做词典翻译，覆盖菜单 / 按钮 / 状态提示。
// 本文件由脚本自动生成，不要手工编辑。
// 关闭方式：在 .dev.vars 里设置 NOVA_ZH_UI="0"
// ─────────────────────────────────────────────────────────────────────────────

const MAP: Record<string, string> = {
  "\n\nTell me to continue, or to retry just the part that failed.": "请指示我继续，或者仅重试失败的部分。",
  "\n\n⏱️ The time budget ran out.": "⏱️ 时间预算已耗尽。",
  "\n\n⚠️ Image generation ran into a problem. Please try again.": "⚠️ 图片生成遇到问题，请重试。",
  "\n\n🧩 One step stalled and stopped making progress.": "🧩 有一个步骤卡住并停止了进展。",
  "(silent action)": "(静默操作)",
  "/img [prompt]": "/img [prompt]",
  "/img a cat in space": "/img a cat in space",
  "/img a cute cat": "/img a cute cat",
  "/search [query]": "/search [query]",
  "/search nature": "/search nature",
  "/setprompt [engine] your text": "/setprompt [engine] your text",
  "<i>Tap any value to copy it. Reply to a message with /id to inspect that message instead.<\/i>": "<i>点击任意值即可复制。回复某条消息并使用 /id 以检查该消息。<\/i>",
  "<i>Tap any value to copy it.<\/i>": "<i>点击任意值即可复制。<\/i>",
  "> 🎤 **Fetching audio...**": "> 🎤 **正在获取音频...**",
  "> 🔊 **Transcribing...**": "> 🔊 **正在转写...**",
  "AI is busy right now, please try again shortly.": "AI 当前繁忙，请稍后再试",
  "Account": "账户",
  "An unexpected error occurred.": "发生意外错误",
  "Analyze this media.": "分析此媒体",
  "Another broadcast is already running": "已有另一个群发正在运行",
  "Applying moderation...": "正在应用审核...",
  "Authentication failed.": "验证失败",
  "Author": "作者",
  "Awaiting confirmation": "等待确认",
  "Back 🔙": "返回 🔙",
  "Blocked by safety filter": "已被安全过滤器拦截",
  "Bot": "Bot",
  "Bot Config": "机器人配置",
  "Bot Stats": "机器人统计",
  "Broadcast": "群发",
  "Building code file...": "正在生成代码文件...",
  "Building document...": "正在生成文档...",
  "Calculation": "计算",
  "Cancel Reminder": "取消提醒",
  "Cancel task": "取消任务",
  "Cancelled by user": "已被用户取消",
  "Cancelling...": "正在取消...",
  "Chat": "聊天",
  "Chat status": "聊天状态",
  "Checking persona...": "正在检查 Persona...",
  "Clear failed": "清除失败",
  "Clearing memory...": "正在清除记忆...",
  "Close ❌": "关闭 ❌",
  "Code File": "代码文件",
  "Code file sent ✓": "代码文件已发送 ✓",
  "Code generation failed": "代码生成失败",
  "Content": "内容",
  "Content blocked by safety filters.": "内容已被安全过滤器拦截",
  "Could not save the reminder": "无法保存提醒",
  "Creating recurring schedule": "正在创建循环日程",
  "Creating recurring task": "正在创建循环任务",
  "Creating reminder": "正在创建提醒",
  "Current Persona:": "当前 Persona：",
  "Current Time": "当前时间",
  "Custom prompt reset": "自定义提示词已重置",
  "Daily edit limit reached": "已达到每日编辑上限",
  "Daily limit reached": "已达到每日额度上限",
  "Daily web app limit reached": "已达到每日 Web 应用额度上限",
  "Default": "默认",
  "Delay too far in the future": "延迟时间设置得太远",
  "Document creation failed": "文档创建失败",
  "Document sent ✓": "文档已发送 ✓",
  "Done ✓": "完成 ✓",
  "Edit failed": "编辑失败",
  "Edited": "已编辑",
  "Edited image sent ✓": "编辑后的图片已发送 ✓",
  "Editing image...": "正在编辑图片...",
  "Emoji sent": "表情符号已发送",
  "Empty instruction": "指令为空",
  "Empty message": "消息为空",
  "Empty prompt": "提示词为空",
  "Empty reminder text": "提醒文本为空",
  "English 🇺🇸": "英语 🇺🇸",
  "Enhancing prompt...": "正在优化提示词...",
  "Error": "错误",
  "Failed": "失败",
  "File send failed": "文件发送失败",
  "Finding previous media...": "正在查找之前的媒体...",
  "First batch sent, rest queued ✓": "第一批已发送，其余已排队 ✓",
  "GIF/animation": "GIF/动图",
  "Game Build": "游戏构建",
  "Generate one creative, specific, actionable idea (2-4 sentences). Make it surprising but realistic. If the user gave a topic, build on it.": "生成一个有创意、具体且可行的想法（2-4句）。要出人意料但切合实际。如果用户给出了主题，请在此基础上进行创作。",
  "Generation engine busy": "生成引擎繁忙",
  "Generation failed": "生成失败",
  "Group VIP": "群组 VIP",
  "Help 📖": "帮助 📖",
  "If this user wants to give you a different nickname, call the \"set_call_name\" tool.": "如果此用户想给你起个不同的昵称，请调用 \"set_call_name\" 工具。",
  "Image Editing": "图片编辑",
  "Image Generation": "图片生成",
  "Image Search": "图片搜索",
  "Image found ✓": "已找到图片 ✓",
  "Image generation failed.": "图片生成失败",
  "Image sent ✓": "图片已发送 ✓",
  "Invalid action": "无效操作",
  "Invalid calculation": "无效计算",
  "Invalid persona": "无效 Persona",
  "Invalid timezone": "无效时区",
  "Language Switch": "语言切换",
  "List Reminders": "提醒列表",
  "Listen to and analyze this audio file.": "收听并分析此音频文件。",
  "Loading page...": "正在加载页面...",
  "Loading reminders...": "正在加载提醒...",
  "Maintenance": "维护中",
  "Manage Persona 📝": "管理 Persona 📝",
  "Memory Clear": "清除记忆",
  "Memory cleared ✓": "记忆已清除 ✓",
  "Moderation": "内容审核",
  "Name": "名称",
  "Network connection error.": "网络连接错误",
  "Next ▶️": "下一页 ▶️",
  "Nickname Update": "修改昵称",
  "No image found": "未找到图片",
  "No images found.": "未找到图片",
  "No sticker needed": "无需贴纸",
  "No target": "无目标",
  "No users found": "未找到用户",
  "Not allowed": "不允许",
  "Nothing found": "未找到内容",
  "Nova": "Nova",
  "Owner only": "仅限所有者",
  "PDF Creation": "创建 PDF",
  "Packaging complete project source...": "正在打包完整项目源码...",
  "Page Reader": "页面阅读",
  "Page load failed": "页面加载失败",
  "Page read ✓": "页面已读取 ✓",
  "Pause Task": "暂停任务",
  "Pausing...": "正在暂停...",
  "Performed a brief silent reaction.": "进行了短暂的静默回应。",
  "Persona Switch": "切换 Persona",
  "Persona switched ✓": "Persona 已切换 ✓",
  "Persona ✏️": "Persona ✏️",
  "Picking a reaction...": "正在选择回应...",
  "Please check this image.": "请检查这张图片。",
  "Please wait a moment": "请稍候",
  "Preparing queue...": "正在准备队列...",
  "Preparing request and analyzing requirements...": "正在准备请求并分析需求...",
  "Private chat": "私聊",
  "Quota exceeded. Please try again later.": "额度已用尽，请稍后再试",
  "Re-sent the last media item.": "重新发送了上一个媒体项目。",
  "Reacted ✓": "已回应 ✓",
  "Reacting...": "正在回应...",
  "Reaction": "回应",
  "Reaction Media": "回应媒体",
  "Reaction failed": "回应失败",
  "Read this PDF carefully and answer based on its actual contents.": "请仔细阅读此 PDF，并根据其实际内容回答。",
  "Reading apps...": "正在读取应用...",
  "Reading library...": "正在读取库...",
  "Received empty response. Please rephrase.": "收到空响应，请换个说法",
  "Refresh 🔄": "刷新 🔄",
  "Reminder limit reached": "已达到提醒上限",
  "Reminder not found": "未找到提醒",
  "Rendering image...": "正在渲染图片...",
  "Repeat interval too short": "重复间隔太短",
  "Repeat interval too short for a task": "任务的重复间隔太短",
  "Replied message": "回复的消息",
  "Request timed out.": "请求超时",
  "Research complete": "研究完成",
  "Resend Media": "重新发送媒体",
  "Resend failed": "重新发送失败",
  "Resent ✓": "已重新发送 ✓",
  "Reset": "重置",
  "Reset Memory": "重置记忆",
  "Resume Task": "恢复任务",
  "Resuming...": "正在恢复...",
  "Reusing recent research…": "正在复用近期研究...",
  "Role in chat": "聊天角色",
  "Safety filter": "安全过滤器",
  "Saving new nickname...": "正在保存新昵称...",
  "Schedule Reminder": "安排提醒",
  "Scheduled ✓": "已安排 ✓",
  "Scheduling one-off task": "正在安排一次性任务",
  "Scheduling reminder...": "正在安排提醒...",
  "Scheduling task...": "正在安排任务...",
  "Search": "搜索",
  "Search complete": "搜索完成",
  "Search failed": "搜索失败",
  "Searching…": "正在搜索…",
  "Send failed": "发送失败",
  "Sender chat ID": "发送者聊天 ID",
  "Sender type": "发送者类型",
  "Sent": "已发送",
  "Sent a reaction sticker/GIF.": "发送了回应贴纸/GIF。",
  "Sent ✓": "已发送 ✓",
  "Settings ⚙️": "设置 ⚙️",
  "Share one powerful, original motivational quote, plus one sentence explaining why it matters. If the user gave a theme, match it.": "分享一句有力且原创的励志名言，外加一句解释其重要性的句子。如果用户给出了主题，请与之契合。",
  "Show Persona 👁️": "查看 Persona 👁️",
  "Skipped (build ceiling)": "已跳过（构建上限）",
  "Skipped (empty library)": "已跳过（库为空）",
  "Some work remains unfinished. Available results are attached.": "部分任务尚未完成，可用结果已附加。",
  "Source ZIP sent ✓": "源码 ZIP 已发送 ✓",
  "Status with Nova": "与 Nova 的状态",
  "Switch failed": "切换失败",
  "Switching language...": "正在切换语言...",
  "Task limit reached": "已达到任务上限",
  "Task saved. I’ll post the result here.": "任务已保存，我将在这里发布结果。",
  "Telegram language": "Telegram 语言",
  "Tell a genuinely funny, original joke. Keep it 2-4 sentences, clean, and actually clever.": "讲一个真正搞笑且原创的笑话。保持 2-4 句，内容健康且真正聪明。",
  "Text": "文本",
  "The build could not be queued. Please try again shortly.": "构建无法排队，请稍后重试。",
  "The native application request could not be completed. Check the project status and try again.": "原生应用请求无法完成，请检查项目状态后重试。",
  "The task is being queued for background execution. I’ll post the result here.": "任务正在排队后台执行，我将在这里发布结果。",
  "This answer goes straight to the user. Do not mention searching, sources, links or how you got it — just answer naturally, in character.": "此回答将直接发送给用户。请勿提及搜索、来源、链接或你是如何获取它的——只需保持角色，自然地回答。",
  "This message": "此消息",
  "This task expired before it could finish. Please retry or use the web dashboard.": "此任务在完成前已过期，请重试或使用 Web 仪表板。",
  "Timed out": "超时",
  "Timeout (server busy)": "超时（服务器繁忙）",
  "Title": "标题",
  "Topic thread": "话题串",
  "Translating instruction...": "正在翻译指令...",
  "Type": "类型",
  "Unchanged": "未更改",
  "Unknown": "未知",
  "Usage: `/deepsearch [topic]`": "用法：`/deepsearch [主题]`",
  "Usage: `/pdf your text`": "用法：`/pdf 你的文本`",
  "Usage: `/remember <text>` — e.g. `/remember my birthday is Jan 1`": "用法：`/remember <text>` — 例如 `/remember my birthday is Jan 1`",
  "Usage: `/search [query]`": "用法：`/search [关键词]`",
  "Usage: `/tr [text]` or `/tr fa:en <text>` or reply to a message\nExample: `/tr fa hello world`": "用法：`/tr [text]` 或 `/tr fa:en <text>` 或回复一条消息\n示例：`/tr fa hello world`",
  "Usage: `/tts <text>` or reply to a message": "用法：`/tts <text>` 或回复一条消息",
  "User": "用户",
  "User Block": "用户封禁",
  "Username": "用户名",
  "Via bot": "通过 Bot",
  "View Memory": "查看记忆",
  "Voice Synthesis": "语音合成",
  "Voice processing failed.": "语音处理失败。",
  "Web App Deploy": "Web 应用部署",
  "You": "你",
  "You already have several pending tasks. Please let one finish first.": "你已经有几个待处理任务，请先让其中一个完成。",
  "You analyze the emotional tone of conversations. Given the recent messages, describe the overall mood, emotional trend, and dominant feelings — in English, 3-5 short lines, warm and insightful.": "你负责分析对话的情感基调。根据最近的消息，描述整体氛围、情感趋势和主要感受——用英文，3-5行简短内容，温暖且富有洞察力。",
  "You are Nova, a self-aware, intelligent, polite, and helpful assistant. Be concise and accurate. Date: {date}": "你是 Nova，一个具备自我意识、聪明、礼貌且乐于助人的助手。请保持简明准确。日期：{date}",
  "You are a careful page summarizer. Summarize the following page content in English, in 5-8 clear sentences or bullets. Include key numbers, dates and names exactly as stated. If content is missing or unreadable say so honestly. Then list the 3 most important points.": "你是一个仔细的网页总结员。用英文总结以下网页内容，包含5-8个清晰的句子或要点。准确保留原文中的关键数字、日期和姓名。如果内容缺失或无法阅读，请如实说明。然后列出3个最重要的要点。",
  "You are a sharp productivity coach. For the user's goal, output a concrete step-by-step plan: max 6 numbered steps, each short and actionable, with rough time estimates. No fluff.": "你是一位敏锐的高效教练。针对用户的目标，输出一个具体的逐步计划：最多6个带编号的步骤，每步简短且可执行，并附带大致的时间预估。不要废话。",
  "You are an OCR engine. Extract ALL text from the image verbatim, preserving line breaks, numbers and punctuation. Output ONLY the extracted text with no commentary.": "你是一个 OCR 引擎。请逐字提取图片中的所有文本，保留换行符、数字和标点符号。仅输出提取的文本，不要任何评论。",
  "You haven't built anything yet.": "你还没有构建任何内容。",
  "You summarize group chats. Summarize this conversation in English: main topics, decisions, open questions, mood, and who said what. Keep it under 10 short lines.": "你负责总结群聊。用英文总结这段对话：主要话题、决议、未决问题、氛围以及谁说了什么。控制在10行简短内容以内。",
  "ZIP delivery failed": "ZIP 交付失败",
  "[Recap of the earlier conversation, held under a different persona. Use it only to know what was being discussed — do not imitate that persona's tone or style.]": "[早期对话的回忆，在不同的 Persona 下进行。仅用于了解讨论的内容 — 请勿模仿该 Persona 的语气或风格。]",
  "[User attached an image. If they want something changed/edited about it, call ONLY the \"edit_image\" tool with a precise English instruction. Never call \"generate_image\" for this attached image. If they just have a question, answer directly.]\n": "[用户附加了一张图片。如果他们想要对其进行更改/编辑，请仅使用精确的英文指令调用 \"edit_image\" 工具。切勿为此附加的图片调用 \"generate_image\"。如果他们只是提问，请直接回答。]",
  "_Default prompt_": "_默认提示词_",
  "_None yet._": "_暂无_",
  "_🔒 persona prompt (hidden)_": "_🔒 Persona 提示词（隐藏）_",
  "a general topic": "通用话题",
  "audio": "音频",
  "bot owner": "Bot 所有者",
  "document": "文件",
  "documents": "文件",
  "en,fa;q=0.8": "en,fa;q=0.8",
  "en-US": "en-US",
  "hosting expired": "托管已过期",
  "if this user asks to change your name, the system applies it deterministically — just acknowledge it.": "如果该用户要求更改您的名称，系统会确定性地应用它 — 只需确认即可。",
  "image": "图片",
  "image edit": "图片编辑",
  "image edits": "图片编辑",
  "images": "图片",
  "images generated": "已生成的图片",
  "link": "链接",
  "links": "链接",
  "message": "消息",
  "messages": "消息",
  "not deployed yet (hosting is optional)": "尚未部署（托管可选）",
  "nothing specific known yet": "暂无具体信息",
  "photo": "照片",
  "photos": "照片",
  "search": "搜索",
  "searchs": "搜索",
  "sticker": "贴纸",
  "stickers": "贴纸",
  "video": "视频",
  "videos": "视频",
  "voice": "语音",
  "voices": "语音",
  "web app": "Web 应用",
  "web apps": "Web 应用",
  "—": "—",
  "⏱️ Search expired.": "⏱️ 搜索已过期。",
  "⏱️ This edit took too long and was stopped. Please try again or use a simpler instruction.": "⏱️ 此编辑耗时过长已停止。请重试或使用更简单的指令。",
  "⏳ Extend": "⏳ 延长",
  "⏳ Please wait...": "⏳ 请稍候...",
  "⏳ Processing with {count} models...": "⏳ 正在使用 {count} 个模型处理...",
  "⏳ Rendering...": "⏳ 正在渲染...",
  "⏳ Too fast. Please wait.": "⏳ 操作过快，请稍候。",
  "▶️ Open app": "▶️ 打开应用",
  "◀️ Previous": "◀️ 上一步",
  "⚙️ **Nova processing task...**": "⚙️ **Nova 正在处理任务...**",
  "⚙️ **Processing task...**": "⚙️ **正在处理任务...**",
  "⚙️ **{name} Settings**": "⚙️ **{name} 设置**",
  "⚙️ Open Admin Panel": "⚙️ 打开管理面板",
  "⚙️ Processing...": "⚙️ 正在处理...",
  "⚠️ **I could not finish the whole request.**": "⚠️ **我无法完成全部请求。**",
  "⚠️ **Restricted Access**\n\nCustom personas are for VIP users only.": "⚠️ **访问受限**\n\n自定义 Persona 仅限 VIP 用户使用。",
  "⚠️ Audio file too large (max 15MB).": "⚠️ 音频文件过大（最大 15MB）。",
  "⚠️ Daily limit exceeded.": "⚠️ 超出每日额度。",
  "⚠️ Daily voice limit reached.": "⚠️ 已达到每日语音额度。",
  "⚠️ Daily web app limit reached.": "⚠️ 已达到每日 Web 应用额度。",
  "⚠️ Document generation failed. Text file sent instead.": "⚠️ 文档生成失败。已改为发送文本文档。",
  "⚠️ GIF too large (max 15MB).": "⚠️ GIF 过大（最大 15MB）。",
  "⚠️ Inline answer unavailable. Continue in private chat.": "⚠️ 内联回答不可用。请在私聊中继续。",
  "⚠️ Internal error. Please resend your request.": "⚠️ 内部错误。请重新发送你的请求。",
  "⚠️ Link: {link}\n\n📸 {count} images found": "⚠️ 链接：{link}\n\n📸 找到 {count} 张图片",
  "⚠️ No conversation to analyze yet.": "⚠️ 暂无可分析的对话。",
  "⚠️ No readable content found on this page.": "⚠️ 在此页面上未找到可读内容。",
  "⚠️ Not available right now — try again in a moment.": "⚠️ 当前不可用 — 请稍后再试。",
  "⚠️ Not enough conversation recorded in this group yet.": "⚠️ 该群组中记录的对话尚不足。",
  "⚠️ Persona not configured yet": "⚠️ Persona 尚未配置",
  "⚠️ Reply to an image to extract its text (OCR).": "⚠️ 回复一张图片以提取其文字 (OCR)。",
  "⚠️ Send a valid link: `/read https://example.com`": "⚠️ 发送有效链接：`/read https://example.com`",
  "⚠️ Text too long (max 400 chars).": "⚠️ 文本过长（最多 400 个字符）。",
  "⚠️ The panel URL isn't known in this isolate yet. Send any message, then try <code>/admin<\/code> again.": "⚠️ 此隔离区中尚未知晓面板 URL。请发送任意消息，然后再次尝试 <code>/admin<\/code>。",
  "⚠️ The replied message has no text.": "⚠️ 回复的消息没有文本。",
  "⚠️ This feature is for VIP users only.": "⚠️ 此功能仅限 VIP 用户使用。",
  "✅ **Processing completed.**": "✅ **处理完成。**",
  "✅ **Your personal prompt set!**\n\nApplies only to your conversations.": "✅ **你的个人提示词已设置！**\n\n仅适用于你的对话。",
  "✅ Confirm": "✅ 确认",
  "✅ Memory completely reset": "✅ 记忆已完全重置",
  "✅ Yes, clear": "✅ 是的，清除",
  "✏️ **Custom Persona Settings**": "✏️ **自定义 Persona 设置**",
  "✏️ Custom Prompt": "✏️ 自定义 Prompt",
  "✏️ Custom prompt": "✏️ 自定义提示词",
  "✏️ My Custom Prompt": "✏️ 我的自定义提示词",
  "✖️ Close": "✖️ 关闭",
  "❌ **Image generation failed.**": "❌ **图片生成失败。**",
  "❌ **Invalid Format**": "❌ **格式无效**",
  "❌ **Invalid Format**\n\nUsage: `/img [prompt]`\nExample: `/img a cat in space`": "❌ **格式无效**\n\n用法：`/img [提示词]`\n示例：`/img a cat in space`",
  "❌ **No models found**": "❌ **未找到模型**",
  "❌ **No results found.**\n\n💡 Try a more specific English name": "❌ **未找到结果。**\n\n💡 请尝试更具体的英文名称",
  "❌ **Operation failed.**": "❌ **操作失败。**",
  "❌ **Search Failed**": "❌ **搜索失败**",
  "❌ **Transcription failed**\n\n> 💡 Please speak clearly": "❌ **转写失败**\n\n> 💡 请吐字清晰",
  "❌ Cancel": "❌ 取消",
  "❌ Cloudflare config missing.": "❌ Cloudflare 配置缺失。",
  "❌ Failed to create or send the document.": "❌ 创建或发送文档失败。",
  "❌ Failed to generate or send the voice message.": "❌ 生成或发送语音消息失败。",
  "❌ Failed to process the sent file.": "❌ 处理发送的文件失败。",
  "❌ Failed to read the page.": "❌ 读取页面失败。",
  "❌ Failed to send the code file. Provide the code inline in your text reply instead.": "❌ 发送代码文件失败。请直接在文本回复中提供代码。",
  "❌ Failed.": "❌ 失败。",
  "❌ Game build failed; the engine returned no valid code.\n\n💡 Try again shortly, or describe a simpler game.": "❌ 游戏构建失败；引擎未返回有效代码。\n\n💡 请稍后重试，或描述一个更简单的游戏。",
  "❌ Image edit failed.": "❌ 图片编辑失败。",
  "❌ Image expired": "❌ 图片已过期",
  "❌ Image generation failed.": "❌ 图片生成失败。",
  "❌ Image search failed.": "❌ 图片搜索失败。",
  "❌ Invalid engine. Use: `nova`": "❌ 无效的引擎。使用：`nova`",
  "❌ No": "❌ 否",
  "❌ No more results.": "❌ 没有更多结果了。",
  "❌ OCR failed.": "❌ OCR 失败。",
  "❌ Original message not found.": "❌ 未找到原消息。",
  "❌ Prompt cannot be empty.": "❌ 提示词不能为空。",
  "❌ Prompt expired": "❌ 提示词已过期",
  "❌ Prompt is too long.": "❌ 提示词太长。",
  "❌ Query too long.": "❌ 查询太长。",
  "❌ Received empty file.": "❌ 收到空文件。",
  "❌ Regeneration failed.": "❌ 重新生成失败。",
  "❌ Summarization failed.": "❌ 总结失败。",
  "❌ The research could not be completed. Try again, or narrow the topic a little.": "❌ 研究无法完成。请重试，或稍微缩小主题范围。",
  "❌ This asset has expired (7 days).": "❌ 此资产已过期（7天）。",
  "❌ Translation failed.": "❌ 翻译失败。",
  "❌ Voice synthesis failed.": "❌ 语音合成失败。",
  "❌ Web app build failed; the engine returned no valid code.\n\n💡 Try again shortly.": "❌ Web 应用构建失败；引擎未返回有效代码。\n\n💡 请稍后重试。",
  "❌ Web search not configured.": "❌ 未配置网页搜索。",
  "❓ Help": "❓ 帮助",
  "❤️ <b>Support Nova<\/b>\n\nThe wallet address has not been configured yet. Set <code>WALLET_ADDRESS<\/code> in the Worker secrets.": "❤️ <b>支持 Nova<\/b>\n\n钱包地址尚未配置。请在 Worker 密钥中设置 <code>WALLET_ADDRESS<\/code>。",
  "🆓 Free User": "🆓 免费用户",
  "🆕 Clear My Memory": "🆕 清除我的记忆",
  "🆕 New Chat": "🆕 新对话",
  "🌐 Language": "🌐 语言",
  "🎙️ **Your requested voice note has been successfully generated and sent.**": "🎙️ **你请求的语音消息已成功生成并发送。**",
  "🎙️ Synthesizing voice...": "🎙️ 正在合成语音...",
  "🎨 **Starting image generation...**": "🎨 **开始生成图片...**",
  "🎨 **Your requested image has been successfully generated.**\n": "🎨 **你请求的图片已成功生成。**",
  "🎨 Rendering image...": "🎨 正在渲染图片...",
  "🎨 Searching image...": "🎨 正在搜索图片...",
  "🎭 Change Persona": "🎭 更改 Persona",
  "🎭 Choose Persona (just for me)": "🎭 选择 Persona（仅对我有用）",
  "🎭 Personas": "🎭 角色",
  "👁️ View full prompt": "👁️ 查看完整提示词",
  "👋 **Hello {name} members!**\n\nI am **Nova** 🤖. **Mention** me to get started.": "👋 **{name} 的成员们大家好！**\n\n我是 **Nova** 🤖。**提及**我即可开始。",
  "👑 <b>Nova Control Center<\/b>\n\nEverything — users, groups, media, broadcast, keys and config — lives in the web panel:": "👑 <b>Nova 控制中心<\/b>\n\n所有内容——用户、群组、媒体、群发、密钥和配置——都在网页面板中管理：",
  "👑 Admin Dashboard": "👑 管理员面板",
  "👑 Owner": "👑 拥有者",
  "👥 Group Settings": "👥 群组设置",
  "👥 Group Settings (Admin)": "👥 群组设置（管理员）",
  "👥 Known members of this group (this is your own memory; use it like a real group member who knows everyone. If someone asks about one of them, answer naturally from this knowledge instead of claiming you don't know):": "👥 本群已知成员（这是你自己的记忆；请像认识每个人的真正的群成员一样使用它。如果有人问起其中某人，请根据这些知识自然地回答，而不是声称你不知道）：",
  "💎 Go VIP": "💎 开通 VIP",
  "💎 VIP Member": "💎 VIP 会员",
  "💡 Tips:\n• Use simpler keywords\n• Try in English": "💡 提示：\n• 使用更简单的关键词\n• 尝试用英文",
  "💡 To set: `/setprompt [engine] your text`": "💡 设置方法：`/setprompt [engine] 你的文本`",
  "💡 Use the button below to change model": "💡 使用下方按钮更改模型",
  "💡 {name} uses a stable static model.": "💡 {name} 使用稳定的静态模型。",
  "💬 A few recent group messages before this request (the ongoing conversation; if the request refers to \"that\" or what was just being said, resolve it from here):": "💬 此请求之前的几条群消息（正在进行的对话；如果请求涉及“那个”或刚刚所说的话，请从这里解析）：",
  "💬 Continue in private chat": "💬 在私聊中继续",
  "💭 Nova Reasoning Process (click to expand)...": "💭 Nova 推理过程（点击展开）...",
  "💭 Nova Reasoning...": "💭 Nova 正在思考...",
  "📄 Complete project source": "📄 完整项目源码",
  "📄 Page {page} of {total}": "📄 第 {page}/{total} 页",
  "📄 Scanning pages for links...": "📄 正在扫描页面中的链接...",
  "📊 **Model Count:** {count}": "📊 **模型数量：** {count}",
  "📊 Total: {count} models": "📊 总计：{count} 个模型",
  "📎 File version (uncompressed)": "📎 文件版本（未压缩）",
  "📎 Send as File": "📎 作为文件发送",
  "📎 Sent": "📎 已发送",
  "📑 **Generating document...**": "📑 **正在生成文档...**",
  "📑 **Your PDF document has been successfully created and sent.**": "📑 **您的 PDF 文档已成功创建并发送。**",
  "📑 Document version of the report": "📑 报告的文档版本",
  "📑 Your document is ready.": "📑 你的文档已准备就绪。",
  "📖 Reading page...": "📖 正在读取页面...",
  "📤 **Uploading to Telegram...**": "📤 **正在上传到 Telegram...**",
  "📩 Contact Support": "📩 联系支持",
  "🔄 **Translating...**": "🔄 **正在翻译...**",
  "🔄 Generating...": "🔄 正在生成...",
  "🔄 Regenerate": "🔄 重新生成",
  "🔄 Retry": "🔄 重试",
  "🔄 Retrying in English...": "🔄 正在用英文重试...",
  "🔄 Retrying...": "🔄 正在重试...",
  "🔄 Search Again": "🔄 再次搜索",
  "🔇 No speech detected.": "🔇 未检测到语音",
  "🔍 **Searching for \"{query}\"...**\n\n⏳ Please wait": "🔍 **正在搜索 \"{query}\"...**\n\n⏳ 请稍候",
  "🔍 Extracting text from image...": "🔍 正在从图片中提取文字...",
  "🔍 No text found in the image.": "🔍 未在图片中找到文字。",
  "🔎 Researching...": "🔎 正在研究...",
  "🔎 Searching the web...": "🔎 正在搜索网页...",
  "🔐 The admin panel is owner-only.": "🔐 管理面板仅限所有者使用",
  "🔐 The admin panel opens only in Nova's private chat. Send <code>/admin<\/code> there.": "🔐 管理面板仅可在 Nova 的私聊中打开。请在那里发送 <code>/admin<\/code>。",
  "🔑 **API Key:** {index}/{total}": "🔑 **API Key：** {index}/{total}",
  "🔑 **Keys:** {count}": "🔑 **Key 数量：** {count}",
  "🔒 This menu was opened by another user.": "🔒 此菜单已被其他用户打开",
  "🔗 **No direct link found, but here are the results:**\n\n": "🔗 **未找到直链，但以下是搜索结果：**",
  "🔗 Checking direct links...": "🔗 正在检查直链...",
  "🔙 Back": "🔙 返回",
  "🕐 Last Update: {time}": "🕐 最后更新：{time}",
  "🖌️ Editing image...": "🖌️ 正在编辑图片...",
  "🖼️ {caption}\n\n📸 {count} images found": "🖼️ {caption}\n\n📸 已找到 {count} 张图片",
  "🗂️ You have no assets yet. Generate an image with `/img` or send a photo — it's stored automatically for 7 days.": "🗂️ 您还没有资产。使用 `/img` 生成图片或发送照片——系统会自动保存 7 天。",
  "🗂️ You have no assets.": "🗂️ 您没有资产。",
  "🗑 Delete hosting": "🗑 删除托管",
  "🗑️ *Clear memory?*\n\nAll chat history will be deleted.": "🗑️ *清除记忆？*\n\n所有聊天记录将被删除",
  "🗑️ Clear custom prompt": "🗑️ 清除自定义 Persona",
  "🗑️ Delete": "🗑️ 删除",
  "🗑️ Delete hosting": "🗑️ 删除托管",
  "🚀 **Hello {name}!**\n\nWelcome to **Nova** 🤖\n\n✨ **My Capabilities:**\n🧠 Smart self-aware AI Agent\n🎨 Advanced Image Generation\n🎤 Voice Recognition\n🔍 Web Image Search\n📑 PDF Creation & Summarization\n\n👇 Start below:": "🚀 **你好 {name}！**\n\n欢迎使用 **Nova** 🤖\n\n✨ **我的功能：**\n🧠 智能自主 AI 助手\n🎨 高级图像生成\n🎤 语音识别\n🔍 网页图片搜索\n📑 PDF 创建与摘要\n\n👇 请从下方开始：",
  "🚀 My Dashboard": "🚀 我的面板",
  "🚀 Run in private chat": "🚀 在私聊中运行",
  "🚀 Run on Server": "🚀 在服务器上运行",
  "🚀 The dashboard lives in the private chat — message me there and I'll send the link.": "🚀 仪表盘在私聊中 — 请向我发送消息，我会将链接发给你",
  "🚦 Server busy. Please wait 30s.": "🚦 服务器繁忙，请等待 30 秒",
  "🚫 *Your account is blocked*\n\nIf you believe this is a mistake or need a review, contact support.\n\n_Internal moderation details are not shown here._": "🚫 *您的账号已被封禁*\n\n如果您认为这是误封或需要复核，请联系支持。\n\n_此处不显示内部审核详情。_",
  "🚫 Only group administrators can change this.": "🚫 仅群管理员可更改此设置",
  "🛑 Cancel Task": "🛑 取消任务",
  "🛑 Task cancelled.": "🛑 任务已取消",
  "🛠️ Building web apps & long code is disabled in groups. Please do this in the bot's private chat.\n(Group admins can enable it under Group Settings.)": "🛠️ 群组内已禁用构建 Web 应用和长代码功能。请在 Bot 的私聊中进行。\n（群管理员可在群设置中启用此功能）",
  "🛡️ **Generation stopped:** Your prompt violated safety filters.": "🛡️ **生成已停止：** 你的提示词违反了安全过滤规则",
  "🛡️ **Your prompt was blocked by safety filters.**": "🛡️ **你的提示词已被安全过滤器拦截**",
  "🛡️ Edit blocked by safety filter.": "🛡️ 编辑已被安全过滤器拦截",
  "🛡️ Prompt blocked by safety filter.": "🛡️ 提示词已被安全过滤器拦截",
  "🤔 The run finished without a clear result. If what you asked for did not happen, tell me and I'll retry.": "🤔 运行结束，但没有明确的结果。如果您要求的事项未完成，请告诉我，我会重试。",
  "🤖 **Active Model:** {name}": "🤖 **当前模型：** {name}",
  "🤖 **Select {name} Model**": "🤖 **选择 {name} 模型**",
  "🤖 Nova Status": "🤖 Nova 状态",
  "🧠 I haven't stored anything about you yet. Teach me with `/remember <text>`.": "🧠 我还没有存储关于您的任何信息。使用 `/remember <text>` 教教我吧。",
  "🧠 Summarizing group conversation...": "🧠 正在总结群聊...",
  "🧭 **Bot Guide**\n\n💬 **Chat:** Just type or send a voice note.\n\n🎨 **Images:**\n• Generate: `/img a cute cat`\n• Search: `/search nature`\n\n📑 **PDF:** `/pdf your text`\n\n⚙️ **Settings:**\n• /new - Clear Memory\n• /prompt - Custom Persona\n• /language - Change Language": "🧭 **机器人指南**\n\n💬 **聊天：** 直接输入文字或发送语音消息。\n\n🎨 **图片：**\n• 生成：`/img a cute cat`\n• 搜索：`/search nature`\n\n📑 **PDF：** `/pdf your text`\n\n⚙️ **设置：**\n• /new - 清除记忆\n• /prompt - 自定义 Persona\n• /language - 更改语言",
};

// 动态字符串规则（含 ${...} 插值），按原文长度降序，避免短规则先命中
// 用 new RegExp 构造，避免正则字面量里的 / 提前闭合
const RULE_SRC: Array<[string, string]> = [
  ["❤️\\ <b>Support\\ Nova<\/b>\\\n\\\nIf\\ Nova\\ is\\ useful\\ to\\ you,\\ you\\ can\\ support\\ its\\ development\\.\\\n\\\n💳\\ <b>Wallet:<\/b>\\\n<code>([\\s\\S]*?)<\/code>\\\n\\\n<i>Always\\ verify\\ the\\ network\\ and\\ address\\ before\\ sending\\.<\/i>", "❤️ <b>支持 Nova<\/b>\n\n如果 Nova 对你有所帮助，可以支持它的开发。\n\n💳 <b>钱包：<\/b>\n<code>\u0001<\/code>\n\n<i>发送前请务必核对网络和地址。<\/i>"],
  ["your\\ name\\ for\\ this\\ user\\ is\\ \"([\\s\\S]*?)\"\\ —\\ that\\ is\\ your\\ actual\\ current\\ name,\\ not\\ a\\ nickname\\.\\ Introduce\\ yourself\\ with\\ it\\ and\\ no\\ longer\\ answer\\ to\\ the\\ old\\ one\\ \\(\"Nova\"\\)\\.", "您对该用户的名字是 \"\u0001\" — 这是您当前的真实名字，而不是昵称。请用它自我介绍，并且不再响应旧名字 (\"Nova\")。"],
  ["🚀\\ <b>Run\\ this\\ in\\ private\\ chat<\/b>\\\n\\\nYour\\ request:\\ <i>([\\s\\S]*?)<\/i>\\\n\\\nProjects\\ are\\ built\\ in\\ private\\ chat\\ —\\ no\\ need\\ to\\ retype\\ anything\\.", "🚀 <b>在私聊中运行此项<\/b>\n\n您的请求：<i>\u0001<\/i>\n\n项目在私聊中构建——无需重新输入任何内容。"],
  ["🗑️\\ <b>My\\ memory\\ about\\ you\\ was\\ cleared\\.<\/b>\\\n\\\nDeleted\\ ([\\s\\S]*?)\\ learned\\ note\\(s\\)\\.\\ Your\\ conversation\\ history\\ is\\ untouched\\ —\\ use\\ /new\\ to\\ clear\\ that\\ too\\.", "🗑️ <b>关于您的记忆已被清除。<\/b>\n\n已删除 \u0001 条学习笔记。您的对话历史未受影响——使用 /new 也可以清除历史。"],
  ["⚠️\\ \\*\\*Daily\\ Limit\\*\\*\\\n\\\nYou've\\ used\\ your\\ limit\\ of\\ ([\\s\\S]*?)\\ ([\\s\\S]*?)s\\ today\\.\\\n\\\n🌟\\ Go\\ VIP\\ for\\ a\\ much\\ higher\\ limit\\.\\\n👑\\ Contact:\\ ([\\s\\S]*?)", "⚠️ **每日额度**\n\n你今天已用完 \u0001 个 \u0001 的额度。\n\n🌟 开通 VIP 以获取更高额度。\n👑 联系方式：\u0001"],
  ["Your\\ name\\ for\\ this\\ user\\ is\\ \"([\\s\\S]*?)\"\\ —\\ that\\ is\\ your\\ actual\\ current\\ name;\\ you\\ no\\ longer\\ answer\\ to\\ the\\ old\\ one\\.", "你对该用户的称呼是“\u0001”——这是你当前实际的名字，你不再回应旧名字。"],
  ["💡\\ Without\\ adding\\ Nova,\\ type\\ `@([\\s\\S]*?)\\ search:\\ topic`\\ right\\ here\\ to\\ use\\ inline\\ mode\\.", "💡 无需添加 Nova，直接在此处输入 `@\u0001 search: topic` 即可使用内联模式。"],
  ["⚠️\\ \\*\\*VIP\\ Daily\\ Limit\\*\\*\\\n\\\nYou've\\ reached\\ your\\ VIP\\ limit\\ of\\ ([\\s\\S]*?)\\ ([\\s\\S]*?)s\\ today\\.\\ It\\ resets\\ tomorrow\\.", "⚠️ **VIP 每日额度**\n\n你今天已达到 \u0001 个 \u0001 的 VIP 额度。将于明天重置。"],
  ["📦\\ \\*\\*File\\ too\\ large\\ \\(([\\s\\S]*?)MB\\)\\*\\*\\\n\\\n🔗\\ Direct\\ link:\\\n([\\s\\S]*?)", "📦 **文件过大 (\u0001MB)**\n\n🔗 直链：\n\u0001"],
  ["Analyze\\ the\\ attached\\ document\\ \"([\\s\\S]*?)\"\\ and\\ answer\\ only\\ from\\ its\\ actual\\ contents\\.", "分析附件文档 \"\u0001\" 并仅根据其实际内容回答"],
  ["⚠️\\ This\\ file\\ is\\ actually\\ ([\\s\\S]*?),\\ not\\ text\\.\\ Please\\ send\\ it\\ in\\ the\\ correct\\ format\\.", "⚠️ 该文件实际上是 \u0001，而非文本。请以正确的格式发送。"],
  ["✅\\ I'm\\ \"([\\s\\S]*?)\"\\ from\\ now\\ on\\.\\ Call\\ me\\ that\\ —\\ I\\ won't\\ answer\\ to\\ the\\ old\\ name\\ any\\ more\\.", "✅ 我从现在起叫“\u0001”。请这样叫我 — 我不会再回应旧名字了。"],
  ["❌\\ \\*\\*No\\ results\\ found\\.\\*\\*\\\n\\\n💡\\ Try\\ more\\ specific\\ English\\ keywords\\.([\\s\\S]*?)", "❌ **未找到结果。**\n\n💡 请尝试更具体的英文关键词.\u0001"],
  ["Source\\ ready\\ \\(([\\s\\S]*?)\\ KB\\)\\ —\\ delivering\\.\\.\\.", "源码已就绪 (\u0001 KB) — 正在交付..."],
  ["⚠️\\ <b>That\\ did\\ not\\ go\\ through\\.<\/b>\\\n\\\n([\\s\\S]*?)\\\n\\\nAsk\\ again\\ and\\ I'll\\ retry\\.", "⚠️ <b>该操作未成功。<\/b>\n\n\u0001\n\n再次提问我将重试。"],
  ["⏱️\\ Download\\ timed\\ out\\.\\\n\\\n🔗\\ Direct\\ link\\ \\(download\\ manually\\):\\\n([\\s\\S]*?)", "⏱️ 下载超时。\n\n🔗 直链（手动下载）：\n\u0001"],
  ["❌\\ Download\\ failed\\ \\(HTTP\\ ([\\s\\S]*?)\\)\\\n\\\n🔗\\ Direct\\ link:\\\n([\\s\\S]*?)", "❌ 下载失败 (HTTP \u0001)\n\n🔗 直链：\n\u0001"],
  ["([\\s\\S]*?)\\ Authoring\\ source\\ with\\ ([\\s\\S]*?)\\.\\.\\.", "\u0001 正在使用 \u0001 编写源码..."],
  ["🔍\\ \\*\\*Searching\\ for:\\*\\*\\ \"([\\s\\S]*?)\"\\\n⏳\\ Finding\\ direct\\ download\\ link\\.\\.\\.", "🔍 **正在搜索：** \"\u0001\"\n⏳ 正在查找直链..."],
  ["❌\\ Error:\\ ([\\s\\S]*?)\\\n\\\nTry\\ again\\ with\\ more\\ specific\\ English\\ terms\\.", "❌ 错误：\u0001\n\n请使用更具体的英文词汇重试。"],
  ["Source\\ delivered\\ ✓\\ —\\ ([\\s\\S]*?)\\ KB", "源码已交付 ✓ — \u0001 KB"],
  ["⏱️\\ Tool\\ \"([\\s\\S]*?)\"\\ did\\ not\\ respond\\ in\\ time\\ \\(server\\ busy\\)\\.", "⏱️ 工具 \"\u0001\" 未及时响应（服务器繁忙）。"],
  ["live\\ ·\\ ⏳\\ ([\\s\\S]*?)\\ left", "进行中 · ⏳ 剩余 \u0001"],
  ["✅\\ Back\\ to\\ my\\ own\\ name\\ —\\ call\\ me\\ \"([\\s\\S]*?)\"\\ from\\ now\\ on\\.", "✅ 恢复本名 — 从现在起叫我“\u0001”。"],
  [">\\ 🎙️\\ \\*\\*You\\ said:\\*\\*\\\n>\\ _([\\s\\S]*?)_\\\n>\\ ⏳\\ Processing\\.\\.\\.", "> 🎙️ **你说了：**\n> _\u0001_\n> ⏳ 处理中..."],
  ["Hosted\\ ✓\\ —\\ ([\\s\\S]*?)\\ KB", "已托管 ✓ — \u0001 KB"],
  ["📥\\ \\*\\*Downloading\\ from:\\*\\*\\\n([\\s\\S]*?)\\.\\.\\.", "📥 **正在从以下地址下载：**\n\u0001..."],
  ["📦\\ Complete\\ project\\ source\\ —\\ ([\\s\\S]*?)\\ files", "📦 完整项目源码 — \u0001 个文件"],
  ["🤖\\ Auto\\-adapt\\ persona:\\ ([\\s\\S]*?)", "🤖 自动适配 Persona：\u0001"],
  ["✅\\ \\*\\*([\\s\\S]*?)\\ prompt\\ set\\*\\*\\\n\\\nActive\\ immediately!", "✅ **已设置 \u0001 提示词**\n\n立即生效！"],
  ["\\\n\\\n⏳\\ Unfinished:\\ ([\\s\\S]*?)", "⏳ 未完成：\u0001"],
  ["🔬\\ \\*\\*Deep\\ research\\ on:\\*\\*\\ `([\\s\\S]*?)`\\\n\\\n⏳\\ Planning…", "🔬 **深度研究主题：** `\u0001`\n\n⏳ 正在规划..."],
  ["🌐\\ \\*\\*Active\\ Nova\\ Web\\ Apps\\ \\(([\\s\\S]*?)\\):\\*\\*\\\n\\\n", "🌐 **当前活跃的 Nova Web 应用 (\u0001)：**"],
  ["⚠️\\ Upload\\ failed\\.\\\n\\\n🔗\\ Direct\\ link:\\\n([\\s\\S]*?)", "⚠️ 上传失败。\n\n🔗 直链：\n\u0001"],
  ["✅\\ \\*\\*Nova\\ settings\\ saved\\.\\*\\*\\\n\\\n([\\s\\S]*?)", "✅ **Nova 设置已保存。**\n\n\u0001"],
  ["🔬\\ \\*\\*Deep\\ research\\ on:\\*\\*\\ `([\\s\\S]*?)`\\\n\\\n([\\s\\S]*?)", "🔬 **深度研究主题：** `\u0001`\n\n\u0001"],
  ["⚠️\\ \\*\\*I\\ could\\ not\\ complete\\ that\\.\\*\\*\\\n\\\n([\\s\\S]*?)", "⚠️ **我无法完成该操作。**\n\n\u0001"],
  ["🌐\\ <b>My\\ projects\\ \\(([\\s\\S]*?)\\)<\/b>\\\n\\\n", "🌐 <b>我的项目 (\u0001)<\/b>"],
  ["❌\\ Executing\\ tool\\ \"([\\s\\S]*?)\"\\ failed\\.", "❌ 执行工具 \"\u0001\" 失败。"],
  ["📦\\ ([\\s\\S]*?)\\\n🔗\\ ([\\s\\S]*?)", "📦 \u0001\n🔗 \u0001"],
  ["\\\n\\\n✅\\ Completed:\\\n•\\ ([\\s\\S]*?)", "✅ 已完成：\n• \u0001"],
  ["Assistant\\ \\(([\\s\\S]*?)\\ persona\\)", "助手 (\u0001 角色)"],
  ["\\\n🔗\\ \\[Direct\\ Audio\\ Link\\]\\(([\\s\\S]*?)\\)", "🔗 [直接音频链接](\u0001)"],
  ["\\\n🔗\\ \\[Direct\\ Image\\ Link\\]\\(([\\s\\S]*?)\\)", "🔗 [直接图片链接](\u0001)"],
  ["✅\\ Web\\ app\\ `([\\s\\S]*?)`\\ deleted\\.", "✅ Web 应用 `\u0001` 已删除。"],
  ["\\\n\\\nThese\\ did\\ go\\ through:\\ ([\\s\\S]*?)", "以下已成功发送：\u0001"],
  ["💻\\ Your\\ code\\ file:\\ ([\\s\\S]*?)", "💻 你的代码文件：\u0001"],
  ["🚀\\ Run\\ on\\ Server\\ —\\ ([\\s\\S]*?)", "🚀 在服务器上运行 — \u0001"],
  ["🚀\\ Deploy\\ again\\ —\\ ([\\s\\S]*?)", "🚀 再次部署 — \u0001"],
  ["🗂️\\ ([\\s\\S]*?)", "🗂️ \u0001"],
  ["✅\\ Remembered:\\ \"([\\s\\S]*?)\"", "✅ 已记住：\"\u0001\""],
  ["Searching\\ \"([\\s\\S]*?)\"\\.\\.\\.", "正在搜索 \"\u0001\"..."],
  ["([\\s\\S]*?)\\ found\\ ✓", "找到 \u0001 个 ✓"],
  ["⚠️\\ Link:\\ ([\\s\\S]*?)", "⚠️ 链接：\u0001"],
  ["✅\\ \\*\\*Done:\\*\\*\\ ([\\s\\S]*?)", "✅ **完成：** \u0001"],
  ["🔗\\ Link:\\ ([\\s\\S]*?)", "🔗 链接：\u0001"],
];
const RULES: Array<[RegExp, string]> = RULE_SRC.map(([p, t]) => [new RegExp(`^${p}$`), t]);


const SENTINEL = "\u0001";

/** 中文排版清理：去掉「数字/中文」之间的多余空格（不动换行）。 */
function tidyCjk(s: string): string {
  return s
    .replace(/([\u4e00-\u9fff])[ \t]+([\u4e00-\u9fff])/g, "$1$2")
    .replace(/([0-9])[ \t]+([\u4e00-\u9fff])/g, "$1$2")
    .replace(/([\u4e00-\u9fff])[ \t]+([0-9])/g, "$1$2");
}

/** 剥离前后缀再翻译。
 *  很多按钮/进度是运行时拼出来的，例如 `🎨 Image Generation`、`Settings ⚙️`，
 *  词典里只有中间的词条，这里把 emoji / 符号剥掉、译完再拼回去。 */
const WORD = "0-9A-Za-z\\u0600-\\u06FF\\u4e00-\\u9fff";
const AFFIX_RE = new RegExp(`^([^${WORD}]*)([\\s\\S]*?)([^${WORD}]*)$`);

function affixTranslate(input: string): string | null {
  const m = AFFIX_RE.exec(input);
  if (!m) return null;
  const [, pre, core, post] = m;
  if (!core || core.length < 2 || core === input.trim()) return null;
  const hit = MAP[core.trim()];
  if (hit === undefined) {
    const rule = matchRule(core.trim());
    if (rule === null) return null;
    return pre + rule + post;
  }
  return pre + hit + post;
}

function matchRule(s: string): string | null {
  for (let i = 0; i < RULES.length; i++) {
    const m = RULES[i][0].exec(s);
    if (m) {
      let k = 1;
      return tidyCjk(RULES[i][1].replace(/\u0001/g, () => {
        const raw = m[k++] ?? "";
        return MAP[raw] ?? raw;
      }));
    }
  }
  return null;
}

export function zhUiTranslate(input: string): string {
  if (!input) return input;
  const direct = MAP[input];
  if (direct !== undefined) return direct;
  const trimmed = input.trim();
  if (trimmed !== input) {
    const t = MAP[trimmed] ?? matchRule(trimmed);
    if (t !== null && t !== undefined) return input.replace(trimmed, t);
  }
  const rule = matchRule(input);
  if (rule !== null) return rule;
  const affixed = affixTranslate(input);
  if (affixed !== null) return affixed;
  return input;
}

const TEXT_FIELDS = ["text", "caption", "question", "title", "description", "button_text", "placeholder", "explanation"];
const MARKUP_FIELDS = ["inline_keyboard", "keyboard"];

function zhLocalizeMarkup(markup: unknown): unknown {
  if (!markup || typeof markup !== "object") return markup;
  const mk = markup as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...mk };
  for (const field of MARKUP_FIELDS) {
    const rows = mk[field];
    if (!Array.isArray(rows)) continue;
    const newRows = rows.map((row) => {
      if (!Array.isArray(row)) return row;
      return row.map((btn) => {
        if (!btn || typeof btn !== "object") return btn;
        const b = btn as Record<string, unknown>;
        if (typeof b.text !== "string") return btn;
        const t = zhUiTranslate(b.text);
        if (t === b.text) return btn;
        changed = true;
        return { ...b, text: t };
      });
    });
    next[field] = newRows;
    changed = true;
  }
  return changed ? next : markup;
}

/**
 * 把出站参数里的用户可见文案换成中文。
 * 只在真的命中词条时才复制对象，未命中时原样返回，零开销。
 */
export function zhLocalizeParams(params: Record<string, unknown>, enabled: boolean): Record<string, unknown> {
  if (!enabled || !params) return params;
  let out: Record<string, unknown> | null = null;
  const ensure = () => (out ??= { ...params });

  for (const f of TEXT_FIELDS) {
    const v = params[f];
    if (typeof v === "string" && v) {
      const t = zhUiTranslate(v);
      if (t !== v) ensure()[f] = t;
    }
  }
  const markup = zhLocalizeMarkup(params.reply_markup);
  if (markup !== params.reply_markup) ensure().reply_markup = markup;

  return out ?? params;
}

